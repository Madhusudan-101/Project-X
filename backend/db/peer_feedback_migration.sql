-- ============================================================
-- PeerMeet: post-meeting feedback
--
-- Run AFTER peer_consent_migration.sql. Idempotent.
-- One rating per person per meeting, about the experience and the partner. Used to improve matching
-- later; the partner never sees who rated them or what they wrote.
-- ============================================================

create table if not exists public.peer_feedback (
  id          uuid         primary key default gen_random_uuid(),
  student_id  uuid         not null references public.profiles(id) on delete cascade,
  room_id     text         not null,
  rating      int          not null check (rating between 1 and 5),
  tags        text[]       not null default '{}',
  comment     text,
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now(),
  constraint peer_feedback_once_per_room unique (student_id, room_id)
);

create index if not exists idx_peer_feedback_room on public.peer_feedback(room_id);

alter table public.peer_feedback enable row level security;

drop policy if exists "service_role_all_peer_feedback" on public.peer_feedback;
create policy "service_role_all_peer_feedback" on public.peer_feedback
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "student_select_own_peer_feedback" on public.peer_feedback;
create policy "student_select_own_peer_feedback" on public.peer_feedback
  for select using (auth.uid() = student_id);

notify pgrst, 'reload schema';
