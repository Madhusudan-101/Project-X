-- ============================================================
-- Job Description Upload Migration — Project X (Feature 3)
-- Run AFTER role_migration.sql (job_roles table must exist)
-- ============================================================

-- 1. New columns on job_roles for AI-extracted JD fields
alter table public.job_roles
  add column if not exists role_type text,
  add column if not exists preferred_qualifications text[] not null default '{}',
  add column if not exists job_description_path text;

alter table public.job_roles
  drop constraint if exists job_roles_role_type_check;
alter table public.job_roles
  add constraint job_roles_role_type_check
    check (role_type is null or role_type in ('Full-time', 'Part-time', 'Internship', 'Contract', 'Freelance'));

-- 2. Private storage bucket for uploaded JD PDFs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-descriptions', 'job-descriptions', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- 3. Storage RLS — companies may only read/write their own folder,
--    keyed by path prefix `{company_id}/...`
drop policy if exists "company_upload_own_jd" on storage.objects;
create policy "company_upload_own_jd"
  on storage.objects
  for insert
  with check (
    bucket_id = 'job-descriptions'
    and (storage.foldername(name))[1] in (
      select id::text from public.companies where owner_id = auth.uid()
    )
  );

drop policy if exists "company_read_own_jd" on storage.objects;
create policy "company_read_own_jd"
  on storage.objects
  for select
  using (
    bucket_id = 'job-descriptions'
    and (storage.foldername(name))[1] in (
      select id::text from public.companies where owner_id = auth.uid()
    )
  );

drop policy if exists "company_delete_own_jd" on storage.objects;
create policy "company_delete_own_jd"
  on storage.objects
  for delete
  using (
    bucket_id = 'job-descriptions'
    and (storage.foldername(name))[1] in (
      select id::text from public.companies where owner_id = auth.uid()
    )
  );
