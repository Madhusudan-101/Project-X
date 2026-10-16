-- ============================================================
-- AI Voice Interview — consent + integrity events — Mirracle
-- Run AFTER ai_voice_interview_migration.sql
--
--   ai_voice_interview_sessions.consent_at / consent_version
--       when the candidate accepted the interview rules, and which version
--       of the rules they accepted. Set by POST /candidate/ai-interview/session.
--
--   ai_voice_interview_sessions.video_consent
--       the candidate explicitly allowed the AI interviewer to view their camera
--       feed. The agent analyses video only when this is true, and the backend
--       refuses to store video observations when it is not.
--
--   ai_voice_interview_integrity_events
--       supervision signals during a live interview: reported by the candidate's
--       browser (tab left, window blurred, camera lost / restored) or by the
--       interviewer agent's video check (no face, more than one person, camera
--       blocked). `source` says which. Written only by the backend (service
--       role). Students can SELECT their own rows. No video or images are stored.
-- ============================================================

alter table public.ai_voice_interview_sessions
  add column if not exists consent_at      timestamptz,
  add column if not exists consent_version text,
  add column if not exists video_consent   boolean not null default false;

create table if not exists public.ai_voice_interview_integrity_events (
  id             uuid         primary key default gen_random_uuid(),
  room_id        text         not null
                              references public.ai_voice_interview_sessions(room_id) on delete cascade,
  student_id     uuid         not null references public.profiles(id) on delete cascade,
  kind           text         not null
                              check (kind in ('tab_hidden','window_blur','camera_lost','camera_restored',
                                              'no_face','multiple_faces','camera_blocked')),
  source         text         not null default 'browser' check (source in ('browser','agent')),
  offset_seconds integer      not null check (offset_seconds >= 0),
  created_at     timestamptz  not null default now()
);

-- Upgrade path: if an earlier version of this migration was already applied,
-- bring the table up to date (safe to run repeatedly).
alter table public.ai_voice_interview_integrity_events
  add column if not exists source text not null default 'browser';

alter table public.ai_voice_interview_integrity_events
  drop constraint if exists ai_voice_interview_integrity_events_kind_check;
alter table public.ai_voice_interview_integrity_events
  add constraint ai_voice_interview_integrity_events_kind_check
  check (kind in ('tab_hidden','window_blur','camera_lost','camera_restored',
                  'no_face','multiple_faces','camera_blocked'));

alter table public.ai_voice_interview_integrity_events
  drop constraint if exists ai_voice_interview_integrity_events_source_check;
alter table public.ai_voice_interview_integrity_events
  add constraint ai_voice_interview_integrity_events_source_check
  check (source in ('browser','agent'));

create index if not exists idx_ai_voice_interview_integrity_room
  on public.ai_voice_interview_integrity_events(room_id, created_at);

alter table public.ai_voice_interview_integrity_events enable row level security;

drop policy if exists "service_role_all_ai_voice_interview_integrity" on public.ai_voice_interview_integrity_events;
create policy "service_role_all_ai_voice_interview_integrity"
  on public.ai_voice_interview_integrity_events
  for all
  using      (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "student_select_own_ai_voice_interview_integrity" on public.ai_voice_interview_integrity_events;
create policy "student_select_own_ai_voice_interview_integrity"
  on public.ai_voice_interview_integrity_events
  for select
  using (auth.uid() = student_id);
