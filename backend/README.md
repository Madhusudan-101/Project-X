Setup
-----

1. Copy `.env.example` to `.env` and set values from your Supabase project.

2. Create a virtualenv and install deps:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

3. Run the app:

```bash
uvicorn app.main:app --reload --port 8000
```

Getting Supabase URL & keys
---------------------------

- Go to https://app.supabase.com and sign in.
- Create a new project (or open existing).
- In the project dashboard go to "Settings → API".
  - `URL` is the Supabase URL (paste to `SUPABASE_URL`).
  - `Service Role Key` is the server-side key (paste to `SUPABASE_SERVICE_ROLE_KEY`).
- Keep the `Service Role Key` secret; do NOT commit it or expose it to the frontend.

Migrations
----------

- Run the SQL in `db/migrations.sql` in the SQL editor in the Supabase dashboard (or via psql).

- Core platform loop (job posting → job board → application → job-scoped
  scoring): run `db/jobs_and_applications_migration.sql` **after**
  `db/migrations.sql`, `incremental_migration.sql`, `db/company_migration.sql`,
  `db/company_onboarding_migration.sql`, and `db/resume_analysis_migration.sql`
  have been applied (it depends on `public.profiles`, `public.colleges`,
  `public.companies`, `public.current_company_id()`, `public.is_admin()`,
  `public.trigger_set_updated_at()`, and `public.model_versions`). It is
  idempotent (create-if-not-exists + drop-policy-if-exists). It also adds
  `profiles.domain` and starts populating `profiles.college_id` for candidate
  accounts via `PATCH /auth/profile`.

- After applying it, verify end-to-end with `python verify_job_scoring.py`
  (needs the API running and `GEMINI_API_KEY` set; set `SUPABASE_ANON_KEY`
  too for the direct-RLS assertions). `python verify_job_scoring.py --reset`
  removes only that script's own `verifyjs+*` seed rows.

Admin Portal
------------

- Apply `db/admin_portal_migration.sql` **after** every migration listed above (it is
  idempotent). It adds a guard trigger on `public.profiles` (role / College link can't be
  changed through the public Supabase API), one nullable column `applications.college_id`
  (with a trigger that snapshots the applicant's college when they apply, so history doesn't
  move if they later change college; existing rows are not modified), a few indexes, and the
  `admin_*` SQL functions that compute every Admin metric. Those functions are executable by
  `service_role` only, so the browser (anon key or any user JWT, admin included) can never
  call them; only this API can, after `require_admin_role`. Until it is applied, `/admin/*`
  answers 503 with a message naming the file. After applying, if PostgREST still reports the
  functions missing, run `notify pgrst, 'reload schema';`.
- **Deployment checks the code cannot do for you** (do these against the real project, not
  the test DB): the `profiles` update/insert policies (a user must not be able to change their
  own `role`; the migration's trigger enforces it for API callers, but not for a SECURITY
  DEFINER trigger on `auth.users` if one exists), whether `postgres` bypasses RLS on the
  tables the `admin_*` functions read, the project's PostgREST "Max rows" setting (exports
  page in chunks of 1000, which fits Supabase's default), and the Auth Site URL / redirect
  URLs used by the set-password email.
- **Accounts.** Public signup (`/auth/signup`, Google sign-in, profile self-heal) only ever
  creates `candidate` or `company` accounts. `college` and `admin` accounts are provisioned:
  - Admin: `python provision_admin.py --email you@x.com --first-name Ada --last-name Lovelace`
    (the only way to get the first admin). A set-password email is sent.
  - College: an Admin uses **Add college** in the Admin portal (`POST /admin/colleges`), which
    creates the account, links it to the college and emails a set-password link. The account
    is created first and the college's blank directory fields are filled afterwards, so a
    failure leaves nothing half-done. A legacy College account that self-registered without a
    college link is **replaced** (deleted and recreated), never adopted: whoever registered it
    still holds its password and sessions, so only the mailbox owner may control the new one.
    Accounts that are already linked to a college are never touched.
- **TPO login-only hardening.** Apply `db/tpo_access_hardening_migration.sql` after the migrations
  above (idempotent, no data touched). It makes the RLS helpers `current_college_id()` / `is_admin()`
  ignore blocked accounts, so a disabled TPO cannot keep reading tenant tables straight from
  Supabase REST with a still-valid JWT / refresh token. `db/profiles_rls_migration.sql` enables own-row
  RLS on `public.profiles` (no earlier migration does) — run its two check queries first; skip it if the
  live project already has RLS + own-row policies there. `colleges.create` can be scoped to one college:
  such an admin can add TPOs to that college only and cannot create new colleges.
