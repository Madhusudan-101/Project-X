# Mirracle: feature status (what is built, what is not)

Snapshot: 2026-11-18, branch `claude/blissful-clarke-7kqvmy`.

How this was produced: every area below was checked against the code, the setup docs and the migrations, and the
automated test suites were run (results in section 13). Nothing was exercised against real Supabase, LiveKit,
Deepgram, Cartesia, Gemini, Resend, Metered or Piston accounts, so "done" never means "verified with the real
service". Each section says what that leaves unverified.

## Legend

| Mark | Meaning |
|---|---|
| ✅ | Done: the code exists, is wired end to end, and its automated tests passed when run |
| 🟡 | Partial: it works, but the gaps named next to it are real |
| ❌ | Not done: no working code, or only a placeholder |

---

## 0. At a glance

| Area | Overall | One-line reason |
|---|---|---|
| Accounts, login, onboarding | ✅ | All four roles work; admin and college accounts are provisioned, not self-signup |
| Candidate: jobs, apply, scoring, tracker | ✅ | Complete, but the score never uses OA results |
| Candidate: resume / LinkedIn analysis | ✅ | Built and tested with fakes; real AI output quality not verified |
| Candidate: Skill DNA | 🟡 | Browser-only keyword view, not stored, no history |
| Company: jobs, drives, applicants | ✅ | Complete; live rounds and AI-round scores are not |
| Company: Online Assessment | ✅ | Complete and the best-tested feature |
| Company: AI interview | ✅ | Complete; needs a separate agent service to run |
| College portal | 🟡 | Roster/access/drives work; 4 areas are placeholders |
| Admin portal | 🟡 | Analytics + a few actions work; Finance is empty, no approvals |
| PeerMeet | 🟡 | Core + safety done; matching is topic-only; several plan items not built |
| Cross-portal glue (notifications, offers, sync) | ❌ | The weakest part of the product |
| Billing, plans, ATS, mobile, CI/CD | ❌ | Not started |

---

## 1. Accounts, identity and onboarding

| Feature | Status | Details |
|---|---|---|
| Candidate signup, OTP verification, login, token refresh, logout | ✅ | `/auth/*`; covered by integration and browser tests |
| Company signup | ✅ | Separate `/auth/company-signup` |
| Google sign-in | 🟡 | Endpoint and button exist (`oauth-session`); not verified with a real Google project |
| Forgot / reset / set password | ✅ | Set-password email is how provisioned accounts get access |
| Role guard | ✅ | Public signup can only create candidate or company; a DB trigger stops users editing their own role |
| Account blocking | ✅ | Enforced on every request, refresh and sign-in; also in RLS helpers (`tpo_access_hardening_migration.sql`) |
| Candidate profile setup | ✅ | Name, headline, location, bio, degree, branch, graduation year, domain, roles of interest, skills |
| Candidate profile settings | ✅ | CGPA, skills, roles, sponsorship need/country, preferred locations |
| Company onboarding | ✅ | 3 steps: company details, point of contact, legal and consent |
| College onboarding | ✅ | 5 steps: institute identity, point of contact, scale and context (including departments), platform intent, legal and consent; consent versions stored |
| Admin accounts | 🟡 | Only via `provision_admin.py`; no self-service |
| College accounts | 🟡 | Only created by an admin; a legacy self-registered college account is replaced, never adopted |
| Verifying that a student really belongs to a college | ❌ | College is self-declared; the code creates a college record if the typed name does not exist |
| Company verification / approval | ❌ | No approval step found; admin company views are read-only |
| Identity verification (ID, face match) | ❌ | Not built anywhere |
| Account deletion / data export | ❌ | Not found |

---

## 2. Candidate portal

