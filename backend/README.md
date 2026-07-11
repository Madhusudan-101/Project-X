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

Frontend
--------

- Set `VITE_API_BASE_URL=http://localhost:8000` in your frontend `.env.local`.
- The frontend currently contains mocked auth; replace calls in `src/services/api/auth.ts` to call the backend endpoints (examples in this repo's docs).

Security notes
--------------
- Use Supabase RLS with anon keys for client operations; use the service role key only on the server.
