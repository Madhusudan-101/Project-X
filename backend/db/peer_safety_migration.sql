-- ============================================================
-- PeerMeet safety: reports, blocks and suspensions
--
-- Run AFTER peer_phase1_hardening_migration.sql. Idempotent.
--
--   peer_user_reports  a person reports the other person from a meeting they were both in.
--                      The reporter names the ROOM, never the person: the server resolves who the
--                      partner was, so anonymity is preserved and nobody can report a stranger.
--   peer_blocks        "never match me with this person again" (symmetric in effect).
--   peer_sanctions     warnings and suspensions from the peer feature (automatic or by an admin).
--
-- All writes go through the FastAPI service-role client. Students can read only their own rows.
-- ============================================================

create table if not exists public.peer_user_reports (
  id               uuid         primary key default gen_random_uuid(),
  reporter_id      uuid         not null references public.profiles(id) on delete cascade,
  reported_id      uuid         not null references public.profiles(id) on delete cascade,
  room_id          text         not null,
  reason           text         not null check (reason in (
                       'harassment', 'inappropriate_content', 'impersonation',
                       'cheating_or_sharing_questions', 'spam', 'no_show', 'other')),
  details          text,
  -- Server-captured context (e.g. the last transcript lines) when raised from inside the meeting.
  evidence         jsonb,
  source           text         not null default 'dashboard' check (source in ('dashboard', 'meeting')),
  status           text         not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  resolution_note  text,
  reviewed_by      uuid         references public.profiles(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz  not null default now(),
  constraint peer_report_not_self check (reporter_id <> reported_id),
  constraint peer_report_once_per_room unique (reporter_id, reported_id, room_id)
);

create index if not exists idx_peer_reports_reported_created on public.peer_user_reports(reported_id, created_at desc);
create index if not exists idx_peer_reports_status_created   on public.peer_user_reports(status, created_at desc);

create table if not exists public.peer_blocks (
  id          uuid         primary key default gen_random_uuid(),
  blocker_id  uuid         not null references public.profiles(id) on delete cascade,
  blocked_id  uuid         not null references public.profiles(id) on delete cascade,
  -- What the blocker may see in their list: the person's name only if they were not anonymous.
  label       text         not null default 'Anonymous Candidate',
  room_id     text,
  created_at  timestamptz  not null default now(),
  constraint peer_block_not_self check (blocker_id <> blocked_id),
  constraint peer_block_once unique (blocker_id, blocked_id)
);

create index if not exists idx_peer_blocks_blocked on public.peer_blocks(blocked_id);

create table if not exists public.peer_sanctions (
  id          uuid         primary key default gen_random_uuid(),
  student_id  uuid         not null references public.profiles(id) on delete cascade,
  kind        text         not null check (kind in ('warning', 'suspension')),
  reason      text         not null default '',
  starts_at   timestamptz  not null default now(),
  ends_at     timestamptz,                       -- null = until an admin lifts it
  report_id   uuid         references public.peer_user_reports(id) on delete set null,
  created_by  uuid         references public.profiles(id) on delete set null,   -- null = automatic
  lifted_at   timestamptz,
  created_at  timestamptz  not null default now()
);

create index if not exists idx_peer_sanctions_student on public.peer_sanctions(student_id, created_at desc);

-- A scheduled meeting that was open to anyone needs to remember who actually joined, so a report
-- about it can be resolved to a person.
alter table public.peer_scheduled_meetings
  add column if not exists second_joiner_id uuid references public.profiles(id) on delete set null;

alter table public.peer_user_reports enable row level security;
alter table public.peer_blocks       enable row level security;
alter table public.peer_sanctions    enable row level security;

drop policy if exists "service_role_all_peer_user_reports" on public.peer_user_reports;
create policy "service_role_all_peer_user_reports" on public.peer_user_reports
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "reporter_select_own_peer_user_reports" on public.peer_user_reports;
create policy "reporter_select_own_peer_user_reports" on public.peer_user_reports
  for select using (auth.uid() = reporter_id);

drop policy if exists "service_role_all_peer_blocks" on public.peer_blocks;
create policy "service_role_all_peer_blocks" on public.peer_blocks
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "blocker_select_own_peer_blocks" on public.peer_blocks;
create policy "blocker_select_own_peer_blocks" on public.peer_blocks
  for select using (auth.uid() = blocker_id);

drop policy if exists "service_role_all_peer_sanctions" on public.peer_sanctions;
create policy "service_role_all_peer_sanctions" on public.peer_sanctions
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop policy if exists "student_select_own_peer_sanctions" on public.peer_sanctions;
create policy "student_select_own_peer_sanctions" on public.peer_sanctions
  for select using (auth.uid() = student_id);

-- Matcher: same as before, but never pairs two people when either has blocked the other.
create or replace function public.claim_peer_matchmaking_ticket(
  p_student_id uuid,
  p_room_id    text
) returns table (
  ticket_id     uuid,
  peer_id       uuid,
  peer_private  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.peer_matchmaking_tickets%rowtype;
begin
  update public.peer_matchmaking_tickets
     set status = 'expired', ended_at = now()
   where status = 'waiting'
     and (expires_at < now() or last_seen_at < now() - interval '30 seconds');

  update public.peer_matchmaking_tickets
     set status = 'expired', ended_at = now()
   where status = 'matched'
     and coalesce(matched_at, created_at) < now() - interval '30 minutes';

  select t.*
    into v_row
    from public.peer_matchmaking_tickets t
   where t.status = 'waiting'
     and t.student_id <> p_student_id
     and not exists (
           select 1 from public.peer_blocks b
            where (b.blocker_id = p_student_id and b.blocked_id = t.student_id)
               or (b.blocker_id = t.student_id and b.blocked_id = p_student_id))
     and not exists (
           select 1 from public.peer_sanctions s
            where s.student_id = t.student_id
              and s.kind = 'suspension'
              and s.lifted_at is null
              and (s.ends_at is null or s.ends_at > now()))
   order by t.created_at asc
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.peer_matchmaking_tickets
     set status       = 'matched',
         room_id      = p_room_id,
         matched_with = p_student_id,
         matched_at   = now()
   where id = v_row.id;

  ticket_id    := v_row.id;
  peer_id      := v_row.student_id;
  peer_private := v_row.keep_private;
  return next;
end;
$$;

grant execute on function public.claim_peer_matchmaking_ticket(uuid, text) to service_role;

notify pgrst, 'reload schema';