### 2.1 Navigation and dashboard
| Feature | Status | Details |
|---|---|---|
| Tabs: Overview, Jobs, Analyzer, Practice, AI Interview, Skill DNA | ✅ | |
| Overview module cards | ✅ | AI Interview, Peer Interview, Resume Analyzer, LeetCode Practice, Skill DNA |
| Upcoming and scheduled peer meetings | ✅ | |
| Notification bell | ❌ | Decorative: permanent dot, no handler, no notification system behind it |
| "Run intro mock" button | ❌ | Appears to have no handler |
| Expert Interview | Removed | It was only a card with no backend; deleted in the latest commit |

### 2.2 Jobs, applications and scoring
| Feature | Status | Details |
|---|---|---|
| Job board | ✅ | Shows only live drives at the student's own college whose deadline has not passed; filtered by domain |
| Eligibility check | ✅ | Min CGPA, branches, batch years; the reason is shown when ineligible |
| Job detail | ✅ | Deadline, rounds, on-campus flag, eligibility result |
| Apply | ✅ | Requires a prior resume analysis (otherwise 409); the apply deadline is enforced on the server |
| AI-drafted cover letter and screening answers | ✅ | Needs Gemini; company-defined screening questions are supported |
| Job-scoped scoring | 🟡 | 5 dimensions weighted per job. **Assessment is hard-coded "unavailable", so OA results never count.** Interview uses AI-practice history only (PeerMeet excluded on purpose) |
| Application tracker | ✅ | Status plus "Round X of Y" progress |
| Per-round results visible to student | ✅ | Round N+1 appears only after shortlisted in round N |
| Prep plan per application | ✅ | Time-boxed, from the score and that job's real rounds |
| Resume tailoring per job | ✅ | Section rewrite, diff, editable, PDF render; told never to invent experience |
| Saved jobs, job alerts, off-campus / open jobs | ❌ | A student sees nothing if their college has no live drive |
| "Why was I rejected" feedback | ❌ | Student sees only a status |
| Offer accept / decline / joined | ❌ | Statuses end at `hired` |

### 2.3 Resume, LinkedIn, practice, Skill DNA
| Feature | Status | Details |
|---|---|---|
| Resume analysis (PDF) | ✅ | Discrepancies, role fit (matched/missing skills), strengths, weaknesses, resume corrections, 7-day action plan, overall rating |
| Portfolio verification | ✅ | GitHub / LeetCode / Codeforces fetched live; usernames auto-detected from links inside the PDF; repo links existence-checked (capped) |
| Smart re-analysis | ✅ | Unchanged re-upload reuses the cached result; small edit patches the previous analysis; large edit re-audits |
| Hygiene checks | ✅ | One-page rule for students, claim density vs timeframe, sloppy editing |
| LinkedIn analysis (Save-to-PDF export) | ✅ | Validity check, per-section rating (Strong / Needs Work / Missing), cross-check against the resume, green and red flags, score |
| Sync GitHub / LeetCode / Codeforces | ✅ | `/api/sync/*` |
| LeetCode practice | ✅ | Weakest topics ranked from your solved counts, with real problem links |
| Skill DNA | 🟡 | 6 dimensions (DSA, System Design, Backend, Frontend, DevOps, ML/AI) scored from the resume's matched skills by keyword, 30 points each, capped at 100. Computed in the browser; **not stored, no history, no use of GitHub/LeetCode/interview data** |
| Resume builder | ❌ | Analyze and tailor only |
| Shareable verified profile | ❌ | |
| Progress over time (score history charts) | 🟡 | Analyses are stored per run, but no history view was found |

