# Testing

Everything runs offline — no Supabase, Gemini, LiveKit or Deepgram credentials are needed.
External services are replaced by in-memory fakes; the real FastAPI app, routers, auth
dependencies and schemas are exercised.

| Layer | Where | Run |
|---|---|---|
| Backend unit | `backend/tests/unit/` | `cd backend && python -m pytest tests/unit` |
| Backend integration (HTTP → routers → fake Supabase) | `backend/tests/integration/` | `cd backend && python -m pytest tests/integration` |
| Backend (both) | | `cd backend && python -m pytest` |
| Backend legacy scripts (admin API, college access, OA, peer matchmaking) | `backend/tests/test_*.py` | `cd backend && python tests/<name>.py` (`test_ai_interview.py` via `python -m pytest tests/test_ai_interview.py`) |
| Frontend unit + integration | `frontend/tests/` | `cd frontend && npm test` |
| PeerMeet signaling unit | `PeerMeet/server/tests/roomManager.test.js` | `cd PeerMeet/server && npm run test:unit` |
| PeerMeet signaling integration (real socket.io) | `PeerMeet/server/tests/peermeet-integration.test.js` | `cd PeerMeet/server && npm test` (needs `npm i` in `PeerMeet/client` too) |
| AI interviewer report client | `ai-interviewer/tests/` | `cd ai-interviewer && python -m pytest tests` |

Install: `pip install -r backend/requirements.txt pytest` · `npm install` in `frontend/`, `PeerMeet/client`, `PeerMeet/server`.

## What is covered

**Unit** – email rules, HTML sanitiser, branch matching, roster CSV parsing, profile-link extraction,
practice ranking, resume diff/merge, request schemas (jobs, drives, students, auth, grants), weighted
scoring maths, the code-judge (comparison, verdicts, real local Python/JS execution incl. timeouts and
output spoofing), OA template selection, admin plumbing (date ranges, paging, CSV export, formula
neutralising), block rules; on the frontend the formatters, Skill-DNA, role routing, stores, API client
(refresh/retry/dedupe), HTML sanitiser, PeerMeet tab opener.

**Integration** – signup → OTP → login → refresh → reset → block; company roles/jobs/drives/rounds and
applicants (including tenant isolation); college roster CRUD, CSV upload/export, shortlist, drives,
departments, dashboard; candidate board/eligibility/apply/screening/tracker; frontend
login → authenticated call → token expiry → logout with store clean-up and the route guard.

**Combined** – `test_full_journey_company_college_candidate`: company signs up and publishes a job, opens a
drive at a college, the TPO uploads the roster, a candidate signs up, onboards, sees the job, applies,
is scored, the company ranks/shortlists, the candidate sees the new status, the job is closed, and a
second company can see none of it.
