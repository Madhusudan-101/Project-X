# PeerMeet: implementation plan (bug fixes + features)

Branch: `feat/peermeet-end-to-end` (cut from `main`; separate from the AI interview branch).

**Status of the evidence**
- Integration audit (main app ↔ PeerMeet): done. Findings below marked **[audit]** came from reading
  `backend/app/routers/candidate/peer.py`, `peer_reports.py`, the SQL migrations and the frontend
  components. **Each is re-verified against the code (and given a failing test) before it is fixed.**
- Standalone PeerMeet app audit (Node server + React client): done, by code reading (the app was not
  run in a browser). Items marked **[standalone]** come from it. Same rule: verified and given a failing
  test before each fix.
- Baseline measured: PeerMeet server tests 26 unit + 11 integration pass; backend peer tests 31 pass;
  PeerMeet client builds; the PeerMeet client has **no** tests.

**What PeerMeet is today:** a separate app (Node/Socket.IO signaling + React/WebRTC client). Candidates
reach it from the dashboard via a matchmaking queue, a scheduled meeting or a room ID. It opens in a new
tab with a 10-minute identity token. Inside: 2-person video, optional AI mock-interview mode (Gemini
questions, Deepgram captions), per-candidate report posted back to FastAPI.

---

## Phase 0: decisions I need from you (defaults chosen so work can start)

| # | Question | Default if you do not answer |
|---|---|---|
| 1 | Keep PeerMeet as a separate deployed app, or move the meeting room inside the dashboard? | Keep separate (far less risk); make it look and behave like part of the product |
| 2 | Moderation: who reviews abuse reports? | Admin portal page, existing admin accounts |
| 3 | Penalties | 3 reports from 3 different people in 30 days = automatic 7-day peer suspension pending admin review |
| 4 | Evidence retention for reports | Last 200 transcript lines + metadata, kept 90 days; no audio/video is ever stored |
| 5 | Are real names shown to a matched peer? | Only if that person turned privacy OFF (privacy ON by default, as today) |
| 6 | Email provider | Existing Resend setup (`oa_emails.send_email`) |

---

## Phase 1: critical bug fixes (do first; each with a failing test first)

1. **Matched ticket never ends, so users can only be matched once** [audit]
   - Fix: when a match is made set an `ended_at`/`status` lifecycle: `matched → completed` on report or when
     the meeting window passes, `matched → expired` after a timeout (e.g. 30 min), `cancel` also works on `matched`.
   - Step 1 of `/peer-matchmaking/request` must ignore stale matched tickets; the unique index becomes
     "one `waiting` or *fresh* `matched`".
   - Add a "Leave / end session" action that really ends it server-side (today "End" only clears localStorage).
   - Migration: `peer_matchmaking_lifecycle_migration.sql` (+ keep the consolidated `apply_...` file in sync).
2. **Matched peer's real name ignores their privacy setting** [audit]
   - Fix: use the RPC's `peer_private`; mask on the *peer's* flag everywhere: match status, `/peer-reports`
     partner name, scheduled lists. Never fall back to email as a display name.
   - Test: privacy-on peer is never named in any response.
3. **Room IDs exposed to everyone; room auth bypass** [audit]
   - Fix: stop returning `room_id` on the public upcoming list; only return it from `/join` after the
     creator/invitee/open check.
   - Bind the PeerMeet token to a single `room_id` (claim `room`), and make the PeerMeet server require it
     for rooms created by the dashboard (anonymous rooms keep working for the standalone use).
   - `/peer-session-token` must verify the caller is allowed in that room before minting.
4. **Unregistered invitee email silently makes the meeting public** [audit]
   - Fix: an `invitee_email` that is not found creates an *invite-only-by-email* meeting (stores
     `invitee_email`, resolved when that person signs up) or fails with a clear message. Never `is_open=true`
     by accident. UI warns before creating an open meeting.
5. **RLS over-share on `peer_scheduled_meetings`** [audit]
   - Fix: drop `authenticated_select_public_peer_scheduled`; the API (service role) is the only reader.
     Migration + SQL test on scratch Postgres.
6. **Report webhook not idempotent, not validated, can lose reports** [audit]
   - Fix: unique key on `(room_id, student_id, role, phase)`, `on conflict do update`; validate both
     student ids exist (return 422, not 500); PeerMeet sender retries with backoff and a small on-disk or
     in-memory queue; completing the scheduled meeting only when the *final* report arrives, not the
     role-switch report.
