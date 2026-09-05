-- ============================================================
-- College Onboarding Migration — DRAFT, not yet applied.
-- Run AFTER incremental_migration.sql and incremental_migration_departments.sql
-- (public.colleges and public.departments must exist).
--
-- Extends the EXISTING public.colleges table (the platform-tenant table
-- already used by get_current_tpo, students, drives, departments, etc.)
-- rather than creating a duplicate. Deliberately kept independent of
-- public.candidate_colleges (a different table — candidates' self-reported
-- alma mater, unrelated to platform tenants) per confirmed decision.
-- Reuses the EXISTING public.departments table for the department-picker
-- step instead of a new colliding college_departments table.
-- ============================================================

-- 1. colleges: new onboarding fields. No is_predefined flag needed here —
--    unlike candidate_colleges, this table starts empty; dedup is just
--    "does a row with this name already exist."
alter table public.colleges add column if not exists website text;
alter table public.colleges add column if not exists city text;
alter table public.colleges add column if not exists state text;
alter table public.colleges add column if not exists type text;
alter table public.colleges add column if not exists is_custom_type boolean not null default false;
alter table public.colleges add column if not exists logo_url text;
alter table public.colleges add column if not exists student_strength text;
alter table public.colleges add column if not exists onboarding_completed boolean not null default false;

-- 2. college_contacts — same shape as company_contacts, for the same
--    future multi-user-per-college access reason.
create table if not exists public.college_contacts (
  id                     uuid         primary key default gen_random_uuid(),
  college_id             uuid         not null references public.colleges(id) on delete cascade,
  full_name              text         not null,
  designation            text         not null,
  is_custom_designation  boolean      not null default false,
  phone                  text,
  email                  text         not null,
  is_primary_contact     boolean      not null default false,
  created_at             timestamptz  not null default now()
);

create index if not exists idx_college_contacts_college_id on public.college_contacts(college_id);
create unique index if not exists idx_college_contacts_one_primary
  on public.college_contacts(college_id) where is_primary_contact;

-- 3. college_platform_intent — separate table so stated intent can be
--    tracked distinctly from actual usage over time.
create table if not exists public.college_platform_intent (
  id          uuid         primary key default gen_random_uuid(),
  college_id  uuid         not null references public.colleges(id) on delete cascade,
  intent      text         not null
    check (intent in ('placement_mgmt', 'readiness_tracking', 'jd_matching', 'weakness_analysis')),
  created_at  timestamptz  not null default now(),
  unique (college_id, intent)
);

create index if not exists idx_college_platform_intent_college_id on public.college_platform_intent(college_id);

-- 4. college_consents — same versioned pattern as company_consents /
--    candidate DPDPA consent.
create table if not exists public.college_consents (
  id                          uuid         primary key default gen_random_uuid(),
  college_id                   uuid         not null references public.colleges(id) on delete cascade,
  tos_accepted_at               timestamptz  not null default now(),
  data_consent_accepted_at      timestamptz  not null default now(),
  tos_version                   text         not null,
  consent_version                text         not null,
  created_at                    timestamptz  not null default now()
);

create index if not exists idx_college_consents_college_id on public.college_consents(college_id);

-- ── RLS ──────────────────────────────────────────────────────────────
-- current_college_id() already exists (incremental_migration.sql) and
-- resolves via profiles.college_id, not ownership of the colleges row
-- itself — matches how College accounts already work in this app.

alter table public.college_contacts        enable row level security;
alter table public.college_platform_intent enable row level security;
alter table public.college_consents        enable row level security;

drop policy if exists college_contacts_own on public.college_contacts;
create policy college_contacts_own on public.college_contacts
  for all
  using      (public.is_admin() or college_id = public.current_college_id())
  with check (public.is_admin() or college_id = public.current_college_id());

drop policy if exists college_platform_intent_own on public.college_platform_intent;
create policy college_platform_intent_own on public.college_platform_intent
  for all
  using      (public.is_admin() or college_id = public.current_college_id())
  with check (public.is_admin() or college_id = public.current_college_id());

drop policy if exists college_consents_own on public.college_consents;
create policy college_consents_own on public.college_consents
  for all
  using      (public.is_admin() or college_id = public.current_college_id())
  with check (public.is_admin() or college_id = public.current_college_id());
