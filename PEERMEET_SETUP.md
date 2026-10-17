# PeerMeet: what you need to do to make it work, and how to test all of it

Branch: **`feat/peermeet-end-to-end`** (cut from `main`; it does not contain the AI interview work).
Everything in code is done and tested with fakes. This file is the list of things only you can do
(accounts, keys, SQL, scheduler, deployment) plus a full manual test plan.

---

## 0. Get the code

```bash
git fetch origin
git checkout feat/peermeet-end-to-end
git pull origin feat/peermeet-end-to-end
git status -sb      # should show: ## feat/peermeet-end-to-end...origin/feat/peermeet-end-to-end
```

Pull again before every test session in case more fixes were pushed.

### Commands for the automated tests

```bash
# Backend (from backend/)
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests/integration tests/unit                      # 396 tests (peer: phase1, safety, consent, notify, matching)
python tests/test_peer_matchmaking_and_scheduling.py               # older peer script: 77 checks (run on its own: it swaps the DB at import)
python tests/test_admin_portal_api.py                              # 295 checks (includes the new admin routes)

# PeerMeet server (from PeerMeet/server/)  - the client's node_modules must exist too: the test uses its socket.io-client
(cd ../client && npm install) && npm install && npm test           # 40 unit + 11 integration + 62 security/consent/chat/report checks

# PeerMeet client (from PeerMeet/client/)
npm install && npm test                                            # 23 node tests + 41 component tests (lobby, report dialog, meeting room, panels)

# Dashboard (from frontend/)
npm install && npx tsc --noEmit -p tsconfig.json && npx vitest run # 135 tests

# Real browsers against all four servers (from e2e/)
npm install && npx playwright test specs/peermeet.spec.ts specs/peer-journey.spec.ts   # 21 specs, real WebRTC
```

---

## 1. Accounts and keys

| Needed for | Service | Where it goes |
|---|---|---|
| Live captions + AI interview | **Deepgram** | PeerMeet server `DEEPGRAM_API_KEY` |
| AI questions and feedback reports | **Google Gemini** | PeerMeet server `GEMINI_API_KEY` (+ `GEMINI_MODEL`) |
| Video through strict networks (firewalls, mobile data) | **Metered TURN** | PeerMeet server `METERED_API_KEY` |
| Invitation, reminder, cancellation, no-show emails | **Resend** with a verified domain | backend `RESEND_API_KEY`, `OA_EMAIL_FROM`, `APP_BASE_URL` |

- [ ] Deepgram, Gemini, Metered keys created
- [ ] Resend domain verified (without email the app still works; people just are not emailed)

## 2. Secrets you generate

Generate each with `openssl rand -hex 48`.

- [ ] `PEERMEET_SHARED_SECRET` : same value in the **backend** and the **PeerMeet server**. This is the simple setup.
- [ ] Optional, stronger: use two secrets instead: `PEERMEET_TOKEN_SECRET` (signs the entry token) and `PEERMEET_WEBHOOK_SECRET` (authenticates reports). Each falls back to the shared one if unset. Set them identically on backend and PeerMeet server.

## 3. Database: run the SQL files in this order

Every file is safe to run again.

**From the terminal (no copy-pasting into Supabase):**

```bash
# Supabase > Project Settings > Database > Connection string (URI), the direct or session-pooler one
export DATABASE_URL='postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres'
./backend/db/run_peer_migrations.sh --dry-run   # lists what would run, in order
./backend/db/run_peer_migrations.sh             # runs all of them, stops at the first error
```

It needs `psql` (`brew install libpq` or `apt install postgresql-client`). The script and the list below are the same order.
You can also still paste each file into the Supabase SQL editor.

