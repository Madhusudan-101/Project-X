# Browser end-to-end tests

Real Chromium driving the real **frontend** (Vite dev server), the real **FastAPI backend**, and the real
**PeerMeet** signaling server + client. Only things that need a paid/remote service are replaced:

| Replaced | By |
|---|---|
| Supabase (Postgres via PostgREST + GoTrue auth) | in-memory fakes in `backend/tests/integration/fakes.py` |
| Gemini job scoring | a fixed 72% / weighted-composite result (`backend_server.py`) |
| LiveKit room/dispatch API | no-op stub (the signed participant token is still real) |
| Camera / microphone | Chromium fake media devices |

Code execution for online assessments is **real** (local judge), using the repo's own OA problem
library (`backend/db/seed/oa_problems.json`) and reference solutions.

## Run

```bash
cd e2e && npm install
npx playwright test            # starts all four servers itself (or reuses running ones)
npx playwright test specs/oa.spec.ts --headed   # one file
```

Needs `pip install -r backend/requirements.txt` and `npm install` in `frontend/`, `PeerMeet/client`,
`PeerMeet/server`. Chromium is taken from `/opt/pw-browsers/chromium-1194` (override with `CHROMIUM_PATH`).
Every test calls `POST /__e2e/reset` first, so the run is one worker, fully isolated, order-independent.

## Specs

| File | What it covers |
|---|---|
| `auth.spec.ts` | form login for all 4 portals, bad password, validation, wrong portal, route guards, reload persistence, sign-out, silent token refresh, revoked session, blocked account, password never in URL |
| `candidate.spec.ts` | dashboard tabs, job board, apply → scored, job detail, ineligible, past deadline |
| `oa.spec.ts` | assessment overview, consent, timed sections, real Run/Submit grading (accepted / wrong / compile / runtime / TLE), throttle, autosave across reload, one-way sections, answer-key secrecy, window gating, ownership |
| `company.spec.ts` | dashboard, job list filters, 4-step create-job wizard, applicants table, shortlisting |
| `company-assessment.spec.ts` | template assessment, invite-only gating, candidate solves, results back to company, tenant isolation |
| `college.spec.ts` | all pages, roster, add student, CSV upload (good + bad), search, export, campus drive, analytics |
| `admin.spec.ts` | KPIs, every sidebar page, date range, search, access control |
| `ai-interview.spec.ts` | session start (real LiveKit JWT), graceful media failure, quota, agent report webhook (secret, idempotent, ownership) |
| `peermeet.spec.ts` | real WebRTC between two browsers: connect, video frames, clock, full room, bad room id, controls, leave, AI setup + disclosure |
| `peer-journey.spec.ts` | dashboard matchmaking → both candidates in the same PeerMeet room, identity token, privacy toggle, queue cancel |
| `journey.spec.ts` | candidate applies → company shortlists → candidate sees round progress → TPO isolation; signup → onboarding |
| `smoke.spec.ts` | every public route, 404, sitemap, CORS, unauthenticated API, phone-width layout, shortlist/departments/reports |