Not live-verified: all Gemini output quality (the sandbox's Gemini key was blocked). Tests cover schemas, weights,
diff logic and fallbacks with fake model output.

---

## 3. Company portal

| Feature | Status | Details |
|---|---|---|
| Company profile (view/edit) | ✅ | |
| Roles (create, edit, delete, publish, archive) | ✅ | A separate "role posting" feature; its relationship to jobs is not documented |
| Job posting wizard | ✅ | 4 steps: Basics, Scoring, Colleges & drives, Eligibility |
| AI-drafted job description | ✅ | Needs Gemini |
| Scoring weight sliders | ✅ | Resume / GitHub / LeetCode / Interview / Assessment, must sum to 100 |
| Employment type, CTC range, interview mode (ai / live / both), duration | ✅ | |
| Job visibility (all / restricted to chosen colleges) | 🟡 | Stored; the student board itself is driven by drives |
| Drives per college | ✅ | Draft, live, closed; publish, close, clone to another college |
| Drive scheduling | ✅ | Apply deadline, OA window (end must be after start), per-drive eligibility (CGPA, branches, batch years), on-campus flag |
| Rounds | ✅ | Ordered; type (tech / hr / managerial / other); mode (ai / live); window per round; publishing is refused until every round has a window |
| Drive templates | ✅ | Save and apply a round structure |
| Scheduler table UX | ✅ | OA window auto-suggested the day after the deadline; each round suggests +5 days |
| Applicants list and detail | ✅ | Ranked, sortable, full analysis panel |
| Manual per-round shortlisting | ✅ | The only thing that moves a student between rounds |
| Funnel dashboard | ✅ | `/company/dashboard/funnel` |
| **AI-round scores** | ❌ | `set_round_result_score` exists but nothing ever calls it, so AI rounds show no score |
| **Live rounds** | ❌ | Marked "graded off-platform": no scheduling, no video, no slot booking |
| AI rounds linked to the AI interview product | ❌ | AI interview templates link to a job, not to a drive round |
| Applicant evidence in one place | 🟡 | OA results, AI interview reports and integrity flags are in separate tabs; there is no combined scorecard |
| Talent search across colleges, saved candidates | ❌ | |
| Bulk messages to applicants | ❌ | |
| Offer letters and joining tracking | ❌ | |
| Team accounts, shared notes, candidate comparison | ❌ | One owner account per company |
| ATS integration, exports beyond the funnel | ❌ | |

---

## 4. Online Assessment (OA)

### 4.1 Company side
| Feature | Status | Details |
|---|---|---|
| Builder | ✅ | Templates `coding`, `analytics`, `aptitude`, or custom sections |
| Custom sections | ✅ | Title, minutes, points; MCQ authoring with correct options; coding questions from the problem library |
| Problem library | ✅ | 198 problems (196 validated); `seed_problems.py` loads it |
| Languages | ✅ | Python, JavaScript, Java, C++ (Java and C++ need typed starter signatures) |
| Who can take it | ✅ | Invite-only gating |
| Invites: send, resend, revoke, remind | ✅ | Email through Resend |
| Camera policy | ✅ | off / optional / required per assessment |
| Multiple-monitor policy | ✅ | off / optional / required per assessment |
| Locked once anyone starts | ✅ | |
| Results scoreboard and per-candidate detail | ✅ | Score, time, tab switches, pastes, fullscreen exits, flags filter |
| Candidate details and pre-test checks shown | ✅ | Name, roll number, branch, CGPA, camera, fullscreen |
| Activity timeline | ✅ | Tab leave/return (with time away), window focus, paste/copy/cut with the text, fullscreen, camera, second display |
| Camera snapshot gallery | ✅ | Private bucket, 10-minute signed links |
| Code similarity | ✅ | MOSS-style winnowing across the drive; side-by-side; labelled as evidence, not proof |
| Candidate feedback card (1–5 stars + comment) | ✅ | Shown to the recruiter |
| Score feeds job scoring | ❌ | Assessment weight is ignored by the scoring agent |
| Snapshot retention | 🟡 | 30 days, but only if `scripts/purge_oa_snapshots.py` is scheduled daily |

### 4.2 Candidate side
| Feature | Status | Details |
|---|---|---|
| OA list and window gating | ✅ | A candidate can start only inside the drive's OA window |
| 3-step start flow | ✅ | Instructions, details (name, phone, college, roll number, branch, year, CGPA + declaration), permissions |
| Timed one-way sections | ✅ | Server-side clock; time keeps running while away; a section cannot be reopened |
| Autosave and refresh survival | ✅ | |
| Run and Submit coding | ✅ | Graded on the server with the real judge; throttled; verdicts include accepted / wrong / compile / runtime / TLE |
| Answer key never exposed | ✅ | Tested |

### 4.3 Permissions and guardrails while taking the test
| Item | Status | Behaviour |
|---|---|---|
| Fullscreen | ✅ | Required where the browser supports it; entered on Start/Resume; **exit is recorded and a banner offers a way back; it does not block or auto-submit** |
| Camera | ✅ | Consent before Start; if required and denied or lost, a blocking overlay appears (timer keeps running); snapshots about every 60 s, jittered; browser face count recorded (untrusted) |
| Microphone | ❌ | **The OA does not use the microphone at all** |
| Screen share / screen recording | ❌ | **Not built. The OA never captures your screen.** It only checks fullscreen and the number of displays |
| Multiple monitors | 🟡 | `screen.isExtended` on Chrome/Edge; Firefox and Safari report "unknown"; a mirrored display or second computer cannot be seen. Checked at the start and watched during the test |
| Tab switch / window blur | ✅ | Counted, toast shown, time away logged |
| Copy, cut, paste | ✅ | Recorded with the text (paste into the editor, copy/cut anywhere) |
| Leaving the page | ✅ | Browser confirmation |
| Blocking paste, right-click, dev tools | ❌ | Everything is recorded, nothing is blocked |
| Automatic penalty or disqualification | ❌ | Flags are for a human to review |
| ID or face verification | ❌ | |

Tests: backend OA scripts and SQL tests pass; 15 of 15 OA browser tests pass when the recruiter locator is
unambiguous. Not verified: real Piston deployment, real cameras, Safari and Firefox.

---

## 5. AI Interview

### 5.1 Candidate (practice)
| Feature | Status | Details |
|---|---|---|
| Practice tracks | ✅ | AI/ML Engineer, Web Developer, Software Engineer |
| Briefing and consent | ✅ | Rules/academic integrity, separate audio and camera consent, consent version stored |
| Equipment test | ✅ | No attempt used; camera preview and mic meter |
| Live voice interview | ✅ | LiveKit room, Deepgram speech-to-text, Cartesia voice, Gemini brain; AI speaks first; timer, captions |
| Limits | ✅ | 3 per day, 20 minutes (configurable); an attempt is refunded if the interviewer never joins |
| Reconnect and rejoin | ✅ | Banner, rejoin within a grace period, closes and grades after `RECONNECT_GRACE_SECONDS` |
| Scored report | ✅ | Scores, strengths, weaknesses, per-question feedback, integrity section |
| Past interviews list | ✅ | |
| Feeds job scoring | ✅ | Recency-weighted signal (not best-of-N) |

### 5.2 Cheating and integrity guardrails
| Guardrail | Status | Behaviour |
|---|---|---|
| Rules and consent | ✅ | Do/don't list; must accept to start |
| Tab hidden / window blur | ✅ | Flagged on screen with a counter; logged |
| Camera lost / mic lost | ✅ | Banner with Restore buttons; logged |
| Face checks by the AI interviewer | ✅ | A frame every 15 s (configurable): no face, more than one face, camera blocked. Must repeat on 2 checks before it is flagged; clears when normal; the candidate is told on screen; runs only with video consent; frames are not stored; no gaze, emotion or appearance judgement; does not affect the score |
| Event caps | ✅ | 20 per request, 200 per session, event kinds whitelisted |
| Close-tab confirmation | ✅ | |
| Fullscreen requirement | ❌ | Only the OA has it |
| Earpiece / second screen / reading-from-script detection | ❌ | |
| Identity or face match | ❌ | |
| Auto-invalidate on repeated violations | ❌ | The briefing says "repeated violations can invalidate the interview", but no code does this |
| Prompt-injection defence against spoken instructions | ❌ | None found in the interviewer prompts; they only say to be strict and skeptical |

### 5.3 Company side
| Feature | Status | Details |
|---|---|---|
| Rubric templates and presets | ✅ | Competencies with weights that always total 100, seed questions |
| "Draft with AI" rubric | ✅ | Needs Gemini |
| Preview candidate experience | ✅ | |
| Invite by email or from the applicants list | ✅ | Duplicates and invalid emails reported, daily invite cap |
| Reminder, extend, withdraw, retake | ✅ | Reminder needs the 15-minute scheduler |
| Accommodation requests | ✅ | Candidate asks; company is notified |
| Results with filters and sorting | ✅ | |
| Candidate detail | ✅ | Per-competency scores with evidence, transcript, question-by-question, consent record, timestamped integrity events |
| Frozen rubric per attempt | ✅ | Editing the template later does not change earlier candidates |
| Integrity review | ✅ | Dismiss or confirm with a note |
| Decision (advance / hold / reject) | ✅ | Optional email; moves the linked job application |
| CSV export | ✅ | Formula-injection safe |
| Transcript retention | 🟡 | Optional env setting; off by default |
| Coding canvas / whiteboard, session replay, ATS, desktop lockdown | ❌ | Listed as out of scope in the setup doc |

Not live-verified: LiveKit rejoin behaviour, email deliverability, Gemini grading quality. Needs a separately
deployed agent (`ai-interviewer/`, Dockerfile provided) and a 15-minute scheduler call.

---

## 6. PeerMeet (peer-to-peer mock interviews)

**Verdict: the core experience and the safety layer are done and tested. Matching is basic, and a defined list of
plan items is not built.**

### 6.1 Done ✅
| Area | What exists |
|---|---|
| Entry | Dashboard Peer card, instant match, scheduled meeting, or room ID; 10-minute room-bound identity token |
| Guidelines gate | Three statements to accept, versioned; re-prompted on a version bump |
| Matching queue | Waiting screen with real elapsed time, "Schedule a time instead" after about 90 s, cancel, heartbeat (tickets idle for 30 s are dropped), active-room card with End |
| Privacy | "Keep my identity private" by default; the peer is shown as "Anonymous Candidate" if they chose privacy; a person with no name shows as "Peer", never an email |
| "Get ready" screen | Own camera preview, mic level, device pickers, partner card (first name + college/branch only), exact consent question with Yes / No, Ready handshake, 5-minute timeout, "No" cancels for both without telling the partner why |
| Room | Two-person WebRTC video, swap, partner's real mic/camera state, People tab, chat (rate limited, text escaped, history on refresh), screen share (the browser's own stop button now restores the camera), leave vs drop (a dropped person keeps their slot), reconnect banner, scheduled end countdown with 5-min/1-min warnings |
| Captions | Deepgram, only after both people said Yes and the backend confirms both answers |
| AI-assisted interview | Host-only one-time setup (subject, difficulty, experience, duration, who starts); roles shown to both; interviewer-only panel with live suggested questions and scoring; first-time interviewer message; role switch with two reports; candidate report worded as practice feedback; too-short or silent answers produce an honest "too short to judge" report with no invented scores; printable report |
| Scheduling | Invitee must be a registered email (or leave empty for an open meeting); reschedule; cancel (refused after someone joined); `.ics` download; timezone and reminder settings |
| Emails | Invitation, reschedule, cancel, 24-hour and 15-minute reminders (once each), no-show notice |
| No-show handling | Manual "Partner did not show" after 10 minutes and automatic via the scheduler; counted once, no penalty to the person who waited |
| Safety | Report with reasons (inappropriate, rude, not making a genuine effort, harassment, impersonation, cheating, spam, other); optional block; transcript and chat excerpt attached only when someone reports; block list with unblock; auto-suspension when 3 different people report within 30 days; suspended users shown a banner |
| Admin moderation | "Peer safety" page: queue, evidence, history, warn / suspend N days / dismiss / lift, with permissions |
| Feedback and history | Stars, tags and a note after a session; history with filters |
| Security | Entry token bound to one room; signed report webhooks (optional strict mode); two separate secrets supported; report delivery retried after 2 s, 10 s and 30 s; row-level security; no audio or video is ever stored |