1. [ ] `backend/db/apply_peer_matchmaking_and_scheduling.sql` (matchmaking + scheduled meetings; you may already have run it)
2. [ ] `backend/db/peer_interview_reports_migration.sql`
3. [ ] `backend/db/peer_phase1_hardening_migration.sql` match lifecycle, heartbeat, report idempotency, **drops the over-broad meeting visibility policy**
4. [ ] `backend/db/peer_safety_migration.sql` reports, blocks, suspensions; matcher skips blocked and suspended people
5. [ ] `backend/db/peer_consent_migration.sql` guidelines acceptance record
6. [ ] `backend/db/peer_feedback_migration.sql` post-meeting ratings
7. [ ] `backend/db/peer_notifications_migration.sql` reminder bookkeeping, `no_show` status, personal settings
8. [ ] `backend/db/peer_matching_preferences_migration.sql` topic preference and "avoid people you just met"
9. [ ] `backend/db/peer_precall_migration.sql` per-session Yes/No consent, no-show count and who was absent, the one-time interviewer message flag, the "rude" and "not genuine effort" report reasons, and the "too short to judge" report flag

They need `profiles` and `public.trigger_set_updated_at()` from your base migrations. All nine were run twice on a scratch
Postgres 16 and the matcher, constraints and row-level security were checked there (`backend/tests/sql/peer_precall_rls_test.sh`
re-runs that check on a throwaway database whenever you like: it proves one person cannot read or write another person's consent
answers, reports or flags).

## 4. Backend environment (`backend/.env`)

```
PEERMEET_SHARED_SECRET=<step 2>          # or PEERMEET_TOKEN_SECRET + PEERMEET_WEBHOOK_SECRET
PEERMEET_REQUIRE_SIGNATURE=1             # recommended: report webhooks must be signed (PeerMeet signs them)
RESEND_API_KEY=
OA_EMAIL_FROM="Mirracle <peers@yourdomain.com>"
APP_BASE_URL=https://your-public-site    # used in email links
```

- [ ] Set and redeploy the backend

## 5. PeerMeet server environment (`PeerMeet/server/.env`)

```
PORT=5001
CLIENT_URL=https://your-peermeet-client        # comma-separate more than one origin
PEERMEET_SHARED_SECRET=<step 2>                # same as the backend (or the two split secrets)
PEERMEET_REQUIRE_TOKEN=1                       # RECOMMENDED for a dashboard-only deployment (see below)
PEERMEET_PRECALL_TIMEOUT_MS=300000             # optional: how long the Ready screen waits for both people (default 5 minutes)
MIRRACLE_WEBHOOK_URL=https://your-backend      # no trailing slash; must be reachable from the PeerMeet server
DEEPGRAM_API_KEY=  GEMINI_API_KEY=  GEMINI_MODEL=gemini-3.6-flash  METERED_API_KEY=
```

`PEERMEET_REQUIRE_TOKEN=1` means **every room needs a valid entry token for that room**, so nobody can create or squat a room
with a guessed id. Leave it unset only if you also want anonymous standalone rooms. A returning participant whose token has
expired is still let back into their own slot.

- [ ] PeerMeet server deployed over **https** (camera/microphone are blocked on plain http except localhost)
- [ ] `MIRRACLE_WEBHOOK_URL` is the real backend URL, not `localhost`

## 6. PeerMeet client and dashboard

```
# PeerMeet/client/.env   (build-time: rebuild after changing)
VITE_SERVER_URL=https://your-peermeet-server
VITE_DASHBOARD_URL=https://your-dashboard      # for "Rate this session" / "Back to my dashboard"

# frontend/.env
VITE_PEERMEET_URL=https://your-peermeet-client # already used by the dashboard to open the room
```

- [ ] Both rebuilt and deployed

## 7. Scheduler (required for reminders, no-shows and cleanup)

Call every **5 minutes** from any scheduler (Render cron, GitHub Actions, cron-job.org):

```bash
curl -X POST "https://your-backend/internal/peer/maintenance" \
     -H "Authorization: Bearer $PEERMEET_SHARED_SECRET"     # or PEERMEET_WEBHOOK_SECRET if you split them
```

It sends the 24-hour and 15-minute reminders (each once), marks "waited 10 minutes, nobody came" as a no-show and tells the
person it was not their fault, expires stale matches and meetings, and returns counts you can alert on.

- [ ] Scheduler created and returning 200

