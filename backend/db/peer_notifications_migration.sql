-- ============================================================
-- PeerMeet: notifications, no-shows and personal preferences
--
-- Run AFTER peer_feedback_migration.sql. Idempotent.
--   * remembers which emails were sent for a scheduled meeting, so each goes out once
--   * adds the 'no_show' status (someone waited, the other person never came)
--   * peer_preferences: default privacy, timezone and email choices for each person
-- ============================================================

alter table public.peer_scheduled_meetings
  add column if not exists invited_emailed_at timestamptz,
  add column if not exists reminded_day_at    timestamptz,
  add column if not exists reminded_soon_at   timestamptz,
  add column if not exists no_show_at         timestamptz;

alter table public.peer_scheduled_meetings
  drop constraint if exists peer_scheduled_meetings_status_check;
alter table public.peer_scheduled_meetings
  add constraint peer_scheduled_meetings_status_check
  check (status in ('scheduled', 'waiting', 'live', 'cancelled', 'completed', 'expired', 'no_show'));

create table if not exists public.peer_preferences (
  student_id      uuid         primary key references public.profiles(id) on delete cascade,
  default_private boolean      not null default true,
  timezone        text,
  email_invites   boolean      not null default true,
  email_reminders boolean      not null default true,
  updated_at      timestamptz  not null default now()
);

alter table public.peer_preferences enable row level security;

drop policy if exists "service_role_all_peer_preferences" on public.peer_preferences;
create policy "service_role_all_peer_preferences" on public.peer_preferences
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "student_select_own_peer_preferences" on public.peer_preferences;
create policy "student_select_own_peer_preferences" on public.peer_preferences
  for select using (auth.uid() = student_id);

notify pgrst, 'reload schema';
