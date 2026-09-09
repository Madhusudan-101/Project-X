-- ============================================================
-- ONE-SHOT APPLY: Peer Matchmaking + Scheduled-Meeting Lifecycle
--
-- Concatenates the two migrations that create the tables the
-- /candidate/peer-* endpoints depend on, in the correct order,
-- and forces PostgREST to reload its schema cache at the end so
-- the new tables become visible to the REST API immediately
-- (without waiting for the ~30 s auto-refresh).
--
-- Idempotent — safe to re-run. Prerequisites:
--   * public.profiles exists (created by db/migrations.sql).
--   * public.trigger_set_updated_at() exists (also from migrations.sql).
--
-- Paste this whole file into the Supabase Dashboard → SQL Editor
-- and click "Run", OR pipe it through psql against the project's
-- Postgres connection string.
-- ============================================================


-- ── 1) Matchmaking tickets ────────────────────────────────────────────────
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

create index if not exists idx_peer_mm_student_status
  on public.peer_matchmaking_tickets(student_id, status);

-- Broadened active-ticket guard (covers waiting AND matched to close the
-- same-user double-match race). The old waiting-only variant is dropped
-- first so this file remains re-runnable against a pre-existing schema.
drop index if exists public.uniq_peer_mm_waiting_per_student;

create unique index if not exists uniq_peer_mm_active_per_student
  on public.peer_matchmaking_tickets(student_id)
  where status in ('waiting', 'matched');

create index if not exists idx_peer_mm_waiting_created
  on public.peer_matchmaking_tickets(created_at)
  where status = 'waiting';

alter table public.peer_matchmaking_tickets enable row level security;

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


-- ── 2) Atomic matcher RPC ────────────────────────────────────────────────
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


-- ── 3) Scheduled meetings ────────────────────────────────────────────────
create table if not exists public.peer_scheduled_meetings (
  id                uuid         primary key default gen_random_uuid(),
  room_id           text         not null unique,
  creator_id        uuid         not null references public.profiles(id) on delete cascade,
  invitee_id        uuid         references public.profiles(id) on delete set null,
  title             text,
  scheduled_at      timestamptz  not null,
  duration_minutes  int          not null default 30 check (duration_minutes between 5 and 240),
  keep_private      boolean      not null default false,
  status            text         not null default 'scheduled',
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

-- Widen the status check to the full lifecycle. Named explicitly so a
-- previous inline CHECK from an earlier create-table can be replaced.
alter table public.peer_scheduled_meetings
  drop constraint if exists peer_scheduled_meetings_status_check;

alter table public.peer_scheduled_meetings
  add constraint peer_scheduled_meetings_status_check
  check (status in ('scheduled', 'waiting', 'live', 'cancelled', 'completed'));

alter table public.peer_scheduled_meetings
  add column if not exists first_joiner_id uuid references public.profiles(id) on delete set null,
  add column if not exists live_at         timestamptz,
  add column if not exists completed_at    timestamptz;

create index if not exists idx_peer_scheduled_creator_time
  on public.peer_scheduled_meetings(creator_id, scheduled_at);
create index if not exists idx_peer_scheduled_invitee_time
  on public.peer_scheduled_meetings(invitee_id, scheduled_at);

-- Public-list filter uses status + scheduled_at together — index it so
-- the poll doesn't full-scan even after the table grows.
create index if not exists idx_peer_scheduled_status_time
  on public.peer_scheduled_meetings(status, scheduled_at);

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

drop policy if exists "student_select_own_peer_scheduled" on public.peer_scheduled_meetings;
create policy "student_select_own_peer_scheduled"
  on public.peer_scheduled_meetings
  for select
  using (auth.uid() = creator_id or auth.uid() = invitee_id);

drop policy if exists "authenticated_select_public_peer_scheduled" on public.peer_scheduled_meetings;
create policy "authenticated_select_public_peer_scheduled"
  on public.peer_scheduled_meetings
  for select
  using (auth.role() = 'authenticated');


-- ── 4) Kick PostgREST so the new tables are visible immediately ─────────
-- Without this, PGRST205 "Could not find the table ... in the schema cache"
-- can linger for up to ~30 seconds after the tables are created.
notify pgrst, 'reload schema';