7. **Ghost waiting tickets** [audit]
   - Fix: heartbeat from the modal every 5 s; tickets without a heartbeat for 20 s are not matchable.
     Replace "Position in queue: you" placeholder with real elapsed time + 2-minute "no one yet" fallback
     (offer to schedule instead).
8. **Scheduled-meeting cleanup** [audit]
   - Fix: a maintenance endpoint (same pattern as the AI interview one) marks `scheduled/waiting` meetings
     past their window as `expired`/`no_show`; "cancel" after `waiting` returns 409, not a silent 204.
9. **Single shared secret signs tokens and authenticates the webhook** [audit]
   - Fix: two secrets (`PEERMEET_TOKEN_SECRET`, `PEERMEET_WEBHOOK_SECRET`) with a fallback so existing
     deployments keep working; add a timestamp + HMAC body signature to the webhook (replay window 5 min).
10. **Standalone PeerMeet app: real-time bugs** [standalone]
    - Browser "Stop sharing" button leaves the peer sending a dead track (only the in-app button swaps back
      to the camera); `toggleVideo` while sharing flips the *screen* track, not the camera.
    - `handleReady` in `useWebRTC.js` lacks a guard for `initiatorId == null` (builds a peer to `null`).
    - Double-end and double-switch races: `endInterviewForRoom` and `switch-roles` set their "done" flag
      only after a long await, so a manual end plus the timer (or a second click) sends duplicate reports
      and webhooks and can flip roles twice. Fix: set the flag before the await.
    - `interview:start` can be re-sent (resets deadline/timer, re-calls Gemini) and is not blocked after end.
    - Stale analysis after a role switch writes old-phase data into the new phase and emits an
      interviewer-only event to the new candidate. Fix: capture a phase id and drop stale results.
    - Transcription recorder race on reconnect (`onstop` nulls a newer recorder's ref) can leave
      duplicate/orphan streams.
    - Socket reconnect gives up after 5 attempts with no UI; `join-room` is gated on camera/mic being
      acquired, so a user who denies permission never joins and the partner waits silently.
    - A leaving participant's slot is never released (no leave vs drop distinction, no room TTL).
    - Reports exist only in memory (lost if both drop or the server restarts); fallback "Unavailable"
      reports with null scores are posted as if real; the report is not sanitized (types/ranges/lengths);
      only the candidate gets a report (interviewer gets nothing, `role: interviewer` never sent).
    - Transcript panel: partner shown as "Participant", no auto-scroll, unbounded growth; Safari mp4
      audio to Deepgram unverified.
    - Home "Join" accepts any 8+ chars (a pasted URL becomes a bogus room id); Switch roles / End interview
      have no confirmation.
    - README/CHANGELOG drift: no mention of the shared secret, webhook URL, token/room/init/private
      handoff; "no media passes through the server" is false (mic audio goes to Deepgram); "authenticated
      socket" is false; production config check omits the secret and webhook URL.

---

## Phase 2: safety and the Report feature (your explicit ask)

### 2.1 Data model (`peer_safety_migration.sql`)
- `peer_user_reports`: `id, reporter_id, reported_id, room_id, meeting_id (nullable), reason` (enum:
  harassment, inappropriate_content, impersonation, cheating_or_sharing_questions, spam, no_show, other),
  `details` (≤1000), `evidence` (jsonb: last 200 transcript lines + timestamps + both display names at the
  time), `status` (open, reviewing, actioned, dismissed), `resolution_note`, `reviewed_by`, `reviewed_at`,
  `created_at`. Unique `(reporter_id, reported_id, room_id)` so one report per meeting.
- `peer_blocks`: `blocker_id, blocked_id, created_at`, unique pair.
- `peer_sanctions`: `student_id, kind` (warning, suspension), `reason, starts_at, ends_at, created_by,
  report_id`.
- RLS: service role only; reporters can read only their own reports' status.

### 2.2 Backend
- `POST /candidate/peer-reports/abuse` (report a person) and `GET .../mine` (my reports + status only).
- `POST/DELETE/GET /candidate/peer-blocks`.
- Block is symmetric in effect: matchmaking never pairs blocked↔blocker; invite/join refused; a blocked
  user is not told they were blocked.
- Sanctions: a suspended student cannot enter matchmaking, schedule, join or get a token (clear message
  with end date). Automatic rule from Phase 0 #3.
- Webhook `/internal/peer-abuse` so a report raised *inside* the meeting carries server-side evidence
  (PeerMeet server holds the transcript buffer; the browser cannot forge it).
- Rate limits (per user, in-process with a shared-store option): token mint 10/min, matchmaking 60/min,
  meeting creation 10/day and no overlapping slots, abuse reports 10/day.
- Admin portal: "Peer safety" page: queue of open reports, evidence view, actions (dismiss, warn,
  suspend N days, ban), audit log entries.

### 2.3 Frontend
- In the meeting (PeerMeet): a clear **Report** button in the controls and participant tile menu. Flow:
  reason → details → "Leave the meeting and block this person" checkbox → confirm. The reported person is
  not notified in-call.
- In the dashboard: report/block from meeting history and from a report; "Blocked people" list in
  settings with unblock.
- Safety notice text everywhere: what is shared, that reports are reviewed by people, that false reports
  can lead to penalties.

### 2.4 Other security hardening
- **Critical, from the standalone audit:**
  - No socket authentication at all: the token is an optional field and bad tokens silently become
    anonymous. Fix: dashboard-created rooms (room id registered by FastAPI) require a valid room-bound token
    (`aud`, `jti`, required `exp`, `room` claim); standalone anonymous rooms stay possible but are separate.
  - **`signal` relay is unauthenticated**: `io.to(to)` accepts any socket id or room name, so an outsider
    who knows a room id can inject signals. Fix: relay only to the sender's partner in the sender's own room.
  - **Interviewer takeover:** any member can `interview:configure`/`start` first and, with
    `whoStarts: interviewer`, become the interviewer and see the AI panel. Fix: only the room host
    (creator, or the first token holder) may configure/start; candidate cannot.
  - **XSS in the printable report:** Gemini/transcript text is written unescaped into a same-origin
    popup via `document.write`. Fix: escape every field, drop `document.write` for a safe print view,
    open with `noopener`; also sanitize the report server-side.
  - **Paid-API and TURN abuse:** per-IP and per-room caps, room-creation cap, audio chunk size limit,
    global daily budget; TURN credentials issued only to authenticated sockets, short-lived per room.
  - Validate `roomId` and `participantId` format/length (server currently accepts any string); room id
    from 12 hex (48 bits) to 24+ hex; rate-limit `join-room` and stop the `room-not-found` enumeration oracle.
  - JWT: require `exp`, add `aud`/`iss`/`jti`, reject long-lived tokens, never use the query-string
    fallback, take `private` from the signed token, not the URL.
  - Stop logging room ids, participant ids and every signal; keep the Metered key out of URLs/logs.
  - Consent before audio: mic audio currently streams to Deepgram on join, including plain meetings.
    Fix: transcription only after explicit consent from that person (default off for non-interview calls).
  - Disclaimer: reports say "Hire/Maybe/Reject"; change to practice wording ("Strong practice / Needs work")
    so it is not read as a hiring verdict.
- Socket handshake: require a valid token for dashboard-created rooms; reject anonymous join to them.
- Strip/escape names and transcript text (XSS), cap lengths, validate every event payload shape.
- Interviewer-only events authorized by role server-side (confirm in audit; add tests).
- Remove emails from any displayed name; remove secret/PII from logs; token never in URLs except the
  fragment, cleared after read.
- CORS strict list, `helmet`-style headers on the Node server, TURN credentials only after auth.
- Retention job: delete stored evidence after 90 days and old report transcripts per policy.

---

## Phase 3: screens (every step of the journey)

Main dashboard:
1. **Peer Interview home** (replaces the small card): what it is, upcoming meetings, "Find a partner",
   "Schedule", history, safety link.
2. **Guidelines and code of conduct** (first-use gate + always reachable): be respectful, no sharing
   questions, no recording the call, no contact-detail harvesting, practice not hiring, consequences. Must be
   accepted once (stored with version + timestamp), re-prompted on version bump.
3. **Permissions and privacy explainer**: camera/mic use, what is sent to Deepgram/Gemini, what the peer
   can see (name only if privacy off), what is stored, how to report. Consent checkboxes before the first
   match or join (same pattern as the AI interview briefing).
4. **Matching setup**: role/domain, level, preferred language, privacy toggle, optional "avoid people I met".
5. **Pre-join lobby** (before opening the meeting): device check with live preview and mic meter,
   permission-denied recovery steps, partner summary (or "Anonymous Candidate"), what to expect, Join button.
6. **Waiting/matching screen**: real elapsed time, cancel, fallback to scheduling, no fake queue text.
7. **Scheduling**: timezone shown and selectable, invitee by email with unregistered-email behaviour
   explained, reschedule, cancel, RSVP (accept/decline), "add to calendar" (.ics download).
8. **Post-meeting feedback**: rate the experience and the partner (1–5 + tags), optional report/block entry,
   shows when the report is ready.
9. **Report detail page** (question timeline, topics, suggestions) and **history page** (all meetings,
   statuses, filters, pagination). Meeting ↔ report linked.
10. **Settings**: default privacy, timezone, preferred domain/level, notification preferences, blocked people.

PeerMeet app (the real meeting screen):
11. **Join/lobby screen** inside PeerMeet for direct links (device test, name, rules acknowledgement).
12. **Meeting room layout**: large remote video, self view picture-in-picture, pin/swap, screen-share
    layout, connection quality indicator, timer, scheduled end countdown with 5-minute warning,
    device switcher (camera/mic/speaker) mid-call, keyboard shortcuts, responsive mobile layout.
12b. **Real fixes to controls**: show the partner's real mic/camera state (hard-coded "on" today), a
    local-mute indicator for the remote side, join-link copy (not just the bare room id), fullscreen.
13. **In-call chat** (text, with report on messages) and a participant panel (names, mic/camera state,
    role).
14. **Leave and end dialogs** (leave vs end for both; what happens to the report), "Meeting ended" screen
    with feedback entry and a link back to the dashboard.
15. **Clear error and recovery states**: permission denied (per device), partner left (wait for rejoin
    with countdown), connection lost/reconnecting, room full, room expired.
16. **Accessibility** (today: modals have no `role=dialog`/focus trap/Escape, no `aria-live` on toasts or
    transcript, unlabeled report close button, no captions toggle): focus order, labels, captions toggle, high-contrast safe colors, screen-reader
    announcements for join/leave.

---

## Phase 4: scheduling, notifications and lifecycle

- Emails (Resend): invitation to invitee, accepted/declined to creator, 24 h and 15 min reminders, "your
  partner is waiting", report-ready, cancellation, suspension notice. In-app notification bell for the same.
- Maintenance job `POST /internal/peer/maintenance` every 5 minutes (shared secret): reminders (once each),
  expire stale tickets/meetings, mark no-shows, retention.
- No-show handling: after 10 minutes with only one joiner the meeting becomes `no_show` for the absent
  person and the waiting person is offered a rematch; repeated no-shows lower matching priority.
- Rejoin-after-drop already exists in PeerMeet; surface it in the dashboard ("Rejoin your meeting").

## Phase 5: matching quality

- Preference-aware matching: same domain/role, compatible level, language, optional college exclusion,
  never previously blocked/reported, avoid the last N partners.
- Timezone-aware scheduled "open slots" board instead of one global list.
- Optional availability slots per user.

## Phase 6: tests (written with each phase, not at the end)

- Backend: extend the in-memory fake tests for every Phase 1 bug (failing first), new safety endpoints,
  sanctions, rate limits, webhook idempotency/auth/replay; scratch-Postgres run of all peer migrations twice
  including RLS checks; real-Postgres concurrency test for the matcher.
- PeerMeet server: socket authorization tests (anonymous to dashboard room refused, wrong-room token
  refused, interviewer-only events), report relay, evidence capture.
- Frontend (vitest): modal, lobby, guidelines gate, report/block flows, history, settings, schedule form
  (timezone), feedback.
- PeerMeet client: first tests (there are none today): lobby, controls, report dialog, error states.
- E2E (Playwright, real WebRTC already set up in `e2e/`): match two users twice in a row, privacy masking,
  invite-only join, report + block then no re-match, scheduled meeting join window.
- Mutation checks on the privacy, authorization and block rules.

## Migrations that will be added

`peer_matchmaking_lifecycle`, `peer_scheduled_rls_fix`, `peer_reports_idempotency`, `peer_safety`
(reports/blocks/sanctions), `peer_feedback_and_prefs`, `peer_notifications`. All idempotent, validated
twice on scratch Postgres 16, and listed in a single run-order in `PEERMEET_SETUP.md` (same style as
`AI_INTERVIEW_SETUP.md`).

## Order of work and rough size

| Step | Content | Size |
|---|---|---|
| A | Phase 1 items 1–9 with tests | large |
| B | Phase 2 backend + admin page + PeerMeet report/block UI | large |
| C | Phase 3 dashboard screens 1–10 | large |
| D | Phase 3 PeerMeet screens 11–16 | large |
| E | Phase 4 notifications, maintenance, no-show | medium |
| F | Phase 5 matching preferences | medium |
| G | Setup/test doc, full verification, summary | small |

Each step is committed and pushed to `feat/peermeet-end-to-end` as it finishes.

## What I cannot verify from here (will flag again at the end)
Real browsers over real networks (TURN/NAT), real Deepgram/Gemini/Metered/Resend accounts, real Supabase
RLS beyond a scratch Postgres, and multi-instance behaviour of the Node server.
