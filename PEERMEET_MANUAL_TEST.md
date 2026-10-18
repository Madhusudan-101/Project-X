# Peer-to-peer meet: manual test, with where to click

Branch: `feat/peermeet-end-to-end`. Setup (keys, env, scheduler) is in `PEERMEET_SETUP.md`. This file is only the click-by-click test.

---

## A. SQL files to run on Supabase (peer-to-peer only)

Run these **in this order**. Each is safe to run again. Either paste each file into **Supabase → SQL Editor → New query → Run**, or from a terminal:

```bash
export DATABASE_URL='postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres'   # Project Settings > Database > Connection string (URI)
./backend/db/run_peer_migrations.sh --dry-run   # shows the list
./backend/db/run_peer_migrations.sh             # runs all, stops at the first error
```

| # | File (in `backend/db/`) | What it adds |
|---|---|---|
| 1 | `apply_peer_matchmaking_and_scheduling.sql` | instant-match tickets, scheduled meetings, the matcher |
| 2 | `peer_interview_reports_migration.sql` | AI feedback reports |
| 3 | `peer_phase1_hardening_migration.sql` | match lifecycle, heartbeat, safe report saving |
| 4 | `peer_safety_migration.sql` | reports, blocks, suspensions |
| 5 | `peer_consent_migration.sql` | guidelines acceptance |
| 6 | `peer_feedback_migration.sql` | star ratings |
| 7 | `peer_notifications_migration.sql` | reminders, no-show status, personal settings |
| 8 | `peer_matching_preferences_migration.sql` | topic preference, avoid people you just met |
| 9 | `peer_precall_migration.sql` | per-session Yes/No consent, no-show count, interviewer message flag, new report reasons, "too short to judge" flag |

They need your base tables (`profiles`, `colleges`, and the `trigger_set_updated_at()` function) to exist already. After running, check **Table Editor** shows: `peer_matchmaking_tickets`, `peer_scheduled_meetings`, `peer_interview_reports`, `peer_user_reports`, `peer_blocks`, `peer_sanctions`, `peer_consents`, `peer_feedback`, `peer_preferences`, `peer_session_consents`, `peer_user_flags`.

---

## B. What you need open

| Thing | Where |
|---|---|
| Two candidate accounts, **Ann** and **Ben** (real emails, both finished onboarding) | log in at your dashboard `/candidate` in **two different browser profiles** (or one normal + one private window) |
| An admin | `/admin` (a Super Admin sees **Peer safety** automatically) |
| Headphones | stops echo |
| Browser | Chrome or Edge |
| PeerMeet server log | keep it visible to catch errors |

Dashboard path used below: **Candidate dashboard → Overview → "Peer Interview" card.**

---

## C. The tests

Tick as you go. If something fails, note the section, what you clicked, what you saw, the browser console error, and the PeerMeet server log.

### C1. First use: guidelines
1. Ann: **Overview → Peer Interview** (card in "Your workspace") → dialog **Join a Peer Interview**.
2. Leave **Keep my identity private** ON → click **Find a partner now**.
3. [ ] The **Peer interview guidelines** dialog opens. **I agree, continue** is disabled until all 3 boxes are ticked. **Not now** starts nothing.
4. Tick all 3 → **I agree, continue**. Matching starts ("waiting").
5. [ ] Cancel, open Peer Interview again, Find a partner: **no second guidelines dialog**.
6. Ben: repeat steps 1 to 4 with his own account (he sees the guidelines once too).

### C2. Instant match, then the Ready screen
Tip: instant match needs **two different accounts** clicking "Find a partner now" within about 30 seconds of each other (one normal window, one private window). The waiting person stays in the queue only while their dashboard tab is open (it can be in the background).
1. Ann and Ben both click **Find a partner now** (try the **topic** picker too).
2. [ ] Both get a **new PeerMeet tab**. If a pop-up was blocked, use **Open the room** in the dialog.
3. [ ] Both tabs show **"Get ready"**. No video, no "Connected".
4. [ ] **Your partner** card: Ann sees Ben's **first name and college/branch** only if Ben turned privacy OFF; if Ben kept privacy ON it says *"They chose to keep their details private."* No surname, email or phone anywhere.
5. [ ] A short **be respectful** reminder is shown.
6. [ ] Your **own camera preview** shows; the **mic bar moves** when you speak; camera and mic **pickers** work (switch camera: preview changes).
7. [ ] The question reads: *"This session may be recorded and reviewed by AI for scoring and safety purposes. Continue?"* with **Yes, continue** / **No, cancel the session**.
8. [ ] **Ready is greyed out** until you click Yes **and** "Camera and microphone are working." shows.
9. Ann clicks **Yes, continue** → "You said Yes." → **Ready**.
10. [ ] Ann's button becomes "Ready. Waiting for your partner…". Ben sees **"Your partner is ready."**
11. [ ] While Ben has NOT clicked Ready: **no call, no video, no "Connected"** on either side (wait 10 seconds).
12. Ben: Yes → Ready. [ ] The call starts for both within a few seconds: **"Connected"**, partner is the big video, you are the small window.
13. [ ] Supabase **Table Editor → `peer_session_consents`**: 2 rows, `answer = true`, with `room_id`, `consent_version`, `answered_at`.
14. [ ] **Double-click Ready**: harmless, sends once.