- **Data sources — do not merge them.** Every Admin metric comes from the platform pipeline
  (jobs, `job_drives`, applications, round results). The College Portal keeps its own data:
  the roster (`students`, including TPO-marked placement) and manually entered Campus Drives
  (`company_drives`). Nothing syncs between the two, so the Admin UI labels them separately
  ("Candidates on Platform" vs "College roster students", "Company drives" vs "Campus Drives
  (College Portal)") and never presents them as equal. Overview totals cover all colleges;
  the Colleges table lists registered colleges only, and the gap is stated in the UI.
- **Metric definitions** live in the header of the migration (registered college, shortlisted,
  eliminated, selected, candidate status, placement rate, active, period cohort). Finance has
  no data source yet: `GET /admin/finance/summary` returns `available: false` and `null`
  metrics; see `app/routers/admin/finance.py` for what to add.
- **CSV export.** Each `.../export` endpoint pages through the matching rows in chunks of at
  most 1000 (never one huge request), up to a hard cap of 50,000 rows. The response carries
  `X-Export-Rows`, `X-Export-Total` and `X-Export-Truncated`; the UI warns when a file is
  incomplete because the cap was reached.
- **Tests** (no Supabase needed):
  - `python tests/test_admin_portal_api.py` — authorization for every admin route, signup /
    provisioning rules, validation, chunked CSV export (including > 1000 rows), N/A semantics
    (in-memory fakes).
  - `pip install -r requirements-dev.txt`, then
    `ADMIN_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres python tests/test_admin_portal_sql.py`
    — applies the repo's migrations to a **scratch** Postgres (it creates and drops the
    database `admin_portal_test`; it refuses any URL containing "supabase") and checks each
    metric against a hand-computed fixture, plus EXECUTE grants, the profile role guard and
    the application-college snapshot trigger.

- Online Assessment (timed one-way sections, library coding problems graded on the server, company
  builder / invites / results). Run, in order, **after** `db/job_drives_migration.sql`:

  1. `db/online_assessment_migration.sql`
  2. `db/online_assessment_coding_migration.sql`  (additive; safe to re-run)
  3. Load the problem library: `python scripts/oa_import/seed_problems.py`
     (reads `db/seed/oa_problems.json` — 198 problems, 196 validated; idempotent).
  4. Code execution: set `OA_JUDGE_BACKEND=piston` + `OA_PISTON_URL` (see `deploy/piston/README.md`),
     then `python scripts/check_judge.py`. Without it candidates can open the OA but can't Run/Submit.
  5. Optional email: `RESEND_API_KEY`, `OA_EMAIL_FROM`, `APP_BASE_URL`.

  Tests: `python tests/test_candidate_oa.py` and `python tests/test_oa_coding_and_company.py`
  (the latter runs the real judge, so it needs `python3` and `node` on PATH).

  Regenerating the library from the leetcode_OA clone: `scripts/oa_import/` —
  `extract_problems.mjs` (handler → plain tests) then `build_seed.py` (sanitise + validate against
  the independent solutions in `scripts/oa_import/solutions/`). See the docstrings there.


College Portal & Admin Portal — roster import, onboarding, platform view, suspension, audit
-------------------------------------------------------------------------------------------

None of this needs a new table or column that the repo's migrations do not already define, except the one
prepared (NOT applied) policy migration below.

- **Roster CSV import** — `POST /api/students/upload`. Never overwrites what a file does not say: a missing
  column, a blank cell or an unusable value leaves the stored field alone (a new student gets the database
  default). Rules (the demo engine, `frontend/src/lib/demo/college/engine.ts`, applies the same ones; both test
  suites carry the same contract table): name/email/branch/graduationYear required, no NUL byte, the email must
  look like an email, the year a whole year 1950-2100; scores plain decimals 0-100, rounded half-up to two
  places (what `numeric(5,2)` stores, so re-uploading the same file is "unchanged", not "updated" forever); rows
  with nothing in them are skipped; a repeated column name is refused; a repeated EMAIL that agrees merges (and
  is reported), one that disagrees refuses the file naming the lines and columns.
  - `?dryRun=true` returns created / updated / unchanged, warnings and a `planId` without writing anything
    (200, not 201). `?expectedPlan=<planId>` on the real import is refused with 409 — nothing written — if the
    file or the roster no longer produces that plan, so a stale preview can never be confirmed.
  - For an existing student only the fields that DIFFER are written, so a value an old export merely repeats
    cannot revert a newer edit. Rows are written in groups that share one column set (PostgREST NULL-fills a
    column a bulk row omits); each group is one request, i.e. one transaction. A failure after the first group
    says exactly how many students were saved ("1 of 2 changed students were saved…") and re-uploading the same
    file finishes the job; an unconfirmed write (dropped connection) is reported as an unknown outcome (502).
  - `addedStudents` = created + updated (it used to count every row the upsert returned, including unchanged
    ones). Nothing in this repo reads it besides the upload dialog, which now uses `created/updated/unchanged`.
  - Limits that cannot be checked locally: the real PostgREST/PostgreSQL behaviour of the grouped upsert, and
    concurrent imports (no duplicates are possible — `unique (college_id, email)` — but the last writer wins).
