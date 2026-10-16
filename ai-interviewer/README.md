# AI Interviewer (voice agent)

LiveKit voice agent that runs the dashboard's **AI Interview** tab: Deepgram STT → LangGraph/Gemini → Cartesia TTS.
It is its own long-running deployable (it cannot run inside the FastAPI app or the frontend).

## How it fits together

1. Candidate clicks *Start interview* → frontend calls `POST /candidate/ai-interview/session` (FastAPI, authenticated).
2. The backend checks the daily quota, creates the LiveKit room with `{domain, user_id, max_minutes}` in its metadata, records an `ai_voice_interview_sessions` row and returns a join token that explicitly dispatches this agent (`AI_INTERVIEW_AGENT_NAME`).
3. The worker joins, reads the metadata, and runs the interview (`graph.py`).
4. When the interview ends (or the candidate disconnects / the time limit hits) the worker grades it and POSTs the structured report to `POST /internal/ai-interview-reports` with `AI_INTERVIEW_SHARED_SECRET`. The backend decides which student owns it from the session row — the worker never sends a user id and has no database access.
5. The frontend polls `GET /candidate/ai-interview/reports/{room}` until the report appears.

## Video check (consent required)

The interviewer can look at the candidate's camera, but only if the candidate explicitly allowed it.

- **Consent:** the briefing screen has a separate "allow the AI interviewer to view my camera" checkbox. `POST /candidate/ai-interview/session` refuses to start without `videoConsent: true`, stores `video_consent` on the session and stamps `video_consent: true` into the room metadata.
- **Worker:** `agent.py` reads that flag. Without it, `video_monitor.py` unsubscribes from the candidate's video track and never reads a frame. With it, every `VIDEO_CHECK_SECONDS` (default 15) one small JPEG frame is sent to the Gemini model and checked for three things only: no face, more than one person, camera blocked. A problem is flagged after `VIDEO_CONFIRM_CHECKS` (default 2) checks in a row, once per episode, and cleared when a normal frame is seen.
- **What the candidate sees:** a live banner in the interview room (LiveKit data topic `integrity`), so supervision is never silent.
- **What is stored:** only the kind of problem and its time (`ai_voice_interview_integrity_events`, `source = 'agent'`), posted to `POST /internal/ai-interview-integrity`. The backend rejects these if the session has no video consent. No frames or video are saved anywhere.
- **What it does not do:** it does not judge gaze, expression or appearance, it never feeds the interview LLM, and it does not change the score. Flags appear in the candidate's report as a "Session integrity" section.
- Frames are processed by the same Google Gemini model family the interview already uses. Mention this in your privacy policy.

Apply `backend/db/ai_interview_integrity_migration.sql` for the consent column and the events table.

## Setup

```bash
cp .env.example .env.local   # fill in LiveKit, Google, Deepgram, Cartesia, shared secret
uv sync
uv run python agent.py download-files   # one-time model weights
uv run python agent.py dev              # local; use `start` in production
```

Backend: apply `backend/db/ai_voice_interview_migration.sql`, set the `LIVEKIT_*` and `AI_INTERVIEW_*` vars from `backend/.env.example`
(the shared secret and agent name must match this worker's).

Optional company Q&A: `COMPANY_PDF_PATH=./company.pdf uv run python ingest.py`. Without it the interviewer simply can't answer company questions.

## Deploy

`Dockerfile` builds the worker. Run it anywhere that can hold an outbound WebSocket to LiveKit open (Fly.io, Railway, Render, a VM, or LiveKit Cloud Agents). Needs `MIRRACLE_WEBHOOK_URL` to reach the backend.
`noise_cancellation.BVC()` requires LiveKit Cloud; remove it if you self-host LiveKit.

## Known limits

- Interview state is in memory per job: a worker restart mid-interview ends it (a partial report is still produced on a clean disconnect).
- Domains are fixed to AI/ML, Web Dev, DSA (`domains.py`, mirrored in `backend/app/routers/candidate/ai_interview.py` and the SQL CHECK constraints).


## Database (Supabase SQL editor), in this order

Run each file once; they are safe to run again.

1. `backend/db/ai_voice_interview_migration.sql` — practice interviews and reports
2. `backend/db/ai_interview_integrity_migration.sql` — consent columns and integrity events
3. `backend/db/ai_interview_hiring_migration.sql` — company interviews, invites, rubric snapshots
4. `backend/db/ai_interview_lifecycle_migration.sql` — reminders, retakes, accommodations, flag review

## Scheduled upkeep

Call this every 15 minutes from any scheduler (Render cron, GitHub Actions, cron-job.org):

    curl -X POST "$BACKEND_URL/internal/ai-interview/maintenance" \
         -H "Authorization: Bearer $AI_INTERVIEW_SHARED_SECRET"

It sends expiry reminders (once, 24h before), closes interviews stuck without a report, and
applies the optional transcript retention. Invitation, report-ready and outcome emails need
`RESEND_API_KEY`, `OA_EMAIL_FROM` and `APP_BASE_URL` on the backend; without them the app still
works and tells the hiring team that nothing was emailed. AI rubric drafting needs `GEMINI_API_KEY`.

## Connection drops

If the candidate's connection drops, the agent waits `RECONNECT_GRACE_SECONDS` (default 90)
before ending the interview, and the candidate can rejoin from the "Connection lost" screen
while time remains.
