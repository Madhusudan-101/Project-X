-- ============================================================
-- Company Onboarding Migration — DRAFT, not yet applied.
-- Run AFTER db/company_migration.sql (public.companies must exist).
--
-- Extends the EXISTING public.companies table (created earlier this
-- session, already wired to POST /auth/company-signup and GET/PATCH
-- /company/me) rather than replacing it — owner_id stays the auth/RLS
-- anchor. company_contacts is additive, built for the future
-- multi-user-per-company access feature, not a replacement for owner_id.
-- ============================================================

-- 1. companies: mark onboarding completion.
alter table public.companies add column if not exists onboarding_completed boolean not null default false;

-- 2. company_contacts — separate table so multi-contact/team access later
--    doesn't need a schema migration, just more rows.
create table if not exists public.company_contacts (
  id                     uuid         primary key default gen_random_uuid(),
  company_id             uuid         not null references public.companies(id) on delete cascade,
  full_name              text         not null,
  designation            text         not null,
  is_custom_designation  boolean      not null default false,
  phone                  text,
  email                  text         not null,
  is_primary_contact     boolean      not null default false,
  created_at             timestamptz  not null default now()
);

create index if not exists idx_company_contacts_company_id on public.company_contacts(company_id);
-- At most one primary contact per company.
create unique index if not exists idx_company_contacts_one_primary
  on public.company_contacts(company_id) where is_primary_contact;

-- 3. company_hiring_intent — separate table (not columns on companies) so
--    stated intent can have history distinct from actual usage later.
create table if not exists public.company_hiring_intent (
  id             uuid         primary key default gen_random_uuid(),
  company_id     uuid         not null references public.companies(id) on delete cascade,
  domain         text         not null check (domain in ('tech', 'non-tech', 'both')),
  hiring_volume  text         not null check (hiring_volume in ('1-5', '5-20', '20+')),
  hiring_type    text         not null check (hiring_type in ('internship', 'full-time', 'both')),
  created_at     timestamptz  not null default now()
);

create index if not exists idx_company_hiring_intent_company_id on public.company_hiring_intent(company_id);

-- 4. company_consents — versioned, same pattern as candidate DPDPA consent.
create table if not exists public.company_consents (
  id                          uuid         primary key default gen_random_uuid(),
  company_id                  uuid         not null references public.companies(id) on delete cascade,
  tos_accepted_at              timestamptz  not null default now(),
  data_consent_accepted_at     timestamptz  not null default now(),
  tos_version                  text         not null,
  consent_version               text         not null,
  created_at                   timestamptz  not null default now()
);

create index if not exists idx_company_consents_company_id on public.company_consents(company_id);

-- 5. Helper: resolve the caller's own company_id (mirrors current_college_id()
--    in incremental_migration.sql), used by every RLS policy below.
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.companies where owner_id = auth.uid()
$$;

-- 6. RLS — a company user can only touch rows tied to their own company_id.
alter table public.company_contacts       enable row level security;
alter table public.company_hiring_intent  enable row level security;
alter table public.company_consents       enable row level security;

drop policy if exists company_contacts_own on public.company_contacts;
create policy company_contacts_own on public.company_contacts
  for all
  using      (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

drop policy if exists company_hiring_intent_own on public.company_hiring_intent;
create policy company_hiring_intent_own on public.company_hiring_intent
  for all
  using      (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

drop policy if exists company_consents_own on public.company_consents;
create policy company_consents_own on public.company_consents
  for all
  using      (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- ============================================================
-- 7. Storage — company logo uploads (real file upload, per your choice).
--    No Storage bucket exists anywhere in this project yet — this is new.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', true)
on conflict (id) do nothing;

-- Public read (logos are shown to candidates browsing companies).
drop policy if exists company_logos_public_read on storage.objects;
create policy company_logos_public_read on storage.objects
  for select using (bucket_id = 'company-logos');

-- A company can only upload/replace/delete files under a path prefixed
-- with their own company_id, e.g. "<company_id>/logo.png" — enforced by
-- checking the first path segment against current_company_id().
drop policy if exists company_logos_owner_write on storage.objects;
create policy company_logos_owner_write on storage.objects
  for insert
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

drop policy if exists company_logos_owner_update on storage.objects;
create policy company_logos_owner_update on storage.objects
  for update
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

drop policy if exists company_logos_owner_delete on storage.objects;
create policy company_logos_owner_delete on storage.objects
  for delete
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );
