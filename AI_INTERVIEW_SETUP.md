# AI Interview: what you need to do to make it work

Everything in code is done and tested with fakes. This file is the list of things only you can do
(accounts, keys, SQL, deployment, scheduler) plus a manual test plan to prove it works for real.

Work through it top to bottom. Tick each box.

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

## 8. Manual test plan (do this once, with two real accounts)

Use a company account and a candidate account with a real email you can read.

**Practice**
- [ ] Candidate: AI Interview tab → pick a track → accept three consents → equipment check → join. The AI speaks first and answers back.
- [ ] End the call. A report appears within seconds.
- [ ] Use all 3 daily practice interviews; the 4th is refused. Company interviews do not count toward this.

**Company side**
- [ ] Company: Interviews tab → New interview → "Draft with AI" (or a preset) → edit rubric → Activate.
- [ ] Invite the candidate's email. The candidate receives the email; the link opens their briefing, **including after logging in**.
- [ ] Candidate takes it. They see "Interview submitted" and **no report**. The confirmation email arrives.
- [ ] Company gets the "report ready" email, opens results, sees score per competency, transcript, integrity flags.
- [ ] Dismiss/confirm an integrity flag; set a decision with "email the candidate"; the linked job application status changes and the candidate email arrives.
- [ ] Sort, filter and export CSV.

**Failure paths**
- [ ] Block the camera in the browser at the equipment check: Join is refused with a clear message.
- [ ] During a live interview, turn wifi off for ~10 s, then on: "Reconnecting…" then back to normal.
- [ ] Turn wifi off for 30 s+: "Connection lost" screen; Rejoin continues the same interview.
- [ ] Stop the agent, start an interview: after ~25 s it cancels, says the attempt was not used, and the practice quota / invite is given back.
- [ ] Start a company interview, close the tab, wait past the time limit + 10 min and the next scheduler run: the invite shows "No report"; "Allow retake" gives a new attempt and emails the candidate.
- [ ] Candidate "Ask for an accommodation" on an assignment: company sees the badge and message; "Extend" works.

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
