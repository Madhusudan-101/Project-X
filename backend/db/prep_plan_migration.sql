-- ============================================================
-- Personalized preparation plan — one row per application.
-- Built from the application's existing job-scoped scoring breakdown +
-- the drive's actual round list, via Gemini. Cached so repeat views are
-- free; regenerated on demand (?refresh=true).
--
-- Run AFTER db/jobs_and_applications_migration.sql and
-- db/job_drives_migration.sql. Idempotent.
-- ============================================================

create table if not exists public.application_prep_plans (
  id             uuid        primary key default gen_random_uuid(),
  application_id uuid        not null unique references public.applications(id) on delete cascade,
  student_id     uuid        not null references public.profiles(id) on delete cascade,
  plan_json      jsonb       not null,
  model_version  text,
  generated_at   timestamptz not null default now()
);

create index if not exists idx_prep_plans_student on public.application_prep_plans(student_id);

alter table public.application_prep_plans enable row level security;

-- Student reads only their own plan. No client INSERT/UPDATE — the
-- service-role backend is the only writer.
drop policy if exists prep_plans_student_read on public.application_prep_plans;
create policy prep_plans_student_read on public.application_prep_plans
  for select using (student_id = auth.uid());
