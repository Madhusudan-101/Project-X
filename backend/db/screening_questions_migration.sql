-- ============================================================
-- Screener questions + cover letter at apply time — Mirracle
--
-- A company attaches optional screening questions to a job at creation
-- time (no AI on that side). When a student applies to a job that HAS
-- questions, the apply flow first drafts a cover letter + per-question
-- answers (AI), the student edits/fills them, and the submitted answers
-- + cover letter are stored alongside the application.
--
-- Run AFTER db/jobs_and_applications_migration.sql. Idempotent.
-- ============================================================

-- ── 1. job_screening_questions — set once, at job creation ──────────
create table if not exists public.job_screening_questions (
  id            uuid        primary key default gen_random_uuid(),
  job_id        uuid        not null references public.jobs(id) on delete cascade,
  question_text text        not null,
  required      boolean     not null default true,
  position      int         not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists idx_job_screening_questions_job_id
  on public.job_screening_questions(job_id, position);


-- ── 2. applications.cover_letter — the (edited) drafted cover letter ─
alter table public.applications
  add column if not exists cover_letter text;


-- ── 3. application_screening_answers — the student's submitted answers
create table if not exists public.application_screening_answers (
  id             uuid        primary key default gen_random_uuid(),
  application_id uuid        not null references public.applications(id)             on delete cascade,
  question_id    uuid        not null references public.job_screening_questions(id)  on delete cascade,
  answer         text,
  created_at     timestamptz not null default now(),
  unique (application_id, question_id)
);

create index if not exists idx_application_screening_answers_application
  on public.application_screening_answers(application_id);


-- ═════════════════════════ ROW-LEVEL SECURITY ═══════════════════════
-- Mirrors db/jobs_and_applications_migration.sql. The FastAPI backend
-- uses the service role and bypasses all of this.

alter table public.job_screening_questions       enable row level security;
alter table public.application_screening_answers enable row level security;

-- job_screening_questions: owning company manages its own; students read
-- for live jobs (same shape as job_skills).
drop policy if exists jsq_company on public.job_screening_questions;
create policy jsq_company on public.job_screening_questions
  for all
  using      (job_id in (select id from public.jobs where company_id = public.current_company_id()))
  with check (job_id in (select id from public.jobs where company_id = public.current_company_id()));

drop policy if exists jsq_student_read on public.job_screening_questions;
create policy jsq_student_read on public.job_screening_questions
  for select using (
    exists (select 1 from public.jobs j where j.id = job_screening_questions.job_id and j.status = 'live')
  );

-- application_screening_answers: student manages own; company reads for
-- its own jobs' applications.
drop policy if exists asa_student_rw on public.application_screening_answers;
create policy asa_student_rw on public.application_screening_answers
  for all
  using      (application_id in (select id from public.applications where student_id = auth.uid()))
  with check (application_id in (select id from public.applications where student_id = auth.uid()));

drop policy if exists asa_company_read on public.application_screening_answers;
create policy asa_company_read on public.application_screening_answers
  for select using (
    application_id in (select id from public.applications where company_id = public.current_company_id())
  );