## 8. Admin access

A **Super Admin** sees **Peer safety** in the admin sidebar automatically. A delegated admin needs the permissions
`peer_safety.view` (read the queue) and `peer_safety.resolve` (dismiss, warn, suspend, lift) granted in Admin Management.

- [ ] A moderator (you or someone you trust) knows to check **Admin → Peer safety** regularly

---

## 9. Manual test plan: the whole workflow

> For a click-by-click version with exact navigation and the SQL file list, see **`PEERMEET_MANUAL_TEST.md`**.

Use **two candidate accounts** with real email inboxes (call them Ann and Ben), one **admin** account, a laptop with camera and
microphone, headphones (avoids echo), Chrome or Edge. Two browser profiles (or one normal + one private window) so both stay
signed in. Keep the PeerMeet server log open. Tick each line; if something fails note the section, what you clicked, what you
saw, the browser console error and the server log around that time.

### 9.0 Smoke test (5 minutes)
- [ ] Backend `/docs` loads. PeerMeet server `/health` returns ok.
- [ ] Ann's dashboard loads, Overview shows the **Peer Interview** card and "Recent" card with **History** and **Settings**.
- [ ] Admin portal loads and the sidebar has **Peer safety**.

### 9.1 First use: guidelines and consent
- [ ] Ann clicks Peer Interview → Find a partner now. **The guidelines dialog opens** (rules + what happens to camera, mic and AI data).
- [ ] "I agree, continue" stays disabled until all three statements are ticked. "Not now" starts nothing (no ticket is created).
- [ ] After agreeing, matching starts. Cancel, then Find a partner again: **no second dialog**.
- [ ] Ben (not yet agreed): the same dialog appears for him on his first try.

### 9.2 Instant matching, twice in a row (this was broken before)
- [ ] Ann and Ben both click Find a partner now (try the **topic** picker: same topic, then different topics: both still match).
- [ ] While waiting, the screen shows the elapsed time and honest wording, and after about 90 seconds **"Schedule a time instead"**. No fake queue position.
- [ ] Both land in the same room (the PeerMeet tab). Close the room, click **End** on the dashboard's active-room card, and the feedback dialog appears.
- [ ] **Ann and Ben match again** without being stuck on the old room. Do it a third time. They should be offered each other last if anyone else is waiting.
- [ ] If the new tab did not open (pop-up blocked), **"Open the room"** in the matching dialog opens it.

### 9.3 Privacy
- [ ] Default is "Keep my identity private" ON (or your saved default from **Settings**). Ben (private) and Ann (visible): Ann sees "Anonymous Candidate"; Ben sees Ann's name.
- [ ] After the session, **History** and the Recent card show "Anonymous Candidate" for Ben to Ann. Ben's real name appears nowhere on Ann's side (including the report, history and any emails).
- [ ] A person with no name on their profile is shown as "Peer", never as an email address.

### 9.4 The Ready screen (before the call): partner, consent, device check, Ready
After matching, or after opening a scheduled meeting, both people land on **"Get ready"**. Nothing is shared between them yet.
- [ ] The screen shows your **own camera preview**, a **microphone level bar** that moves when you speak, and camera and microphone pickers. The preview stays on your device: the partner sees nothing of you yet.
- [ ] **Your partner** shows their **first name and college/branch only**. A partner who chose to be private shows "They chose to keep their details private." No surname, email or phone anywhere.
- [ ] A short **be respectful** reminder is shown.
- [ ] The question reads exactly: *"This session may be recorded and reviewed by AI for scoring and safety purposes. Continue?"* with **Yes, continue** and **No, cancel the session**.
- [ ] **Ready is disabled** until you answered Yes **and** the camera and microphone work. (Check: no Yes, only devices ok: disabled. Yes but camera blocked: disabled.)
- [ ] Click **Yes**: "You said Yes." Ann's Yes appears in the table `peer_session_consents` (person, session, answer, time, wording version).
- [ ] Click **Ready** once: the button changes to "Ready. Waiting for your partner…". The partner sees "Your partner is ready." **No call starts, no "Connected", no video** until the other person is Ready too.
- [ ] When **both** are Ready, the call starts for both. Double-clicking Ready is harmless.
- [ ] **No**: the person who said No sees "Session cancelled". The partner sees "Session cancelled" and is **not told why**. Nothing is recorded, no transcript, no AI. The No is stored as a No.
- [ ] **Partner leaves this screen**: you see "Waiting for your partner to join…" and can wait or Leave.
- [ ] **Nobody clicks Ready**: after about 5 minutes the screen closes for both with "Not ready in time". A countdown is shown on the screen.
- [ ] **Refresh on this screen**: your Yes is remembered, your Ready is not (you check devices and click Ready again).
- [ ] **Refresh during the call** goes straight back into the call.
- [ ] Block the camera in the browser: a clear message with **browser-specific steps** and **Try again**; Ready stays disabled. "No camera or microphone was found" / "being used by another app" appear for those cases.
- [ ] **Waiting alone for a scheduled meeting** shows the meeting ID to share.

