-- ============================================================
-- Company Migration — Project X
-- Run AFTER the base migrations.sql (trigger_set_updated_at must exist)
-- ============================================================

-- 1. companies table
create table if not exists public.companies (
  id             uuid         primary key default gen_random_uuid(),
  owner_id       uuid         not null unique references public.profiles(id) on delete cascade,
  name           text         not null,
  industry       text         not null,
  size           text         not null,
  hiring_domains text[]       not null default '{}',
  website        text,
  logo_url       text,
  is_verified    boolean      not null default false,
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now()
);

-- 2. Auto-update trigger (reuses function from migrations.sql)
drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at
  before update on public.companies
  for each row execute procedure trigger_set_updated_at();

-- 3. Performance indexes
create unique index if not exists idx_companies_owner_id on public.companies(owner_id);
create index  if not exists idx_companies_industry   on public.companies(industry);
create index  if not exists idx_companies_created_at on public.companies(created_at desc);

-- 4. Row-Level Security
alter table public.companies enable row level security;

-- Owner (HR admin) can read, insert, and update their own company row
create policy "company_owner_all"
  on public.companies
  for all
  using      (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Any authenticated user can read company profiles
-- (needed for candidates browsing companies / job listings)
create policy "authenticated_read_companies"
  on public.companies
  for select
  using (auth.role() = 'authenticated');
