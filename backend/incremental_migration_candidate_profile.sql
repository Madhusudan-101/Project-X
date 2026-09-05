-- ─────────────────────────────────────────────────────────────────────
-- Incremental Migration — Candidate onboarding fields
--
-- Safe to run on existing databases (idempotent: `add column if not
-- exists`, same pattern as incremental_migration.sql's profiles.college_id).
-- Adds the fields collected on /auth/profile-setup for candidate accounts:
-- skills, interested role, college name, graduation year.
-- ─────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists skills text[] not null default '{}';
alter table public.profiles add column if not exists college_name text;
alter table public.profiles add column if not exists graduation_year int;

-- Superseded interested_role (single text) with interested_roles (text[]) —
-- candidates can now select multiple roles via a fuzzy multi-select, same
-- pattern as skills. The old interested_role column is left in place
-- (not dropped) since nothing reads it anymore, matching this repo's
-- superseded-column convention elsewhere.
alter table public.profiles add column if not exists interested_role text;
alter table public.profiles add column if not exists interested_roles text[] not null default '{}';