### 6.2 Matching: what it does and does not do
| Rule | Status |
|---|---|
| Only people actively waiting are matched | ✅ |
| Never pairs you with yourself, blocked people (either direction) or suspended people | ✅ |
| Prefers someone you did not meet in the last 24 hours | ✅ |
| Prefers the same topic (Software / Data / Product / Design / Business / Any); never makes you wait for it | ✅ |
| Otherwise the longest-waiting person first | ✅ |
| Match by experience level | ❌ |
| Match by preferred language | ❌ |
| Match by college (including optional exclusion) | ❌ |
| Match by role / domain / skills from the profile | ❌ (topic is picked by hand each time) |
| Availability slots and a timezone-aware board of open meetings | ❌ (not found) |

### 6.3 Not built or unverified ❌
- Mid-call camera/mic/speaker switching (pick them on the Ready screen; to change, leave and rejoin).
- Joining without a camera (listen-only).
- Connection-quality indicator.
- Waiting-room admit / deny.
- Invitee decline (RSVP) on a scheduled meeting.
- Shared state across several PeerMeet server instances (Redis): **state is in memory, so a restart ends every live call and interview.** Rate limits are per process.
- Evidence retention job (the plan said delete after 90 days); not found in the setup doc.
- Not verified in a real environment: calls across different networks (needs a Metered TURN account), Safari and Firefox live captions, real Deepgram/Gemini/Resend, email deliverability.
- Peer sessions are excluded from job scoring on purpose.

