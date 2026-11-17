# Browser end-to-end tests

Real Chromium driving the real **frontend** (Vite dev server), the real **FastAPI backend**, and the real
**PeerMeet** signaling server + client. Only things that need a paid/remote service are replaced:

| Replaced | By |
|---|---|
| Supabase (Postgres via PostgREST + GoTrue auth) | in-memory fakes in `backend/tests/integration/fakes.py` |
| Gemini job scoring | a fixed 72% / weighted-composite result (`backend_server.py`) |
| LiveKit room/dispatch API | no-op stub (the signed participant token is still real) |
| Camera / microphone | Chromium fake media devices |
| Supabase Storage (OA camera snapshots) | in-memory store served from `/__e2e/files/` (`backend_server.py`) |

Code execution for online assessments is **real** (local judge), using the repo's own OA problem
library (`backend/db/seed/oa_problems.json`) and reference solutions.

## Run

```bash
cd e2e && npm install
npx playwright test            # starts all four servers itself (or reuses running ones)
npx playwright test specs/oa.spec.ts --headed   # one file
```

Needs `pip install -r backend/requirements.txt` and `npm install` in `frontend/`, `PeerMeet/client`,
`PeerMeet/server`. Chromium is taken from `/opt/pw-browsers/chromium-1194` (override with `CHROMIUM_PATH`,
e.g. an installed Chrome). Seeded accounts include `admin@e2e.dev` (every grant), `bare@e2e.dev` (no grants)
and `super@e2e.dev` (Super Admin).
Every test calls `POST /__e2e/reset` first, so the run is one worker, fully isolated, order-independent.

## Specs

| File | What it covers |
|---|---|
| `auth.spec.ts` | form login for all 4 portals, bad password, validation, wrong portal, route guards, reload persistence, sign-out, silent token refresh, revoked session, blocked account, password never in URL |
| `candidate.spec.ts` | dashboard tabs, job board, apply → scored, job detail, ineligible, past deadline |
| `oa.spec.ts` | assessment overview, consent, timed sections, real Run/Submit grading (accepted / wrong / compile / runtime / TLE), throttle, autosave across reload, one-way sections, answer-key secrecy, window gating, ownership |
| `company.spec.ts` | dashboard, job list filters, 4-step create-job wizard, applicants table, shortlisting |
| `company-assessment.spec.ts` | template assessment, invite-only gating, candidate solves, results back to company, tenant isolation |
| `oa-features.spec.ts` | the start screen's permissions step (camera consent, tips, one item opening after another), the multiple-monitor check (blocked / unverified / a display plugged in mid-test; hardware simulated by overriding `screen.isExtended`), Java/C++ in the editor (real judge), fake-camera snapshots + recruiter gallery, camera denied, optional/off modes, the builder's camera setting, fullscreen on Start, the post-submit feedback card (stars + comment, read by the recruiter), the integrity event timeline (paste text, tab leave/return), similarity flag + side-by-side |
| `college.spec.ts` | all pages, roster, add student, CSV upload (good + bad), search, export, campus drive, analytics |
| `admin.spec.ts` | KPIs, every sidebar page, date range, search, access control |
| `super-admin.spec.ts` | one sign-in page for both portals, neutral login errors, direct URLs, tampered `localStorage`, nothing shown before the backend answers, reload, logout revocation, the gold frame on every page, over a modal, while scrolling and at phone/tablet width, no leak into other portals |
| `admin-flows.spec.ts` | the write flows of both portals: block/unblock, add college, suspend/reactivate, create a delegated admin, grant/revoke, disable/re-enable, CSV export, empty and error states, an Admin with no grants, session expiry |
| `ai-interview.spec.ts` | session start (real LiveKit JWT), graceful media failure, quota, agent report webhook (secret, idempotent, ownership) |
| `peermeet.spec.ts` | real WebRTC between two browsers: connect, video frames, clock, full room, bad room id, controls, leave, AI setup + disclosure |
| `peer-journey.spec.ts` | dashboard matchmaking → both candidates in the same PeerMeet room, identity token, privacy toggle, queue cancel |
| `journey.spec.ts` | candidate applies → company shortlists → candidate sees round progress → TPO isolation; signup → onboarding |
| `smoke.spec.ts` | every public route, 404, sitemap, CORS, unauthenticated API, phone-width layout, shortlist/departments/reports |
