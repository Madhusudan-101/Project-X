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

Frontend
--------

- Set `VITE_API_BASE_URL=http://localhost:8000` in your frontend `.env.local`.
- The frontend currently contains mocked auth; replace calls in `src/services/api/auth.ts` to call the backend endpoints (examples in this repo's docs).

Security notes
--------------
- Use Supabase RLS with anon keys for client operations; use the service role key only on the server.
