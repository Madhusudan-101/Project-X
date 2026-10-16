# AI Interview: what you need to do to make it work

Everything in code is done and tested with fakes. This file is the list of things only you can do
(accounts, keys, SQL, deployment, scheduler) plus a manual test plan to prove it works for real.

Work through it top to bottom. Tick each box.

---

## 0. Get the code (which branch, which commands)

All of this work is on the branch **`feat/ai-interview-meeting-room`** of
`github.com/Madhusudan-101/Project-X`. It is **not** merged into `main`, so pull this branch to test it.

```bash
# first time
git clone https://github.com/Madhusudan-101/Project-X.git
cd Project-X
git checkout feat/ai-interview-meeting-room

# already cloned
git fetch origin
git checkout feat/ai-interview-meeting-room
git pull origin feat/ai-interview-meeting-room
```

Check you are on the right branch and up to date: `git status -sb` should show
`## feat/ai-interview-meeting-room...origin/feat/ai-interview-meeting-room` with nothing ahead or behind.
Pull again before every test session in case more fixes were pushed.

### Commands to run for testing

**Backend** (from `backend/`):
```bash
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000        # run it
# automated tests for this feature (run by path):
python -m pytest tests/test_ai_interview.py tests/integration tests/unit
```

**Agent** (from `ai-interviewer/`):
```bash
uv sync
uv run python agent.py download-files    # one time
uv run python agent.py dev               # run it (keep the terminal open and watch its log)
uv run python -m pytest                  # automated tests
```

**Frontend** (from `frontend/`):
```bash
npm install
npm run dev                              # run it
npm test                                 # automated tests (vitest)
npx tsc --noEmit -p tsconfig.json        # type check
```

Run order for a manual test: SQL (section 3) → backend → agent → frontend → follow section 8.

Expected automated results on this branch: backend 465 passed, agent 74 passed, frontend 262 passed.
(Running plain `pytest tests` over the whole backend folder stops early during collection; use the
path form above.)

---

## 1. Accounts and API keys

| Needed for | Service | Where the key goes |
|---|---|---|
| Live voice/video rooms | **LiveKit Cloud** project (`wss://….livekit.cloud`, API key, API secret) | backend **and** agent: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Interviewer speech-to-text | **Deepgram** | agent: `DEEPGRAM_API_KEY` |
| Interviewer voice | **Cartesia** | agent: `CARTESIA_API_KEY` |
| Interviewer brain, grading, camera check | **Google Gemini** | agent: `GOOGLE_API_KEY` (+ `GEMINI_MODEL`) |
| AI rubric drafting ("Draft with AI") | **Google Gemini** | backend: `GEMINI_API_KEY` |
| Invitation / reminder / report / outcome emails | **Resend** with a verified sending domain | backend: `RESEND_API_KEY`, `OA_EMAIL_FROM`, `APP_BASE_URL` |

- [ ] LiveKit project created
- [ ] Deepgram, Cartesia and Gemini keys created
- [ ] Resend domain verified (without it emails are skipped; the app still works and tells the hiring team nothing was sent)

## 2. Secrets you generate yourself

- [ ] `AI_INTERVIEW_SHARED_SECRET`: run `openssl rand -hex 48`. Use the **same value** in the backend and the agent. Do not reuse the PeerMeet secret.
- [ ] `AI_INTERVIEW_AGENT_NAME`: leave as `mirracle-interviewer`. It must be identical in backend and agent.

## 3. Database (Supabase → SQL editor)

Run these four files **in this order**. Each is safe to run again.

1. [ ] `backend/db/ai_voice_interview_migration.sql` practice interviews and reports
2. [ ] `backend/db/ai_interview_integrity_migration.sql` consent columns and integrity events
3. [ ] `backend/db/ai_interview_hiring_migration.sql` company interviews, invites, rubric snapshots
4. [ ] `backend/db/ai_interview_lifecycle_migration.sql` reminders, retakes, accommodations, flag review

Notes:
- They need the existing `profiles`, `companies` (with `owner_id`) and `jobs` tables, which your other migrations already create.
- The backend uses the Supabase **service-role** key; the tables have RLS enabled with service-role-only policies (plus a company read policy on templates).

## 4. Backend environment (`backend/.env`)

```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
AI_INTERVIEW_AGENT_NAME=mirracle-interviewer
AI_INTERVIEW_SHARED_SECRET=<the value from step 2>
AI_INTERVIEW_DAILY_LIMIT=3                 # practice interviews per candidate per day
AI_INTERVIEW_MAX_MINUTES=20                # practice length cap
AI_INTERVIEW_COMPANY_DAILY_INVITES=200     # invitations one company may send per day
AI_INTERVIEW_TRANSCRIPT_RETENTION_DAYS=    # optional: delete transcripts after N days (scores kept)
GEMINI_API_KEY=
RESEND_API_KEY=
OA_EMAIL_FROM="Mirracle <interviews@yourdomain.com>"
APP_BASE_URL=https://your-public-site     # used in email links; must be the real frontend URL
```