### 9.4b "Partner did not show" (scheduled meetings only)
- [ ] Book a meeting with Ben for a few minutes ahead; Ann opens it and waits alone. Before 10 minutes after the scheduled start there is **no** button.
- [ ] After 10 minutes past the scheduled start, **"Partner did not show"** appears (it says it will not count against Ann). Click it: Ann sees "Marked as a no-show".
- [ ] In the database: the meeting is `no_show`, `absent_id` is Ben, Ben's `no_show_count` in `peer_user_flags` is 1 (Ann has no row). **No** report or score exists for that session, and no suspension was created.
- [ ] Ben can no longer join that meeting. An **open** meeting (nobody invited) records nobody as absent and counts nothing.
- [ ] The scheduler's automatic no-show (section 7) does the same and never double counts after a manual click.

### 9.5 In the meeting
- [ ] Partner is the **large video**, you are a **small window**; **Swap** exchanges them.
- [ ] The partner's mic/camera state shows (mute Ben: Ann sees the muted indicator). **People** tab lists both with state.
- [ ] **Chat**: messages arrive within a second, unread count shows while the panel is closed, history comes back after a refresh. Send `<b>hi</b>`: it appears as literal text. Try 15 messages in a few seconds: you are slowed down.
- [ ] **Captions** tab: captions only run after both people said Yes on the Ready screen and the backend has both Yes answers on file. If the backend cannot confirm both, captions and the AI stay off.
- [ ] Share your screen, then stop with the **browser's own "Stop sharing" bar**: your partner's video returns to your camera (it used to freeze).
- [ ] Turn your camera off while sharing: the camera button reflects the camera, not the screen.
- [ ] **Leave** asks "Leave this meeting?"; **Stay** keeps you; **Leave** takes you to **"You left the meeting"** with **Rate this session** and **Rejoin the meeting**.
- [ ] The partner is told when you leave, and a **third person can now take the freed slot**. (A dropped connection, by contrast, keeps your slot so you can come back.)
- [ ] Scheduled meetings show **"N min left"**, warn at 5 minutes, 1 minute and when the time is up, and never cut the call off.