### C3. Ready screen edge cases (use new matches or `Create meeting` rooms)
| Do this | Expect |
|---|---|
| Ben clicks **No, cancel the session** | Ben: "Session cancelled". Ann: "Session cancelled", with **no reason**. Nobody can continue. `peer_session_consents` has Ben's row with `answer = false`. |
| Ben clicks **Leave** on the Ready screen | Ann sees "Waiting for your partner to join…" and can wait or Leave. |
| Ben **refreshes** on the Ready screen | Still the Ready screen; "You said Yes." is remembered; Ben must click Ready again. |
| Ben **refreshes during the call** | Goes straight back into the call. |
| Block the camera in the browser (padlock icon → Camera: Block), reload | Clear message with steps, **Try again** button, **Ready stays disabled** even after Yes. Allow it, Try again: works. |
| Nobody clicks Ready for ~5 minutes | Both see "Not ready in time". A "closes in m:ss" countdown shows. |
| Disconnect wifi for 10s on the Ready screen, reconnect | "Connection lost. Reconnecting…", then it recovers. |

### C4. In the call
- [ ] **Swap** button exchanges big/small video.
- [ ] Mute Ben: Ann sees the muted icon. **People** (bottom bar) lists both.
- [ ] **Chat** (bottom bar): message arrives in about a second; unread number shows while the panel is closed; refresh brings history back. Send `<b>hi</b>`: shows as literal text. 15 messages fast: you get slowed down.
- [ ] **Share Screen**, then stop with the **browser's own "Stop sharing" bar**: partner's video returns to your camera.
- [ ] **Leave** (bottom bar) asks **"Leave this meeting?"**; **Stay** keeps you; **Leave** goes to **"You left the meeting"** with **Rate this session** and **Rejoin the meeting**. The partner is told.
- [ ] A scheduled meeting shows **"N min left"**, warns at 5 min, 1 min and when time is up, never cuts the call off.

### C5. AI interview (roles, notices, onboarding)
The **person who started the meeting** (the first one in the room) sees **Interview Setup** once both cameras are on. Say Ann is the starter.
1. [ ] Ben (guest) never sees Interview Setup.
2. Ann picks subject, difficulty, experience, duration, who answers first → **Start AI-assisted interview**.
3. [ ] **Both** see **"AI assistance is active"** and their role (**"You are the interviewer"** / **"You are the candidate"**).
4. [ ] Only the **candidate** sees the tip: *"answer properly and out loud… too short to judge."*
5. [ ] **First time ever as interviewer**: a dialog **"You are the interviewer"** appears. **Escape and clicking outside do nothing; only "Got it" closes it.**
6. After "Got it": Supabase **`peer_user_flags`** has a row for that person with `interviewer_onboarding_seen_at` set.
7. [ ] Start a **second session** (end the first with **End session** on the dashboard card, match again), ideally on **another browser**: the same person is interviewer again and **does not** see the message.
8. [ ] The interviewer sees the AI panel (suggested questions, scores, topic map); the candidate never does.
9. [ ] **Setup lock**: after submitting, try changing setup (reload and try; or the guest tries): refused with a message; setup unchanged. After the interview started: edits refused.
10. **Too-short answers**: the candidate says nothing (or one word), interviewer clicks **End interview**. [ ] Candidate's report says **"Your answers were too short to judge"** with **no scores**.
11. Run again, candidate answers properly for a minute. [ ] A normal scored report ("Practice feedback") appears; **Download PDF** works.
12. [ ] **Switch roles** then end: two reports, no duplicates.
13. [ ] If captions need Deepgram: **Chat → Captions tab** shows live captions only after both said Yes.