- [ ] Set and redeploy the backend

## 5. Deploy the interviewer agent (`ai-interviewer/`)

It is a **separate long-running service**. It cannot run inside FastAPI or the frontend.

```bash
cd ai-interviewer
cp .env.example .env.local        # fill it in (below)
uv sync
uv run python agent.py download-files   # one time: model weights
uv run python agent.py dev              # local testing
uv run python agent.py start            # production
```

Agent environment:

```
LIVEKIT_URL= / LIVEKIT_API_KEY= / LIVEKIT_API_SECRET=      # same project as the backend
AI_INTERVIEW_AGENT_NAME=mirracle-interviewer
MIRRACLE_WEBHOOK_URL=https://your-backend-public-url        # no trailing slash
AI_INTERVIEW_SHARED_SECRET=<same value as the backend>
GOOGLE_API_KEY=  GEMINI_MODEL=gemini-flash-latest
DEEPGRAM_API_KEY=  CARTESIA_API_KEY=
VIDEO_CHECK_SECONDS=15
VIDEO_CONFIRM_CHECKS=2
RECONNECT_GRACE_SECONDS=90      # how long to keep an interview open after a dropped connection
AI_INTERVIEW_MAX_MINUTES=20
```

- [ ] Agent deployed somewhere that stays running (Fly, Railway, a VM, Docker; any host with outbound internet)
- [ ] `MIRRACLE_WEBHOOK_URL` is reachable from the agent (the backend must be publicly reachable, not `localhost`)
- [ ] Optional company Q&A: `COMPANY_PDF_PATH=./company.pdf uv run python ingest.py` (skip if not wanted)
- [ ] Optional camera check dependency: `uv sync --extra images` if the agent reports a missing image library

## 6. Scheduler (required for reminders and cleanup)

Call this **every 15 minutes** from any scheduler (Render cron, GitHub Actions, cron-job.org):

```bash
curl -X POST "https://your-backend/internal/ai-interview/maintenance" \
     -H "Authorization: Bearer $AI_INTERVIEW_SHARED_SECRET"
```

It sends expiry reminders (once, within 24 h of expiry), closes interviews that got stuck without a
report (so the company can allow a retake), and applies transcript retention if configured.

- [ ] Scheduler created and returning 200

## 7. Frontend

No new env vars. Make sure the frontend points at the backend and is served over **https**
(browsers refuse camera and microphone on plain http, except on localhost).

- [ ] Frontend deployed over https

## 8. Manual test plan (the whole workflow, end to end)

Do this once after setup, before real candidates. Tick each line; write down anything that fails
(what you clicked, what you saw, any red error text, and the time) so it can be fixed.

### 8.0 What you need before you start
- Two browsers or one normal + one incognito window (so two accounts stay logged in).
- **Company account** (owner of a company, ideally with one posted job that has an applicant).
- **Candidate account** whose email is an inbox you can read. A second candidate account is useful for the edge cases.
- Laptop or desktop with a working camera and microphone, headphones (avoids echo), Chrome or Edge.
- The frontend on **https** (or `localhost`), the backend, and the agent all running. Keep the agent's log window open: it prints when it joins a room and when it posts the report.

### 8.1 Smoke test (5 minutes: does anything work at all?)
- [ ] Backend health: opening the backend URL `/docs` loads.
- [ ] Agent log says it is registered with LiveKit and waiting for jobs.
- [ ] Candidate: AI Interview tab loads with no red error, shows "N of 3 interviews left today".
- [ ] Company: Interviews tab loads (empty list is fine).
If any of these fail, stop and fix them before going further (usual causes: wrong env var, SQL not run, backend URL not reachable).

### 8.2 Practice interview (candidate only)
1. [ ] Open AI Interview, pick a track. The Continue button stays disabled until you tick **all three** boxes (rules, audio, camera).
2. [ ] Click "Test my camera and microphone": you see yourself, the mic bar moves when you talk, and "Everything works" returns you to the briefing without using an interview.
3. [ ] Continue to equipment check. Click **Block** on the camera prompt: Join stays disabled and a clear message explains how to fix it. Allow it, and repeat for the microphone.
4. [ ] Join. Waiting room appears, then the meeting room. **The AI speaks first** within ~15 s and responds to what you say.
5. [ ] Timer counts down, captions appear, your own camera tile shows.
6. [ ] Click End. You land on "Generating your report", then a report appears (scores, strengths, weaknesses, integrity section).
7. [ ] "Past interviews" now lists it. Counter shows 2 of 3 left.
8. [ ] Do two more. The 4th attempt is refused with "used all 3 for today".

