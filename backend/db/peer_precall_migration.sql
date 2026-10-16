-- ============================================================
-- PeerMeet: pre-call screen, per-session consent, no-show record, onboarding flag
--
-- Run AFTER peer_matching_preferences_migration.sql. Idempotent.
--
--   * peer_session_consents : each person's Yes/No to "this session may be recorded and reviewed by AI",
--                             one row per person per session (room), with the wording version they saw.
--                             The meeting server refuses live transcription and the AI interview unless
--                             BOTH people have a Yes on file.
--   * peer_user_flags       : one row per person. no_show_count (a plain count, no penalty logic) and
--                             interviewer_onboarding_seen_at (the one-time interviewer message).
--   * peer_scheduled_meetings.absent_id : who did not show up, when a meeting ends as a no-show.
--   * peer_user_reports     : two more reasons, 'rude' and 'not_genuine_effort'.
--   * peer_interview_reports.insufficient : the answer was too short to judge (no score is given).
--
-- All writes go through the FastAPI service-role client. People can read only their own rows.
-- ============================================================

create table if not exists public.peer_session_consents (
  id               uuid         primary key default gen_random_uuid(),
  student_id       uuid         not null references public.profiles(id) on delete cascade,
  room_id          text         not null,
  answer           boolean      not null,
  consent_version  text         not null,
  answered_at      timestamptz  not null default now(),
  constraint peer_session_consent_once unique (student_id, room_id)
);
create index if not exists idx_peer_session_consents_room on public.peer_session_consents(room_id);

alter table public.peer_session_consents enable row level security;
drop policy if exists "service_role_all_peer_session_consents" on public.peer_session_consents;
create policy "service_role_all_peer_session_consents" on public.peer_session_consents
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "student_select_own_peer_session_consents" on public.peer_session_consents;
create policy "student_select_own_peer_session_consents" on public.peer_session_consents
  for select using (auth.uid() = student_id);


create table if not exists public.peer_user_flags (
  student_id                      uuid         primary key references public.profiles(id) on delete cascade,
  no_show_count                   int          not null default 0 check (no_show_count >= 0),
  interviewer_onboarding_seen_at  timestamptz,
  updated_at                      timestamptz  not null default now()
);

alter table public.peer_user_flags enable row level security;
drop policy if exists "service_role_all_peer_user_flags" on public.peer_user_flags;
create policy "service_role_all_peer_user_flags" on public.peer_user_flags
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "student_select_own_peer_user_flags" on public.peer_user_flags;
create policy "student_select_own_peer_user_flags" on public.peer_user_flags
  for select using (auth.uid() = student_id);


alter table public.peer_scheduled_meetings
  add column if not exists absent_id uuid references public.profiles(id) on delete set null;


alter table public.peer_user_reports drop constraint if exists peer_user_reports_reason_check;
alter table public.peer_user_reports add constraint peer_user_reports_reason_check
  check (reason in (
    'harassment', 'inappropriate_content', 'impersonation', 'cheating_or_sharing_questions',
    'spam', 'no_show', 'rude', 'not_genuine_effort', 'other'));


alter table public.peer_interview_reports
  add column if not exists insufficient boolean not null default false;

notify pgrst, 'reload schema';
