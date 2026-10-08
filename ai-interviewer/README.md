# AI Interviewer (voice agent)

LiveKit voice agent that runs the dashboard's **AI Interview** tab: Deepgram STT → LangGraph/Gemini → Cartesia TTS.
It is its own long-running deployable (it cannot run inside the FastAPI app or the frontend).

## How it fits together

1. Candidate clicks *Start interview* → frontend calls `POST /candidate/ai-interview/session` (FastAPI, authenticated).
2. The backend checks the daily quota, creates the LiveKit room with `{domain, user_id, max_minutes}` in its metadata, records an `ai_interview_sessions` row and returns a join token that explicitly dispatches this agent (`AI_INTERVIEW_AGENT_NAME`).
3. The worker joins, reads the metadata, and runs the interview (`graph.py`).
4. When the interview ends (or the candidate disconnects / the time limit hits) the worker grades it and POSTs the structured report to `POST /internal/ai-interview-reports` with `AI_INTERVIEW_SHARED_SECRET`. The backend decides which student owns it from the session row — the worker never sends a user id and has no database access.
5. The frontend polls `GET /candidate/ai-interview/reports/{room}` until the report appears.

## Setup

```bash
cp .env.example .env.local   # fill in LiveKit, Google, Deepgram, Cartesia, shared secret
uv sync
uv run python agent.py download-files   # one-time model weights
uv run python agent.py dev              # local; use `start` in production
```

Backend: apply `backend/db/ai_interview_migration.sql`, set the `LIVEKIT_*` and `AI_INTERVIEW_*` vars from `backend/.env.example`
(the shared secret and agent name must match this worker's).

Optional company Q&A: `COMPANY_PDF_PATH=./company.pdf uv run python ingest.py`. Without it the interviewer simply can't answer company questions.

## Deploy

`Dockerfile` builds the worker. Run it anywhere that can hold an outbound WebSocket to LiveKit open (Fly.io, Railway, Render, a VM, or LiveKit Cloud Agents). Needs `MIRRACLE_WEBHOOK_URL` to reach the backend.
`noise_cancellation.BVC()` requires LiveKit Cloud; remove it if you self-host LiveKit.

## Known limits

- Interview state is in memory per job: a worker restart mid-interview ends it (a partial report is still produced on a clean disconnect).
- Domains are fixed to AI/ML, Web Dev, DSA (`domains.py`, mirrored in `backend/app/routers/candidate/ai_interview.py` and the SQL CHECK constraints).