### 8.3 Integrity monitoring (during a live interview)
Run one interview and deliberately do each of these; the on-screen banner should react and the event should appear in the report's integrity section afterwards.
- [ ] Switch to another tab for a few seconds, then come back: warning on return; "tab switch" logged.
- [ ] Click into another window (window blur): logged.
- [ ] Cover the camera with your hand for ~30 s: "camera blocked" banner (needs consent; takes a couple of 15 s checks).
- [ ] Step out of frame for ~30 s: "no face" banner; it clears when you return.
- [ ] Have a second person in frame: "multiple faces" banner.
- [ ] Unplug or disable the camera (or toggle it in OS settings): "camera lost" banner; a **Retry camera** button restores it.
- [ ] Mute or unplug the mic: "mic lost" banner; **Retry microphone** restores it.
- [ ] Press End normally: **no** false "camera lost" at the end.
- [ ] Untick camera consent (use a fresh interview, leave the camera box unticked): Continue stays disabled. Camera consent is mandatory.

### 8.4 Dropped connection and rejoin
- [ ] Turn wifi off for ~10 s, then back on: banner "Connection lost. Reconnecting…" then it recovers by itself and the interview continues.
- [ ] Turn wifi off for 30-60 s (longer than the browser can retry): "Connection lost" screen with **Rejoin interview** and **End interview**. After wifi is back, Rejoin puts you in the same interview with the remaining time; the AI carries on.
- [ ] Repeat the long drop but do not rejoin for longer than `RECONNECT_GRACE_SECONDS` (default 90 s): the agent closes and grades what was answered. Rejoin now fails with a clear message and the interview shows as ended.
- [ ] Rejoin after the time limit has passed: refused, shown as ended.
- [ ] Close the tab mid-interview: the browser asks for confirmation first.

### 8.5 Interviewer never joins
- [ ] Stop the agent. As a candidate, start a practice interview. After about 25 s you get "We couldn't start your interview", saying it did not count toward your daily limit.
- [ ] Check the counter on the briefing: unchanged (attempt refunded).
- [ ] Start the agent again and confirm the next interview works.
- [ ] Repeat with a **company** interview (section 8.7): the invitation is usable again afterwards.

### 8.6 Company: create an interview
1. [ ] Interviews tab, New AI interview.
2. [ ] Start from a preset OR type a role and click **Draft with AI**. A rubric appears; you can edit names, weights and seed questions. (Needs `GEMINI_API_KEY` on the backend; without it you should see a clear message, not a crash.)
3. [ ] Weights show percentages that always add up to 100.
4. [ ] Try to save with a blank title, duplicate competency names, weight 0, or duration 5: each is refused with a plain message.
5. [ ] Click **Preview candidate experience**: shows role, duration, topics by weight, and "candidates never see this rubric".
6. [ ] Link it to your job (optional). Save as draft, then **Activate**.
7. [ ] While it is a draft, the invite box is disabled.

### 8.7 Company: invite and the candidate's side
1. [ ] Invite by typing the candidate email (also try an invalid one and a duplicate: they are reported, not sent).
2. [ ] If the interview is linked to a job: the **Applicants** list shows applicants; tick one and send. Someone already invited is not listed again.
3. [ ] The invite appears in the list as "Invited", email "Sent".
4. [ ] Candidate inbox: invitation email arrives with the company, role, duration and a working link.
5. [ ] **Logged-out test:** open the link in a browser where the candidate is signed out. Log in. After login you land on that interview's briefing (not on the generic dashboard).
6. [ ] Candidate sees "Interviews from companies" above the practice section. Practice still works beside it.
7. [ ] The assignment briefing shows the company, role, instructions, "sent to {company}", and the note that a person makes the hiring decision.
8. [ ] Candidate: **Ask for an accommodation**, send a message. Company sees an "Accommodation requested" badge in the invite list and the message in the report sheet; the company also receives an email. Requesting twice is handled gracefully.
9. [ ] Company clicks **Extend** on that invite: candidate gets an updated email, deadline moves out.
10. [ ] Candidate takes the interview (same flow as 8.2). It does **not** use up the 3 practice interviews.
11. [ ] On finish the candidate sees **"Interview submitted"**, and **no report**. Their dashboard also shows no scores for it.
12. [ ] Candidate receives the submission confirmation email.
13. [ ] The same invite cannot be started a second time (shows as completed / not available).
14. [ ] Open the link as a **different** candidate account: it is refused (invites are tied to the invited account).

