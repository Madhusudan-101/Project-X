-- ============================================================
-- AI Interviews for hiring teams — Mirracle
-- Run AFTER ai_voice_interview_migration.sql and ai_interview_integrity_migration.sql
--
-- Company interviews sit beside the existing candidate practice interviews:
--
--   practice   candidate picks one of three tracks (domain ai_ml / web_dev / dsa),
--              3 a day, and sees their own report. Unchanged.
--   company    a hiring team sets up an interview for a role with its own rubric,
--              invites candidates, and reads the results. One attempt per invite,
--              no daily quota, and the candidate does NOT see the report.
--
--   ai_interview_templates   the interview a company sets up (role, duration, rubric)
--   ai_interview_invites     one row per invited candidate (one per template + email)
--
-- A started session keeps a frozen copy of the rubric (rubric_snapshot), so editing a
-- template later never changes an interview that already happened.
-- ============================================================

create table if not exists public.ai_interview_templates (
  id               uuid         primary key default gen_random_uuid(),
  company_id       uuid         not null references public.companies(id) on delete cascade,
  created_by       uuid         not null references public.profiles(id) on delete cascade,
  job_id           uuid         references public.jobs(id) on delete set null,
  title            text         not null,
  role_title       text         not null,
  level            text         not null default 'junior'
                                check (level in ('intern','junior','mid','senior')),
  instructions     text         not null default '',
  duration_minutes integer      not null default 20 check (duration_minutes between 10 and 60),
  -- [{name, description, weight, questions[], expected_concepts}] validated by the API (1-8 items).
  rubric           jsonb        not null default '[]'::jsonb,
  version          integer      not null default 1,
  status           text         not null default 'draft'
                                check (status in ('draft','active','archived')),
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now()
);

create index if not exists idx_ai_interview_templates_company
  on public.ai_interview_templates(company_id, created_at desc);

create table if not exists public.ai_interview_invites (
  id             uuid         primary key default gen_random_uuid(),
  template_id    uuid         not null references public.ai_interview_templates(id) on delete cascade,
  company_id     uuid         not null references public.companies(id) on delete cascade,
  invited_by     uuid         not null references public.profiles(id) on delete cascade,
  email          text         not null,                       -- stored lowercase
  student_id     uuid         references public.profiles(id) on delete set null,
  application_id uuid,
  status         text         not null default 'invited'
                              check (status in ('invited','started','completed','revoked')),
  expires_at     timestamptz  not null,
  room_id        text,
  started_at     timestamptz,
  completed_at   timestamptz,
  last_emailed_at timestamptz,
  email_status   text,
  -- The hiring team's own call. Nothing here is set by the AI.
  decision       text         check (decision in ('advance','hold','reject')),
  decision_note  text,
  decided_by     uuid         references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  created_at     timestamptz  not null default now(),
  unique (template_id, email)
);

create index if not exists idx_ai_interview_invites_student on public.ai_interview_invites(student_id);
create index if not exists idx_ai_interview_invites_email   on public.ai_interview_invites(email);

-- Sessions: link to the invite and keep the frozen rubric. Company interviews use
-- domain = 'custom'.
alter table public.ai_voice_interview_sessions
  add column if not exists invite_id       uuid references public.ai_interview_invites(id) on delete set null,
  add column if not exists template_id     uuid,
  add column if not exists role_title      text,
  add column if not exists rubric_snapshot jsonb;

alter table public.ai_voice_interview_sessions
  drop constraint if exists ai_voice_interview_sessions_domain_check;
alter table public.ai_voice_interview_sessions
  add constraint ai_voice_interview_sessions_domain_check
  check (domain in ('ai_ml','web_dev','dsa','custom'));

-- Reports: per-competency scores, and whether the candidate may see the report.
-- Company-interview reports belong to the hiring team (candidate_visible = false).
alter table public.ai_voice_interview_reports
  add column if not exists competency_scores jsonb,
  add column if not exists candidate_visible boolean not null default true;

alter table public.ai_voice_interview_reports
  drop constraint if exists ai_voice_interview_reports_domain_check;
alter table public.ai_voice_interview_reports
  add constraint ai_voice_interview_reports_domain_check
  check (domain in ('ai_ml','web_dev','dsa','custom'));

-- Row level security. The API uses the service role; these policies only matter if
-- someone talks to PostgREST directly with a user token.
alter table public.ai_interview_templates enable row level security;
alter table public.ai_interview_invites   enable row level security;

drop policy if exists "service_role_all_ai_interview_templates" on public.ai_interview_templates;
create policy "service_role_all_ai_interview_templates" on public.ai_interview_templates
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "company_select_own_ai_interview_templates" on public.ai_interview_templates;
create policy "company_select_own_ai_interview_templates" on public.ai_interview_templates
  for select using (
    exists (select 1 from public.companies c where c.id = company_id and c.owner_id = auth.uid())
  );

drop policy if exists "service_role_all_ai_interview_invites" on public.ai_interview_invites;
create policy "service_role_all_ai_interview_invites" on public.ai_interview_invites
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "company_select_own_ai_interview_invites" on public.ai_interview_invites;
create policy "company_select_own_ai_interview_invites" on public.ai_interview_invites
  for select using (
    exists (select 1 from public.companies c where c.id = company_id and c.owner_id = auth.uid())
  );

drop policy if exists "student_select_own_ai_interview_invites" on public.ai_interview_invites;
create policy "student_select_own_ai_interview_invites" on public.ai_interview_invites
  for select using (auth.uid() = student_id);

-- Privacy: a session row now holds the company's private rubric (seed questions and
-- expected answers), so candidates must not be able to read session rows directly.
-- The app never does (it goes through the API); this closes the direct route.
drop policy if exists "student_select_own_ai_voice_interview_sessions" on public.ai_voice_interview_sessions;

-- And a candidate may only select reports that were made visible to them.
drop policy if exists "student_select_own_ai_voice_interview_reports" on public.ai_voice_interview_reports;
create policy "student_select_own_ai_voice_interview_reports"
  on public.ai_voice_interview_reports
  for select
  using (auth.uid() = student_id and candidate_visible);