---

## 7. College portal

| Feature | Status | Details |
|---|---|---|
| Dashboard | ✅ | Totals, placed / not placed / offer declined, active and draft and closed drives, placement rate, blocked and restricted counts, score-distribution chart |
| Student roster | ✅ | List, search, add, edit, delete |
| CSV import | ✅ | Dry-run preview with a plan ID, refuses a stale preview, merges safe duplicates, refuses conflicting ones, never overwrites with blanks, reports exactly how many were saved on a partial failure |
| CSV export | ✅ | |
| Bulk placement update | ✅ | Marks placed / not placed / offer declined |
| Block, restrict, unblock a student | ✅ | Mirrored onto the student's real account and enforced on every request |
| Onboarding invites | ✅ | A per-student failure does not stop the batch |
| Departments | ✅ | Add, edit, delete |
| Campus drives (manual) | ✅ | The TPO's own entries with an eligibility filter and an "eligible students" lookup; separate from platform drives |
| Shortlist filter and export | ✅ | |
| Platform view (read-only) | ✅ | Live and closed platform drives aimed at the college and how roster students are doing; status only, never scores, resumes or pay |
| Reports tab | 🟡 | Score-distribution report; the Analytics page reuses the Dashboard tab |
| Demo mode | ✅ | `/demo/college/*` runs on sample data in the browser and never calls the API |
| Audit trail | ✅ | Actions logged to `admin_events` with counts, not values |
| Placement Cycle | ❌ | Page says "Coming soon" |
| Companies, Faculty, Readiness Goals | ❌ | Disabled tiles marked "Backend endpoint not implemented" |
| Approve or curate which companies reach students | ❌ | No gate: a live drive is visible immediately |
| Platform placements flowing into the roster | ❌ | The TPO's placement status and the platform's `hired` status never sync |
| "Employability score" and "Verified students" | 🟡 | Come from fields the TPO enters or imports; they are not computed from platform activity |
| Student-consented readiness analytics | ❌ | |
| NIRF / NAAC / AICTE style reports | ❌ | |
| Row-level-security hardening for admins | ❌ | The migration described in `backend/README.md` is **missing from the repo** (see section 13) |
| Notice to students that the placement cell can see their application status | ❌ | Flagged in the code as an open product question |

