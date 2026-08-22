-- ============================================================
-- Resume Analysis Tracking Migration — Mirracle
-- Run AFTER migrations.sql (public.profiles must exist)
-- ============================================================

-- 1. model_versions — one row per prompt/model iteration, so every
--    analysis can be traced back to exactly what produced it.
create table if not exists public.model_versions (
  id            uuid         primary key default gen_random_uuid(),
  version_label text         not null unique,
  prompt_text   text         not null,
  change_notes  text,
  created_at    timestamptz  not null default now()
);

-- 2. test_batches — a labeled run of a model version against a set of
--    resumes, used for offline evaluation before promoting a prompt change.
create table if not exists public.test_batches (
  id                uuid         primary key default gen_random_uuid(),
  batch_label       text         not null,
  model_version_id  uuid         not null references public.model_versions(id),
  run_date          date         default current_date,
  purpose_notes     text,
  created_at        timestamptz  not null default now()
);

-- 3. resume_analyses — a single resume-analysis result, whether produced by
--    a real candidate upload or a test-batch run.
create table if not exists public.resume_analyses (
  id                    uuid         primary key default gen_random_uuid(),
  candidate_id          uuid         references public.profiles(id) on delete set null,
  batch_id              uuid         references public.test_batches(id) on delete set null,
  model_version_id      uuid         not null references public.model_versions(id),
  role_target           text         not null,
  source                text         not null,
  resume_file_url       text,
  parsed_resume_text    text,
  portfolio_metrics_json jsonb,
  output_json           jsonb        not null,
  overall_score         numeric      not null,
  latency_ms            integer,
  created_at            timestamptz  not null default now(),
  constraint resume_analyses_source_check
    check (source in ('real_user', 'test_batch'))
);

-- 4. analysis_feedback — a reviewer's verdict on one resume_analyses row,
--    used to track model accuracy over time.
create table if not exists public.analysis_feedback (
  id                  uuid         primary key default gen_random_uuid(),
  analysis_id         uuid         not null references public.resume_analyses(id) on delete cascade,
  reviewer_name       text         not null,
  agree_with_verdict  boolean      not null,
  corrected_score     numeric,
  comment             text,
  created_at          timestamptz  not null default now()
);

-- 5. Performance indexes
create index if not exists idx_resume_analyses_model_version_id on public.resume_analyses(model_version_id);
create index if not exists idx_resume_analyses_batch_id         on public.resume_analyses(batch_id);
create index if not exists idx_resume_analyses_created_at       on public.resume_analyses(created_at desc);
-- Drives "fetch this candidate's most recent analysis" for incremental re-analysis.
create index if not exists idx_resume_analyses_candidate_latest on public.resume_analyses(candidate_id, created_at desc);
create index if not exists idx_analysis_feedback_analysis_id    on public.analysis_feedback(analysis_id);

-- 6. Row-Level Security — service_role only for now; no anon/authenticated
--    policies until candidate- or reviewer-facing access is designed.
alter table public.model_versions   enable row level security;
alter table public.test_batches     enable row level security;
alter table public.resume_analyses  enable row level security;
alter table public.analysis_feedback enable row level security;

create policy "service_role_all_model_versions"
  on public.model_versions
  for all
  using      (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service_role_all_test_batches"
  on public.test_batches
  for all
  using      (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service_role_all_resume_analyses"
  on public.resume_analyses
  for all
  using      (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service_role_all_analysis_feedback"
  on public.analysis_feedback
  for all
  using      (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