### 9.6 AI-assisted interview
- [ ] The **person who started the meeting** sees **Interview Setup** once both cameras are on; the guest never sees it. Choose subject, difficulty, experience, duration and who answers first, then start.
- [ ] **Setup is once.** After it is submitted the server refuses a second submit ("The setup was already submitted"), a submit from the guest ("Only the person who started the meeting can set it up"), and any edit after the session began ("The session already started"). Try it from a second tab or by reloading: the setup is unchanged.
- [ ] **Both** people see **"AI assistance is active"** and **their own role** ("You are the interviewer" / "You are the candidate").
- [ ] The **candidate** sees a short note: answer properly and out loud; one-word or silent answers only produce a report saying the answer was too short to judge. The interviewer does not see that note.
- [ ] **First time ever as interviewer**: a message appears ("You'll get live suggested questions and live scoring... guide, not a script...") with the glance, pick-one, ask-naturally and topic-map guidance. **Escape and clicking outside do nothing; only "Got it" closes it.**
- [ ] After "Got it", `peer_user_flags.interviewer_onboarding_seen_at` is set for that person. In a **second session**, on a **different browser or device**, they are interviewer again and are **not** shown it. A person who has never been interviewer sees it the first time they are made interviewer after a **role switch**.
- [ ] Only the interviewer sees the AI panel; the candidate never does.
- [ ] **Too-short answers**: start an interview, say nothing (or one word), end it. The candidate's report says **"Your answers were too short to judge"**, shows **no scores**, no strengths or weaknesses, and is saved flagged as insufficient (not as an AI failure). Then do it again and answer properly for a minute: you get a normal scored report.
- [ ] End the interview (or switch roles): the candidate gets a report that says **"Practice feedback"** (not a hiring verdict). Printing it works (no pop-up).
- [ ] Switch roles then end: **two** reports, not duplicates, and the meeting completes only at the end.

### 9.7 Scheduling
- [ ] Schedule with an **email that has no Mirracle account**: it is **refused** with a clear message (it no longer silently becomes an open meeting).
- [ ] Schedule for Ben's real email: Ben receives an **invitation email** (time shown in Ben's timezone; Ann's name only if she is not private). It appears on Ben's dashboard.
- [ ] Leave the invitee empty: an **open meeting** anyone can join; the public list shows no room id.
- [ ] **Add to calendar** downloads an .ics that opens in your calendar. **Reschedule** moves it and emails Ben. **Cancel** emails Ben. Cancelling after someone has joined is refused.
- [ ] Reminder emails: book a meeting about 10 minutes ahead; after the next scheduler run both get a "starts soon" email, **once**. A meeting booked days ahead gets the day-before email once.
- [ ] No-show: Ann joins her scheduled meeting and waits 10+ minutes; after the next scheduler run the meeting shows **"Nobody came"** and Ann gets an email saying it was not her fault. Ben cannot join it afterwards.
- [ ] **Settings**: turn off reminders for Ben; he stops getting them while Ann still does. Choose a timezone; emails use it.

### 9.8 Report, block, suspension and moderation (the safety feature)
- [ ] In a meeting, **Report** appears only once the other person is there. Reasons: inappropriate, rude, not making a genuine effort, harassment, impersonation, cheating, spam, and **Something else** (which requires a description).
- [ ] **A report does not end the call.** "Also block this person" is **off** by default; ticking it blocks and takes the reporter out of the call. Without it, the reporter can keep going, or leave at any time with no penalty.
- [ ] The **feedback screen** ("Rate this session", on the dashboard) has a **Report this person** button that opens the same form for that session.
- [ ] The confirmation says the other person is **not told**. Ben sees nothing in the call.
- [ ] **Admin → Peer safety**: the report is in the Open queue with reporter and reported names, the reason, "from inside the meeting", the **transcript and chat lines** attached, and the reported person's history.
- [ ] Reporting from **History** (after a session) works the same and names the room, not a person.
- [ ] After blocking, Ann and Ben are **never matched again** and cannot see or join each other's meetings (they are not told why). **Recent → Blocked people** lists "Anonymous Candidate" or the name; **Unblock** works.
- [ ] Admin: **Warn**, **Suspend N days**, **Dismiss**, **Lift suspension**; each is recorded with a note. A suspended person sees a banner on the Peer card and "paused while a report is reviewed" if they try anything; they can still use the rest of Mirracle.
- [ ] Three different people reporting the same person within 30 days **suspends them automatically** (try with three accounts).
- [ ] A person who is not a Super Admin and lacks the permission cannot open the page or the API.

### 9.9 Feedback, history and the rest
- [ ] After a session, **Rate** (stars, optional tags and note). Rate again to change it. The partner never sees it.
- [ ] **History** lists every instant match and scheduled session newest first, with status, partner label, and Report/Rate where there was a partner. Filters work, including "Not rated yet".
- [ ] A session where nobody joined shows "Nobody joined" / "Partner did not come" and offers no report.