---

## 8. Admin portal

| Feature | Status | Details |
|---|---|---|
| Overview KPIs and trends | ✅ | From SQL functions callable only by the backend |
| Colleges: list, detail, export | ✅ | |
| Add a college (provisions the account, sends set-password email) | ✅ | |
| Suspend and reactivate a college | ✅ | Reason required; reactivation restores only the accounts that suspension blocked |
| Companies: list, detail, export | 🟡 | Read-only |
| Candidates: list, filter options, export | 🟡 | Read-only; no scores or resume data by design |
| Drives, partnerships, CTC by company | 🟡 | Read-only analytics |
| Users: list, detail, export, block, unblock | ✅ | No hard delete and no role editing, by design |
| Alerts | ✅ | Computed live on each call; nothing stored, no dismiss |
| Live activity and audit log (with export) | ✅ | |
| Reports | 🟡 | Application funnel export, compensation export, platform usage summary |
| Departments analytics | 🟡 | Grouped by the raw branch text students typed |
| Global search | ✅ | Colleges, companies, candidates, drives; permission-gated |
| Admin management | ✅ | Super admin, delegated admins with fine-grained permissions, grant and revoke |
| Peer safety moderation | ✅ | See section 6 |
| System health | 🟡 | Shows only what the backend can verify; background jobs and realtime show "unknown" |
| Finance | ❌ | Page and API exist and return N/A everywhere; no payments, subscriptions or expenses data |
| Approve or reject companies, jobs or drives | ❌ | |
| Support tooling, job-post moderation | ❌ | |
| Plan enforcement | ❌ | `colleges.plan` column exists (standard / pro / enterprise) with nothing enforcing it |

