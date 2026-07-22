-- ============================================================
-- Role Posting Migration — Mirracle (Feature 2: Company Dashboard)
-- Run AFTER company_migration.sql (companies table + trigger_set_updated_at must exist)
-- ============================================================

-- 1. job_roles table
create table if not exists public.job_roles (
  id                           uuid         primary key default gen_random_uuid(),
  company_id                   uuid         not null references public.companies(id) on delete cascade,
  title                        text         not null,
  description                  text         not null,
  required_skills              text[]       not null default '{}',
  experience_level             text         not null,
  deadline                     date         not null,
  minimum_employability_score  smallint     not null default 0,
  status                       text         not null default 'draft',
  created_at                   timestamptz  not null default now(),
  updated_at                   timestamptz  not null default now(),
  constraint job_roles_status_check
    check (status in ('draft', 'published', 'archived')),
  constraint job_roles_experience_level_check
    check (experience_level in ('Entry-Level', 'Mid-Level', 'Senior', 'Lead', 'Executive')),
  constraint job_roles_min_score_check
    check (minimum_employability_score between 0 and 100)
);

-- 2. Auto-update trigger (reuses function from migrations.sql)
drop trigger if exists set_job_roles_updated_at on public.job_roles;
create trigger set_job_roles_updated_at
  before update on public.job_roles
  for each row execute procedure trigger_set_updated_at();

-- 3. Performance indexes
create index if not exists idx_job_roles_company_id  on public.job_roles(company_id);
create index if not exists idx_job_roles_status      on public.job_roles(status);
create index if not exists idx_job_roles_deadline     on public.job_roles(deadline);
create index if not exists idx_job_roles_created_at   on public.job_roles(created_at desc);

-- 4. Row-Level Security
alter table public.job_roles enable row level security;

-- Owning company (HR admin) can read, insert, update, and delete their own roles
create policy "company_manage_own_roles"
  on public.job_roles
  for all
  using      (company_id in (select id from public.companies where owner_id = auth.uid()))
  with check (company_id in (select id from public.companies where owner_id = auth.uid()));

-- Any authenticated user can read published roles (candidates browsing jobs)
create policy "authenticated_read_published_roles"
  on public.job_roles
  for select
  using (status = 'published' and auth.role() = 'authenticated');
