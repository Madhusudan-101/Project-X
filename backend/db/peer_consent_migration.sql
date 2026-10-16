-- ============================================================
-- PeerMeet: guidelines and consent record
--
-- Run AFTER peer_safety_migration.sql. Idempotent.
--
-- One row per student: the version of the peer-interview guidelines they last accepted, and which
-- specific things they agreed to. The API refuses matching, scheduling, joining and room tokens
-- until the CURRENT version is accepted, so changing the rules (bump the version in code)
-- re-prompts everyone.
-- ============================================================

create table if not exists public.peer_consents (
  student_id        uuid         primary key references public.profiles(id) on delete cascade,
  version           text         not null,
  accepted_rules    boolean      not null default false,
  accepted_media    boolean      not null default false,   -- camera + microphone
  accepted_ai       boolean      not null default false,   -- live transcription and AI feedback (third-party processing)
  accepted_at       timestamptz  not null default now()
);

alter table public.peer_consents enable row level security;

drop policy if exists "service_role_all_peer_consents" on public.peer_consents;
create policy "service_role_all_peer_consents" on public.peer_consents
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "student_select_own_peer_consents" on public.peer_consents;
create policy "student_select_own_peer_consents" on public.peer_consents
  for select using (auth.uid() = student_id);

notify pgrst, 'reload schema';