---

## 9. How the three portals connect

| Link | Status | What actually happens |
|---|---|---|
| Company → students | ✅ | A drive at a college makes the job visible to students whose profile college matches and whose domain matches |
| Student → company | ✅ | Applying creates a scored application, ranked in the company's applicant list |
| Company → student status | 🟡 | Status and round progress update in the student's tracker, with no notification |
| College → student | ✅ | Roster blocking and restriction are enforced on the student's real account |
| College sees company activity | 🟡 | Read-only view of its own roster students' statuses |
| College controls company access | ❌ | No approval gate |
| Placement sync (platform hired → college roster) | ❌ | Two separate sources of truth |
| Admin → everything | 🟡 | Read and block, but not approve or edit |

---

## 10. Cross-cutting

| Area | Status | Details |
|---|---|---|
| Emails | 🟡 | Exist for OA, AI interview and PeerMeet. **None for application status changes, drive deadlines or round windows** |
| In-app notifications | ❌ | No table, no feed |
| Privacy and consent | 🟡 | Per-feature consent exists (AI interview, PeerMeet, OA camera); no account deletion, no data export, retention only partly handled |
| Security | 🟡 | RLS on tables, role guard, rate limits, signed webhooks; the college RLS hardening file is missing |
| Background jobs | 🟡 | Three external scheduler calls are required (see section 12); the app has no job runner and the health page cannot tell if they run |
| CI / automated pipeline | ❌ | No `.github/workflows` |
| Deployment configuration | 🟡 | Dockerfile for the AI interviewer and a Docker Compose for Piston; none for the backend, frontend or PeerMeet. The frontend build defaults to a Cloudflare target |
| Billing and pricing enforcement | ❌ | The pricing page lists features (for example "Unlimited AI Interviews" and "Priority support") with nothing behind them |
| Mobile app | ❌ | Responsive web only |
| Developer tools | ✅ | Model Lab (compare LLMs on the resume, scoring and LinkedIn prompts), `provision_admin.py`, `verify_job_scoring.py`, `check_judge.py` |
| Landing site | ✅ | Home, features, solutions, pricing, FAQ, portals page, sitemap |

