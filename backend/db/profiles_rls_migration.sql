-- ============================================================
-- Row Level Security for public.profiles — Mirracle
--
-- STATUS: no earlier migration in this repo enables RLS on public.profiles
-- (db/admin_portal_migration.sql even says "public.profiles has no RLS of its
-- own"). If the live project never enabled it in the dashboard either, then
-- with Supabase's default grants any browser holding the anon key can SELECT
-- every profile (all emails, roles, college links, block state) and UPDATE
-- other users' non-guarded columns. For the College Portal that means a TPO
-- (or a visitor) could read other colleges' students' profiles straight from
-- PostgREST, bypassing every college_id check in the FastAPI backend.
--
-- CHECK FIRST (SQL editor):
--   select relrowsecurity from pg_class where oid = 'public.profiles'::regclass;
--   select policyname, cmd, roles from pg_policies where tablename = 'profiles';
-- If relrowsecurity is already true and the policies are already own-row only,
-- this file is a no-op and can be skipped.
--
-- Safety analysis (done against the code in this repo):
--   * The FastAPI backend reads/writes profiles ONLY through db_client /
--     admin_client (service_role, BYPASSRLS) — unaffected.
--   * The frontend never reads a table through supabase-js (it only uses
--     supabase-js for Google OAuth) — unaffected.
--   * Every existing RLS policy that touches profiles does so as
--     `p.id = auth.uid()` (own row): jobs_and_applications_migration.sql:325,
--     job_drives_migration.sql:238 and :268 — still satisfied.
--   * current_college_id() / is_admin() / current_company_id() are
--     SECURITY DEFINER (owner bypasses RLS) — unaffected.
--   * guard_profile_privileged_columns still blocks role / college link /
--     block-state / is_super_admin changes for the rows a user CAN update.
--
-- No INSERT or DELETE policy for browser roles: profiles rows are created by
-- the backend (signup / provisioning / self-heal), never by the client.
--
-- Idempotent. Rollback: alter table public.profiles disable row level security;
-- ============================================================

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
