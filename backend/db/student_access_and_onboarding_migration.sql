-- ============================================================
-- College Portal — student access control + onboarding invites
--
-- Adds, to the EXISTING public.students roster and public.colleges tables:
--   1. A status the TPO controls (active / temporarily_blocked / restricted).
--      This is the roster's own record; when the same email also has a
--      candidate platform account at this college, the TPO's action is
--      mirrored onto that profiles row (blocked_permanent/blocked_until —
--      see admin_portal_migration.sql, 6.0) so it is actually enforced by
--      deps.get_current_user on every request, not just hidden in the UI.
--      A roster row with no matching account yet still records the status,
--      so a restricted/blocked entry is never invited (see 2.).
--   2. invited_at / invited_by — whether an onboarding invite has been sent,
--      so re-running the export/invite flow never re-invites the same
--      student. "Already has an account" is derived from public.profiles
--      (role='candidate', same college_id, same email) rather than stored
--      here, so there is nothing to keep in sync.
--   3. colleges.plan — the plan this college is on. Read by the invite flow
--      and included in the invited user's metadata; not editable by the
--      College user (no UPDATE policy grants it — see incremental_migration.sql,
--      colleges_college_read is SELECT-only).
--
-- Run AFTER: incremental_migration.sql (students, colleges, RLS helpers),
--   db/admin_portal_migration.sql (profiles.blocked_* columns).
-- Idempotent: add-column-if-not-exists / drop-if-exists / create-or-replace
-- throughout. Additive only — no existing row is modified, no existing
-- column or policy is changed.
-- ============================================================

alter table public.students
  add column if not exists status text not null default 'active'
    check (status in ('active', 'temporarily_blocked', 'restricted'));
alter table public.students add column if not exists blocked_until timestamptz;
alter table public.students add column if not exists blocked_reason text;
alter table public.students add column if not exists blocked_at    timestamptz;
alter table public.students
  add column if not exists blocked_by uuid references public.profiles(id) on delete set null;
alter table public.students add column if not exists invited_at timestamptz;
alter table public.students
  add column if not exists invited_by uuid references public.profiles(id) on delete set null;

create index if not exists idx_students_college_status on public.students(college_id, status);

-- Existing students_college_all RLS policy (incremental_migration.sql) already
-- covers these new columns: it is a whole-row `for all` policy scoped by
-- college_id, the same tenant boundary every other students.py write already
-- relies on. No policy change needed.

alter table public.colleges
  add column if not exists plan text not null default 'standard'
    check (plan in ('standard', 'pro', 'enterprise'));