---

## 11. Documentation drift worth fixing

- `backend/README.md` still says "The frontend currently contains mocked auth"; real auth exists.
- `PEERMEET_SETUP.md` tells you to check out `feat/peermeet-end-to-end`; the work is merged to `main`.
- `backend/README.md` describes a college RLS hardening migration that is not in the repo.
- There is no single roadmap or architecture document. This file is the first.

---

## 12. What only you can do before real users

1. Create the accounts and keys: Supabase, LiveKit, Deepgram, Cartesia, Gemini, Resend (verified domain), Metered TURN.
2. Generate separate secrets for PeerMeet and AI interview (`openssl rand -hex 48`).
3. Run the SQL migrations in order. The PeerMeet and AI interview setup docs list theirs; `backend/README.md` lists the core, admin and OA ones.
4. Deploy the backend, frontend, PeerMeet server and client, the AI interviewer agent and Piston, all over https.
5. Schedule three calls: PeerMeet maintenance every 5 minutes, AI interview maintenance every 15 minutes, OA snapshot purge daily.
6. Get legal sign-off on the consent wording and the privacy policy (the code stores consent versions but the text is not approved).
7. Run the manual test plans in `PEERMEET_SETUP.md` and `AI_INTERVIEW_SETUP.md` on real accounts.

---

## 13. Test results and known defects (as of this snapshot)

| Suite | Result |
|---|---|
| Backend unit and integration | 869 passed, **1 failed**, 2 skipped |
| Backend legacy suites | All pass (295 + 56 + 77 checks, OA and AI interview) |
| SQL against Postgres 16 | Admin 184/184, OA all pass, **college-access test cannot run** |
| Frontend | Typecheck clean, 409 of 409 tests pass, build succeeds |
| PeerMeet server and client | All pass (server suites, 68 precall checks, 90 client tests, build) |
| AI interviewer agent | 74 of 74 pass |
| Browser end to end | 167 passed, 10 failed, 1 skipped |

Defects found (not fixed yet):
1. ❌ The audit log has no label for the event `peer_report_resolved`, so an admin would see the raw code; this fails a backend test. Fix: one line in `frontend/src/components/admin/status.ts`.
2. ❌ `db/college_rls_admin_hardening_migration.sql` is documented and referenced by a test but does not exist; its test setup also omits `incremental_migration_departments.sql`.
3. ❌ `ApplicantAnalysisPanel.tsx` reads `weightsSnapshot` without a guard, so one malformed row crashes the whole recruiter page. Real scoring always writes it.
4. ❌ The AI interview browser spec (6 failures) is stale: the API now requires consent fields and the tab was redesigned. AI interview currently has no valid browser test.
5. 🟡 4 OA browser failures and 1 PeerMeet failure are test-locator problems, not feature bugs (all 15 OA tests pass with an unambiguous locator).
6. ❌ Round scores for AI rounds are never written; the assessment scoring dimension is always empty.
7. 🟡 `frontend/bun.lock` is stale (`@testing-library/dom` missing) and pins packages to a private mirror that some networks block; lint reports 976 problems, 949 of them formatting.

Not verified at all: real AI output quality, real LiveKit voice and video, real Piston execution, real Supabase RLS,
real email delivery, Safari and Firefox, calls across real networks.

---

## 14. Removed or intentionally not a feature

- **Expert Interview** was only a "Beta" card with no backend or database. It was removed from the candidate
  dashboard and the pricing copy.
- No audio or video is ever recorded or stored by PeerMeet or the AI interview. Only the one frame per check is
  analysed and discarded. OA camera snapshots are the one image that is stored (private, 30-day retention).
- Reports from PeerMeet and the AI practice interview are practice feedback, not hiring decisions.
