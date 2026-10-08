-- ============================================================
-- AI Voice Interview Migration — Mirracle
-- Run AFTER migrations.sql (public.profiles must exist)
--
-- Two tables:
--   ai_voice_interview_sessions  one row per interview the backend started; used
--                          for the per-day quota and to tie a LiveKit room to
--                          the student who started it.
--   ai_voice_interview_reports   the graded result, written by the FastAPI
--                          /internal/ai-interview-reports webhook (service
--                          role, bypasses RLS) after the voice agent finishes.
--                          Students can only SELECT their own rows.
--
-- Scores are stored on a 0-100 scale (same as peer_interview_reports) so the
-- dashboard can aggregate both sources.
-- ============================================================

create table if not exists public.ai_voice_interview_sessions (
  id           uuid         primary key default gen_random_uuid(),
  room_id      text         not null unique,
  student_id   uuid         not null references public.profiles(id) on delete cascade,
  domain       text         not null check (domain in ('ai_ml','web_dev','dsa')),
  status       text         not null default 'started'
                            check (status in ('started','completed','abandoned')),
  started_at   timestamptz  not null default now(),
  ended_at     timestamptz
);

create index if not exists idx_ai_voice_interview_sessions_student_started
  on public.ai_voice_interview_sessions(student_id, started_at desc);

create table if not exists public.ai_voice_interview_reports (
  id                   uuid         primary key default gen_random_uuid(),
  room_id              text         not null unique,
  student_id           uuid         not null references public.profiles(id) on delete cascade,
  domain               text         not null check (domain in ('ai_ml','web_dev','dsa')),
  partial              boolean      not null default false,
  overall_score        numeric,
  technical_score      numeric,
  communication_score  numeric,
  strengths            text[],
  weaknesses           text[],
  red_flags            text[],
  per_question         jsonb,
  final_recommendation text,
  report_markdown      text,
  transcript           text,
  duration_seconds     integer,
  created_at           timestamptz  not null default now()
);

create index if not exists idx_ai_voice_interview_reports_student_created
  on public.ai_voice_interview_reports(student_id, created_at desc);

alter table public.ai_voice_interview_sessions enable row level security;
alter table public.ai_voice_interview_reports  enable row level security;

drop policy if exists "service_role_all_ai_voice_interview_sessions" on public.ai_voice_interview_sessions;
create policy "service_role_all_ai_voice_interview_sessions"
  on public.ai_voice_interview_sessions
  for all
  using      (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "student_select_own_ai_voice_interview_sessions" on public.ai_voice_interview_sessions;
create policy "student_select_own_ai_voice_interview_sessions"
  on public.ai_voice_interview_sessions
  for select
  using (auth.uid() = student_id);

drop policy if exists "service_role_all_ai_voice_interview_reports" on public.ai_voice_interview_reports;
create policy "service_role_all_ai_voice_interview_reports"
  on public.ai_voice_interview_reports
  for all
  using      (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- No INSERT/UPDATE/DELETE policy for students: writes come only from the
-- backend (service role).
drop policy if exists "student_select_own_ai_voice_interview_reports" on public.ai_voice_interview_reports;
create policy "student_select_own_ai_voice_interview_reports"
  on public.ai_voice_interview_reports
  for select
  using (auth.uid() = student_id);
