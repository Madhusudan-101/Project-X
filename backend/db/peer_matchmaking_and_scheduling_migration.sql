-- ============================================================
-- Peer Interview: Matchmaking + Scheduling Migration
--
-- Run AFTER migrations.sql (public.profiles must exist) and after
-- peer_interview_reports_migration.sql (not strictly required but they belong
-- to the same feature slice).
--
-- Two new tables:
--   peer_matchmaking_tickets  — one row per active "find me a partner" request.
--     Atomic pair-matching is enforced by claim_peer_matchmaking_ticket() below.
--   peer_scheduled_meetings   — user-created scheduled interviews with a
--     stable room_id both the creator and (optionally) an invitee can join.
--
-- Both writes go through the FastAPI service-role client; SELECT is RLS-scoped
-- so a student sees only their own tickets/meetings.
-- ============================================================

-- ── Matchmaking tickets ────────────────────────────────────────────────────
create table if not exists public.peer_matchmaking_tickets (
  id              uuid         primary key default gen_random_uuid(),
  student_id      uuid         not null references public.profiles(id) on delete cascade,
  status          text         not null default 'waiting'
                                check (status in ('waiting', 'matched', 'cancelled', 'expired')),
  room_id         text,
  matched_with    uuid         references public.profiles(id) on delete set null,
  keep_private    boolean      not null default false,
  created_at      timestamptz  not null default now(),
  matched_at      timestamptz,
  expires_at      timestamptz  not null default (now() + interval '10 minutes')
);

-- Fast lookup of the current active ticket for a student.
create index if not exists idx_peer_mm_student_status
  on public.peer_matchmaking_tickets(student_id, status);

-- Partial unique index: a single student can have at most ONE waiting ticket
-- at a time. Prevents duplicate queue entries on double-clicks and
-- resurrected polling requests.
create unique index if not exists uniq_peer_mm_waiting_per_student
  on public.peer_matchmaking_tickets(student_id)
  where status = 'waiting';

-- FIFO ordering for the matcher.
create index if not exists idx_peer_mm_waiting_created
  on public.peer_matchmaking_tickets(created_at)
  where status = 'waiting';

alter table public.peer_matchmaking_tickets enable row level security;

-- Service-role does everything; students read only their own rows.
drop policy if exists "service_role_all_peer_mm" on public.peer_matchmaking_tickets;
create policy "service_role_all_peer_mm"
  on public.peer_matchmaking_tickets
  for all
  using      (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "student_select_own_peer_mm" on public.peer_matchmaking_tickets;
create policy "student_select_own_peer_mm"
  on public.peer_matchmaking_tickets
  for select
  using (auth.uid() = student_id);

-- Atomic matcher.
-- Claims the OLDEST currently-waiting ticket that does NOT belong to
-- `p_student_id`, marks it 'matched', stamps `matched_with = p_student_id`
-- and `room_id = p_room_id`, and returns the claimed row. Uses FOR UPDATE
-- SKIP LOCKED so two simultaneous callers can't claim the same peer.
-- Returns 0 rows when nothing is waiting.
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
  -- Sweep obviously-abandoned tickets first so we never match against them.
  update public.peer_matchmaking_tickets
     set status = 'expired'
   where status = 'waiting'
     and expires_at < now();

  select *
    into v_row
    from public.peer_matchmaking_tickets
   where status = 'waiting'
     and student_id <> p_student_id
   order by created_at asc
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

-- ── Scheduled meetings ─────────────────────────────────────────────────────
create table if not exists public.peer_scheduled_meetings (
  id                uuid         primary key default gen_random_uuid(),
  room_id           text         not null unique,
  creator_id        uuid         not null references public.profiles(id) on delete cascade,
  invitee_id        uuid         references public.profiles(id) on delete set null,
  title             text,
  scheduled_at      timestamptz  not null,
  duration_minutes  int          not null default 30 check (duration_minutes between 5 and 240),
  keep_private      boolean      not null default false,
  status            text         not null default 'scheduled'
                                    check (status in ('scheduled', 'cancelled', 'completed')),
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

create index if not exists idx_peer_scheduled_creator_time
  on public.peer_scheduled_meetings(creator_id, scheduled_at);
create index if not exists idx_peer_scheduled_invitee_time
  on public.peer_scheduled_meetings(invitee_id, scheduled_at);

drop trigger if exists set_updated_at on public.peer_scheduled_meetings;
create trigger set_updated_at
  before update on public.peer_scheduled_meetings
  for each row execute procedure trigger_set_updated_at();

alter table public.peer_scheduled_meetings enable row level security;

drop policy if exists "service_role_all_peer_scheduled" on public.peer_scheduled_meetings;
create policy "service_role_all_peer_scheduled"
  on public.peer_scheduled_meetings
  for all
  using      (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- A student may read meetings they created OR were invited to.
drop policy if exists "student_select_own_peer_scheduled" on public.peer_scheduled_meetings;
create policy "student_select_own_peer_scheduled"
  on public.peer_scheduled_meetings
  for select
  using (auth.uid() = creator_id or auth.uid() = invitee_id);

-- Kick PostgREST so the new tables become visible via the REST API
-- immediately; without this the schema-cache autorefresh can take up to
-- ~30 s and clients see PGRST205 "Could not find the table ... in the
-- schema cache" in the meantime.
notify pgrst, 'reload schema';
