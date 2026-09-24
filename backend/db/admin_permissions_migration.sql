-- ============================================================
-- Admin Permissions Migration — Mirracle
--
-- Extends the Admin Portal (db/admin_portal_migration.sql) with a granular,
-- combinable permission system for delegated Admin accounts, layered on top
-- of the existing role='admin' gate. Nothing here duplicates admin_events,
-- the profiles.blocked_* columns, or the admin_* function lock — all three
-- are reused as-is (see backend/app/services/admin/permissions.py).
--
-- Run AFTER: db/admin_portal_migration.sql (profiles, admin_events must exist).
--
-- Model
-- -----
--   * profiles.is_super_admin — an Admin profile with this set to true has
--     unconditional, full access to every /admin route and is the only kind
--     of admin allowed to manage other admins' permissions (see
--     require_admin_role / require_permission / require_super_admin in
--     app/deps.py and app/services/admin/permissions.py). Every role='admin'
--     profile that existed BEFORE this migration is backfilled to
--     is_super_admin = true (see 2. below) — they already had full,
--     unrestricted admin access; this migration only ADDS a way to grant
--     narrower access to NEW delegated admins, it never takes anything away
--     from an admin that already had the keys to everything.
--   * admin_user_permissions — one row per (delegated admin, permission,
--     scope) grant. A permission's CURRENT state is "the row exists and is
--     not expired" — there is no separate active/revoked flag: revoking a
--     permission simply deletes its row. Full history (who granted/revoked
--     what, when, previous/new state) lives in admin_events, reusing the
--     exact pattern profiles.blocked_* (current state) + admin_events
--     (history) already established in db/admin_portal_migration.sql (6.0/6.1).
--   * scope_id is NOT NULL — a fixed sentinel uuid means "no specific
--     resource" (i.e. scope_type='global') instead of an actual NULL, so the
--     natural key (user_id, permission, scope_type, scope_id) can be a plain
--     unique constraint with no NULL-handling special case.
--   * The permission catalog itself (which strings like "colleges.view" are
--     valid) is NOT a database table — it is a Python-side frozenset in
--     app/services/admin/permissions.py, exactly mirroring how
--     admin_events.event_type is validated (EVENT_TYPES in
--     app/services/admin/events.py) rather than a DB enum/lookup table. This
--     keeps adding a new permission a one-file change, like adding an event
--     type already is. No admin_* SQL function is added by this file, so it
--     does not need the admin_* execute-lock loop (admin_portal_migration.sql,
--     7.) — every check here runs in the FastAPI backend, not in Postgres.
--
-- Idempotent: create-or-replace / if-not-exists throughout. Safe to re-run.
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. Super Admin flag on the existing Admin Portal identity (profiles.role).
--    NOT a new "role" — the spec is explicit that combinable permissions,
--    not more fixed roles, are the point. role stays 'admin' for both a
--    Super Admin and a delegated admin; this one boolean is the only thing
--    that distinguishes "implicit full access" from "governed by grants".
-- ─────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists is_super_admin boolean not null default false;

-- ─────────────────────────────────────────────────────────────────────
-- 2. One-time backfill: every admin that already existed keeps full access.
--    Guarded so it only ever runs the FIRST time this file is applied (before
--    admin_user_permissions exists) — re-running the migration later never
--    re-promotes a delegated admin created afterwards with is_super_admin
--    deliberately left false.
-- ─────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'admin_user_permissions'
  ) then
    update public.profiles set is_super_admin = true where role = 'admin';
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Permission grants for delegated admins.
--    scope_type='global' with scope_id = the sentinel means "every
--    resource"; 'college'/'company' with a real id means "only that one".
--    No FK on scope_id itself (it points at colleges OR companies depending
--    on scope_type, so a single FK can't express it) — existence is checked
--    by the backend at grant time instead (see permissions.grant_permission).
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.admin_user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission text not null,
  scope_type text not null default 'global' check (scope_type in ('global', 'college', 'company')),
  scope_id uuid not null default '00000000-0000-0000-0000-000000000000',
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint admin_user_permissions_scope_consistency check (
    (scope_type = 'global' and scope_id = '00000000-0000-0000-0000-000000000000')
    or (scope_type in ('college', 'company') and scope_id <> '00000000-0000-0000-0000-000000000000')
  ),
  unique (user_id, permission, scope_type, scope_id)
);

create index if not exists idx_admin_user_permissions_user
  on public.admin_user_permissions(user_id);
create index if not exists idx_admin_user_permissions_expiry
  on public.admin_user_permissions(expires_at) where expires_at is not null;

alter table public.admin_user_permissions enable row level security;
-- No policies for anon/authenticated: default-deny, so a browser can never
-- read or write grants directly. service_role bypasses RLS (Supabase grants
-- it BYPASSRLS), so the backend's db_client is unaffected — same posture as
-- admin_events (db/admin_portal_migration.sql, 6.1).

-- ─────────────────────────────────────────────────────────────────────
-- 4. Extend the existing role/college/block guard so is_super_admin gets
--    the SAME protection: only the backend (service_role) or a direct DB
--    session can write it, never a browser holding an anon/authenticated
--    JWT via PostgREST. public.profiles has no RLS of its own (never has —
--    this trigger is its only defense), so without this, any authenticated
--    user could PATCH their own row's is_super_admin straight through
--    PostgREST and grant themselves full Admin Portal access, bypassing
--    every check in app/services/admin/permissions.py entirely. Same
--    function, same trigger — no new object; body copied from
--    admin_portal_migration.sql (6.0) with one added guard.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is null or new.role not in ('candidate', 'company') then
      raise exception 'Role "%" cannot be self-assigned.', new.role
        using errcode = '42501';
    end if;
    if new.blocked_permanent or new.blocked_until is not null or new.blocked_by is not null then
      raise exception 'An account cannot set its own block state.'
        using errcode = '42501';
    end if;
    if coalesce(new.is_super_admin, false) then
      raise exception 'Super Admin status cannot be self-assigned.'
        using errcode = '42501';
    end if;
  else
    if new.role is distinct from old.role then
      raise exception 'Profile role cannot be changed by the account holder.'
        using errcode = '42501';
    end if;
    -- A College account's tenant link decides which college's data it can
    -- read through RLS (current_college_id()); it is admin-provisioned only.
    if new.role = 'college' and new.college_id is distinct from old.college_id then
      raise exception 'A College account cannot be re-linked to another college.'
        using errcode = '42501';
    end if;
    if new.blocked_permanent is distinct from old.blocked_permanent
       or new.blocked_until  is distinct from old.blocked_until
       or new.blocked_by     is distinct from old.blocked_by
       or new.blocked_reason is distinct from old.blocked_reason
       or new.blocked_at     is distinct from old.blocked_at then
      raise exception 'Block state can only be changed by an Admin.'
        using errcode = '42501';
    end if;
    if new.is_super_admin is distinct from old.is_super_admin then
      raise exception 'Super Admin status can only be changed by a direct database session.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
-- (trigger already exists from admin_portal_migration.sql 1./6.0; CREATE OR REPLACE above is enough)
