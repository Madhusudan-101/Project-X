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

- Online Assessment (candidate OA: timed, one-way sections): run `db/online_assessment_migration.sql`
  **after** `db/job_drives_migration.sql`. The assessment for a drive is provisioned lazily from the
  default templates in `app/services/candidate/oa_bank.py` the first time a candidate opens it; the
  window comes from `job_drives.oa_window_start/end`. Test: `python tests/test_candidate_oa.py`.

Frontend
--------

- Set `VITE_API_BASE_URL=http://localhost:8000` in your frontend `.env.local`.
- The frontend currently contains mocked auth; replace calls in `src/services/api/auth.ts` to call the backend endpoints (examples in this repo's docs).

Security notes
--------------
- Use Supabase RLS with anon keys for client operations; use the service role key only on the server.