- **College onboarding** — `GET`/`PUT /api/dashboard/onboarding`. Persists to `colleges` (website, city, state,
  type, student_strength, onboarding_completed), `college_contacts`, `college_platform_intent`, `departments`
  (names are only ever added) and `college_consents` (one row per accepted TOS/data-consent version). Needs
  `db/college_onboarding_migration.sql` applied. Saving is idempotent and ordered so completion and consent come
  last; a failed step never marks the college complete. The consent wording the page shows is identified by
  `TOS_VERSION` / `DATA_CONSENT_VERSION` in `app/routers/college/onboarding.py` — bump them when the wording
  changes (the wording itself still needs the owner's/legal sign-off). No column stores a "placement cycle
  status" or a logo, so the page no longer asks for them. `college_consents` has no "accepted by" column; the
  `college_onboarding_saved` audit event records who.
- **Platform drives and outcomes (read-only)** — `GET /api/dashboard/platform`. A college's live/closed platform
  drives and how its ROSTER students did. A student appears only if their account is at this college AND their
  email is on this college's roster. Statuses only: never scores, analyses, resumes, answers or compensation.
  Read with the service-role client under explicit tenant scoping (no College RLS policy exists on those
  tables, and adding one would change tables owned by the Company/Candidate portals). Open product question:
  students are not told their placement cell can see their application status — that notice belongs to the
  Candidate Portal.
- **Suspend / reactivate a college** — `POST /admin/colleges/{id}/suspend` (reason required) and `/reactivate`,
  permission `colleges.suspend` (global, or scoped to a college). A suspension is the account block applied to
  every TPO account of the college, so it is enforced exactly as every other block (every request, refresh and
  sign-in; `current_college_id()` for direct Supabase access). Nothing is deleted. Reactivation restores only the
  accounts the suspension blocked (recognised by the "College suspended: " reason prefix). All-or-nothing:
  a failure while suspending rolls back. It does NOT hide the college from students, stop companies publishing
  drives, or touch student/company accounts.
- **Audit trail** — College actions (roster import, student create/update/delete/access change, bulk placement
  update, invites, campus drives, departments, onboarding), `college_suspended` / `college_reactivated`, and
  `access_denied` (a signed-in admin asked for something their grants do not cover; throttled to one per admin
  and permission per minute per process) now go to `admin_events`, one event per action, never per row, with
  counts and field names rather than values. Not tamper-proof: anyone holding the service-role key can alter it.
- **Prepared, NOT applied: `db/college_rls_admin_hardening_migration.sql`.** Removes the `public.is_admin() or`
  clause from the College tenant policies (students, company_drives, departments, score_verifications,
  colleges, college_contacts / platform_intent / consents) so an admin with no grants can no longer read or
  write every college's data straight through PostgREST. The file's header lists the compatibility reasoning,
  the read-only checks to run against the live project first, and the rollback. Exercised by
  `tests/test_college_student_access_sql.py` (needs a scratch PostgreSQL via `ADMIN_TEST_DATABASE_URL`; it
  was not runnable where this was written).
- **Registration note.** The new College endpoints are mounted from `app/routers/college/dashboard.py`
  (`router.include_router(...)`) so `app/main.py`, shared with the other portals, stays untouched. Moving them
  to their own `include_router` lines in `main.py` is a possible tidy-up for whoever owns that file.

Frontend
--------

- Set `VITE_API_BASE_URL=http://localhost:8000` in your frontend `.env.local`.
- The frontend currently contains mocked auth; replace calls in `src/services/api/auth.ts` to call the backend endpoints (examples in this repo's docs).

Security notes
--------------
- Use Supabase RLS with anon keys for client operations; use the service role key only on the server.