### 8.8 Company: results and decisions
1. [ ] Results tab: the candidate appears with status, score, AI recommendation, integrity count. The company owner got a "report ready" email.
2. [ ] Open the candidate: overall score, per-competency scores with evidence, strengths, weaknesses, red flags, transcript, question-by-question, consent record, integrity events with timestamps.
3. [ ] The overall score matches the weights (spot-check: weighted average of competency scores).
4. [ ] Edit the template rubric afterwards, then re-open the earlier candidate: they are still scored against the **original** rubric.
5. [ ] **Integrity review:** dismiss one candidate's flags with a note: the "with integrity flags" counter drops; confirm on another: stays flagged. Clear review works.
6. [ ] **Decision:** choose Advance, add an internal note, tick "Email the candidate", edit the message, Save. Check: toast confirms; the candidate receives that email; the linked job application moved to **shortlisted**.
7. [ ] Choose Reject with email: application becomes **rejected** (a candidate already marked hired is not changed). Choose **Hold**: no email option appears.
8. [ ] Sort by highest score, most flags, name, most recent; filter to flagged, no decision, incomplete.
9. [ ] **Export CSV:** opens in a spreadsheet; one row per candidate; a name starting with `=` shows as plain text, not a formula.

### 8.9 Retakes, stuck sessions, reminders (needs the scheduler)
- [ ] Start a company interview as a candidate, then kill the browser tab and never come back. After (time limit + 10 min) and the next scheduler run, the result shows **"No report"** (incomplete).
- [ ] Company clicks **Allow retake** on that row: the invite goes back to "Invited" with a "Retake 1" badge; the candidate gets a "new attempt" email; the old attempt is listed under "Earlier attempts" in the report sheet.
- [ ] Set an invite to expire within 24 h (create it with expiry 1 day): after a scheduler run the candidate gets **one** reminder email (run the scheduler again: no second email).
- [ ] An expired invite shows "Expired" to the company; **Extend** revives it. The candidate no longer sees an expired invite unless it was extended.
- [ ] Withdraw an invitation: the candidate can no longer start it.

### 8.10 Browser and device checks
- [ ] Safari and Firefox: open the briefing. Unsupported features show a clear blocking message rather than a broken page.
- [ ] A phone: shows the "laptop or desktop recommended" warning but is not blocked.
- [ ] http (non-https, non-localhost) page: Continue is blocked with the https message.
- [ ] A second monitor or Bluetooth headset: pick it in the equipment check dropdown and confirm the interview uses it.

### 8.11 Security and permission checks (quick, but important)
- [ ] A **candidate** account calling company URLs (for example open `/company/ai-interviews` API in the browser console) is refused.
- [ ] A **company** account cannot read another company's templates, invites or results (try the other company's ids).
- [ ] A candidate cannot read a company interview's report via the candidate reports list (company interviews never appear there).
- [ ] The maintenance and report endpoints reject a missing or wrong shared secret (curl without the header: 401).
- [ ] Send more than `AI_INTERVIEW_COMPANY_DAILY_INVITES` invitations in a day: refused with a clear message (set the limit to 2 to test).

### 8.12 Pass criteria
You can call the feature working when:
- Sections 8.1 to 8.8 pass fully on real accounts.
- In 8.3 at least tab switch, camera lost and mic lost are detected and logged.
- 8.4 and 8.5 behave as described (these depend on LiveKit and are the most likely to need a tweak).
- Emails arrive in a real inbox (not spam) for invite, confirmation, report ready and decision.

If something fails, send back: the section number, what you expected vs saw, the browser console
error, the agent log lines around that time, and the backend log line if any.

## 9. Things I could not verify (watch these on your first real run)

- LiveKit behaviour: room `empty_timeout`, the agent re-attaching when the same candidate rejoins, and `close_on_disconnect=False`. If rejoin shows the candidate in a room with no interviewer, start here.
- Real email deliverability (SPF/DKIM on your Resend domain).
- Gemini output quality for rubric drafting and grading with your real roles.
- Running `pytest tests` over the entire backend folder exits early during collection (`SystemExit: 0`); the AI suites pass when run by path:
  `python -m pytest tests/test_ai_interview.py tests/integration tests/unit`
- `tests/unit/lib.test.ts` has one pre-existing eslint error unrelated to this work.

## 10. Privacy and policy (before real candidates use it)

- [ ] Privacy policy mentions: voice transcribed and stored, camera frames checked by Google Gemini (not stored), integrity flags shared with the hiring company.
- [ ] Decide retention: set `AI_INTERVIEW_TRANSCRIPT_RETENTION_DAYS` if you do not want transcripts kept forever.
- [ ] Company terms: AI scores and integrity flags are recommendations; a person makes the decision.

## 11. Not built (out of scope)

Coding canvas or whiteboard, session replay, ATS integrations, desktop lockdown/proctoring.