### C6. Scheduling
1. Ann: **Overview → Peer Interview** → **Schedule a Peer Interview**. Pick a time about 12 minutes ago is not allowed; pick **+3 minutes**, duration 30, type **Ben's email**, Schedule.
2. [ ] A wrong email (no account) is refused with a clear message. Empty invitee = **open meeting**.
3. [ ] Ben gets an **invitation email** (time in his timezone). It shows under **Upcoming Peer Interviews** / **Scheduled Peer Interviews**.
4. [ ] **Add to calendar** downloads an .ics. **Reschedule** moves it (Ben emailed). **Cancel** emails Ben; cancelling after someone joined is refused.
5. When the time comes: **Join** (opens 5 minutes before). Both land on **Get ready**, then as in C2.
6. [ ] Reminder emails (needs the scheduler, `PEERMEET_SETUP.md` §7): ~15 min before, once each; a meeting booked days ahead also gets a day-before email.
7. Settings: **Overview → Recent → Settings**: turn reminders off for Ben, set timezone. [ ] Ben stops getting reminders; Ann still does.

### C7. Partner did not show (scheduled meetings only)
1. Book a meeting with Ben starting in ~3 minutes. Ann clicks **Join** and waits alone on **Get ready**. Ben does **not** join.
2. [ ] Before **10 minutes after the scheduled start**: **no** "Partner did not show" button. The meeting ID is shown.
3. [ ] After 10 minutes: the button appears with *"It will not count against you."* Click **Partner did not show** → Ann sees **"Marked as a no-show"**.
4. Supabase: [ ] `peer_scheduled_meetings` row has `status = no_show`, `absent_id` = Ben. [ ] `peer_user_flags` has Ben with `no_show_count = 1` and **no row for Ann**. [ ] **No** row in `peer_interview_reports` for it. [ ] No suspension in `peer_sanctions`.
5. [ ] Ben cannot join that meeting afterwards.
6. [ ] An **open** meeting (nobody invited) records nobody as absent.

### C8. Report, block, feedback
1. In a call, once the partner is there: bottom bar **Report** (flag icon). [ ] Reasons: Inappropriate content, **Rude**, **Not making a genuine effort**, Harassment, Impersonation, Cheating, Spam, **Something else** (needs a description).
2. [ ] Choose a reason, **Send report**: confirmation says the other person is **not told**. **The call keeps going.** "Also block this person and leave the call" is **off** by default.
3. Supabase **`peer_user_reports`**: [ ] row with reporter, reported, room, reason, text, time, and transcript lines in `evidence`.
4. [ ] Report again with **Also block** ticked in another session: you leave the call; Ann and Ben are never matched again (**Overview → Recent → Blocked people**, **Unblock** works).
5. **Feedback screen**: after leaving, **Rate this session** (or **Overview → Recent → History → Rate**). [ ] There is a **Report this person** button here too and it opens the same form.
6. [ ] Stars + tags + note save; rating again replaces it; the partner never sees it.
7. **Overview → Recent → History**: [ ] every session listed newest first with Report / Rate; "Nobody joined" sessions offer no report.

### C9. Admin
1. Admin: **/admin → Peer safety**.
2. [ ] The report is in the Open queue with names, reason, "from inside the meeting", the transcript, and the reported person's history.
3. [ ] **Warn**, **Suspend N days**, **Dismiss**, **Lift suspension**, each with a note.
4. [ ] A suspended person sees a banner on the Peer card and "paused while a report is reviewed"; the rest of Mirracle still works.
5. [ ] Three different people reporting the same person in 30 days **suspends them automatically**.
6. [ ] A non-admin cannot open `/admin/peer-safety`.

### C10. Security spot checks
- [ ] Open a PeerMeet room link for a meeting you are **not** part of: refused ("You are not allowed in this meeting").
- [ ] Open PeerMeet **directly** with no dashboard link: works for plain anonymous rooms **unless** the server has `PEERMEET_REQUIRE_TOKEN=1`.
- [ ] A third person trying a full room is refused.
- [ ] Without the secret, `POST /internal/peer/session-consent` returns 401.
- [ ] Ann cannot read Ben's consent, reports or flags (RLS; `backend/tests/sql/peer_precall_rls_test.sh` proves it).

### C11. Browsers and devices
- [ ] Chrome and Edge: everything. Safari and Firefox: Ready screen and call (captions may not work).
- [ ] A phone: layout usable; screen share is not available on most phones.
- [ ] Keyboard only: tab through the Ready screen, Escape closes dialogs (not the interviewer message).

---

## D. Pass criteria
C1 to C9 pass with real accounts, emails reach a real inbox, and the database rows in C2, C5, C7 and C8 match what is described.
