-- ============================================================
-- LinkedIn Analysis Migration — Mirracle
-- Run AFTER resume_analysis_migration.sql (public.model_versions,
-- public.profiles must exist).
--
-- Mirrors resume_analyses' shape/conventions (see
-- resume_analysis_migration.sql + its patch_v2). LinkedIn PDFs are never
-- persisted to storage (same as resumes today) — file_path stays null
-- until real file storage is introduced for either flow.
-- ============================================================

create table if not exists public.linkedin_analyses (
  id                uuid         primary key default gen_random_uuid(),
  candidate_id      uuid         references public.profiles(id) on delete set null,
  model_version_id  uuid         not null references public.model_versions(id),
  file_path         text,
  output_json       jsonb        not null,
  overall_score     numeric      not null,
  latency_ms        integer,
  created_at        timestamptz  not null default now()
);

-- Performance indexes
create index if not exists idx_linkedin_analyses_model_version_id on public.linkedin_analyses(model_version_id);
-- Drives "fetch this candidate's most recent LinkedIn analysis".
create index if not exists idx_linkedin_analyses_candidate_latest on public.linkedin_analyses(candidate_id, created_at desc);

-- Row-Level Security — service_role only, same convention as resume_analyses.
alter table public.linkedin_analyses enable row level security;

create policy "service_role_all_linkedin_analyses"
  on public.linkedin_analyses
  for all
  using      (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