### 9.10 Failure paths
- [ ] Turn wifi off for ~10 seconds mid-call, then on: a banner "Connection to the meeting server lost. Reconnecting…" then the call recovers.
- [ ] Wait longer than 10 minutes into a call (the entry token expires), then refresh: you are let straight back in.
- [ ] Open the room link of a meeting you are **not** part of (copy the room id from a friend): you are refused ("You are not allowed in this meeting"), not let in.
- [ ] Stop the PeerMeet server mid-call and restart it: **the call and any running interview end** (state is in memory: see limits below). Reports already delivered are kept.
- [ ] Take the backend down while a report is being saved: the PeerMeet server retries (after 2s, 10s, 30s) so the report is not lost.

### 9.11 Security spot checks (quick, important)
- [ ] Ann cannot read Ben's reports, blocks, feedback or history through any endpoint.
- [ ] A candidate calling any `/admin/peer-safety/...` URL gets 403.
- [ ] `POST /internal/peer-reports` and `/internal/peer-safety/report` without the secret return 401; with `PEERMEET_REQUIRE_SIGNATURE=1` an unsigned call returns 401.
- [ ] The public "upcoming meetings" response contains no room ids and no user ids.
- [ ] Opening PeerMeet directly (no dashboard link) still works for plain anonymous rooms **unless** you set `PEERMEET_REQUIRE_TOKEN=1`.

### 9.12 Browsers and devices
- [ ] Chrome and Edge: full flow. Safari and Firefox: lobby and call work; **live captions on Safari may not work** (not verified).
- [ ] A phone: layout is usable; screen sharing is not available on most phones.
- [ ] Keyboard only: you can tab through the lobby, open/close chat, answer the leave dialog (Escape cancels it), and close dialogs with Escape.

### Pass criteria
You can call it working when 9.0 to 9.9 pass on real accounts, the emails arrive in a real inbox (not spam), and 9.10 behaves as
described.

---

## 10. What I could not verify from here (watch these on your first real run)

- Real browsers over real networks: TURN/NAT traversal needs your Metered account and a test between two different networks.
- Real Deepgram, Gemini and Resend accounts (all tested with the services stubbed or absent).
- Real Supabase: row-level security and the matcher were verified on a scratch Postgres 16 with stand-in tables, not on your project.
- Safari/Firefox live transcription.
- Emails: deliverability (SPF/DKIM on your Resend domain) and wording in a real inbox.

## 11. Known limits (by design today)

- **"Recorded"**: Mirracle stores no audio or video. The consent question covers what really happens: speech is sent live to Deepgram for captions and the transcript is reviewed by Gemini (AI) for scoring and safety. If you ever add real call recording, it needs its own storage, retention rule and a separate go-ahead.
- Camera/microphone device state ("both work") is reported by each browser; the server enforces Yes, Ready and "both ready", but cannot itself see a camera.
- A plain anonymous room (no dashboard sign-in) has no account to store a Yes on, so for those rooms the Yes is held in the meeting server's memory only. Dashboard rooms always use the stored answers. Use `PEERMEET_REQUIRE_TOKEN=1` to allow dashboard rooms only.
- Someone who arrives into a session that is already running (for example after a partner left on purpose) goes through the same Yes and Ready on their own before they are paired.
- "Partner did not show" is for scheduled meetings. Instant matches have no scheduled start to measure from.

- **PeerMeet's state is in memory, single instance.** A server restart ends every live call and interview, and two instances behind
  a load balancer will not share rooms. Fix later with a shared store (Redis); not done.
- Rate limits are per socket/process, not a shared gateway limit.
- Mid-call camera/microphone switching is not built (pick them in the lobby; to change, leave and rejoin).
- A person who denies camera access cannot join (there is no listen-only mode).
- Reports are practice feedback, never hiring decisions; the interviewer does not get a report of their own turn.
- No audio or video is ever stored by Mirracle. A transcript excerpt (last ~200 lines plus ~50 chat lines) is attached to a
  report **only when someone reports a call**.
