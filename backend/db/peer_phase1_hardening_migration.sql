-- ============================================================
-- PeerMeet Phase 1 hardening
--
-- Run AFTER:
--   apply_peer_matchmaking_and_scheduling.sql   (or the individual peer_* migrations)
--   peer_interview_reports_migration.sql
-- Idempotent: safe to run again.
--
-- What it fixes
--   1. A matched matchmaking ticket never ended, so a user could only be matched once.
--      Tickets now have a lifecycle (completed / expired) and matched tickets expire.
--   2. Ghost "waiting" tickets from closed browsers could be matched. Tickets now carry a
--      heartbeat (last_seen_at, refreshed on every poll) and stale ones are not matchable.
--   3. Any logged-in user could read raw scheduled-meeting rows (creator, invitee, privacy flag,
--      room id) over PostgREST. The over-broad policy is dropped; only the API reads them.
--   4. The report webhook could insert duplicates. Reports are now unique per
--      (room, student, role, phase) and carry phase / partner_private / unavailable.
--   5. Scheduled meetings nobody finished never closed. New status 'expired'.
-- ============================================================

-- ── 1+2. Matchmaking tickets ────────────────────────────────────────────────
alter table public.peer_matchmaking_tickets
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists ended_at     timestamptz;

alter table public.peer_matchmaking_tickets
  drop constraint if exists peer_matchmaking_tickets_status_check;
alter table public.peer_matchmaking_tickets
  add constraint peer_matchmaking_tickets_status_check
  check (status in ('waiting', 'matched', 'cancelled', 'expired', 'completed'));

-- A matched ticket is only "active" for 30 minutes. Collapse the ones that are already stale so
-- the one-active-ticket-per-student index no longer blocks those users from matching again.
update public.peer_matchmaking_tickets
   set status = 'expired', ended_at = now()
 where status = 'matched'
   and coalesce(matched_at, created_at) < now() - interval '30 minutes';

-- Matcher: sweeps abandoned tickets first, then claims the oldest LIVE waiting ticket.
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
  -- Waiting tickets that timed out or whose owner stopped polling (closed tab) are dead.
  update public.peer_matchmaking_tickets
     set status = 'expired', ended_at = now()
   where status = 'waiting'
     and (expires_at < now() or last_seen_at < now() - interval '30 seconds');

  -- Matched tickets stop being "active" after 30 minutes.
  update public.peer_matchmaking_tickets
     set status = 'expired', ended_at = now()
   where status = 'matched'
     and coalesce(matched_at, created_at) < now() - interval '30 minutes';

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

-- ── 3+5. Scheduled meetings ─────────────────────────────────────────────────
drop policy if exists "authenticated_select_public_peer_scheduled" on public.peer_scheduled_meetings;

alter table public.peer_scheduled_meetings
  drop constraint if exists peer_scheduled_meetings_status_check;
alter table public.peer_scheduled_meetings
  add constraint peer_scheduled_meetings_status_check
  check (status in ('scheduled', 'waiting', 'live', 'cancelled', 'completed', 'expired'));

-- ── 4. Reports: idempotent, phase-aware ─────────────────────────────────────
alter table public.peer_interview_reports
  add column if not exists phase           int     not null default 1,
  add column if not exists partner_private boolean,
  add column if not exists unavailable     boolean not null default false;

-- Collapse pre-existing duplicates (keep the newest) so the unique index can be created.
delete from public.peer_interview_reports r
 using public.peer_interview_reports newer
 where r.room_id = newer.room_id
   and r.student_id = newer.student_id
   and r.role = newer.role
   and r.phase = newer.phase
   and (r.created_at, r.id) < (newer.created_at, newer.id);

create unique index if not exists uniq_peer_reports_room_student_role_phase
  on public.peer_interview_reports(room_id, student_id, role, phase);

notify pgrst, 'reload schema';
