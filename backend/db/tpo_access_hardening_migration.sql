-- ============================================================
-- TPO access hardening — Mirracle (College Portal is login-only)
--
-- Run AFTER: incremental_migration.sql (current_college_id / is_admin) and
--            db/admin_portal_migration.sql (profiles.blocked_* columns).
-- Idempotent (CREATE OR REPLACE). Safe to re-run. No data is touched.
--
-- Why
-- ---
-- A blocked / disabled account is enforced by the FastAPI backend on every
-- request (deps.get_current_user). But the College Portal's tenant tables
-- (students, company_drives, score_verifications, college_*) are protected by
-- RLS, and the browser can reach PostgREST directly with the anon key + a user
-- JWT, skipping FastAPI entirely. A blocked TPO's access token stays valid
-- until it expires, and their refresh token can be exchanged with Supabase
-- Auth directly for new ones — so without this change, "block" would only
-- close the API, not the data. These two helpers are what every one of those
-- policies calls, so making them block-aware closes every table at once.
--
-- "Currently blocked" is computed exactly as the backend does it
-- (deps.is_currently_blocked): blocked_permanent, or blocked_until in the
-- future. A temporary block therefore lifts itself.
--
-- Rollback: re-run the two CREATE OR REPLACE statements from
-- incremental_migration.sql (lines 165-190) to restore the previous bodies.
-- ============================================================

create or replace function public.current_college_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.college_id
    from public.profiles p
   where p.id = auth.uid()
     and p.role = 'college'
     and not p.blocked_permanent
     and (p.blocked_until is null or p.blocked_until <= now())
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and p.role = 'admin'
       and not p.blocked_permanent
       and (p.blocked_until is null or p.blocked_until <= now())
  )
$$;
