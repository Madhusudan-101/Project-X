-- ============================================================
-- Peer Scheduled Meetings — Lifecycle Migration
--
-- Run AFTER peer_matchmaking_and_scheduling_migration.sql.
--
-- Extends the meeting status enum with intermediate states and adds
-- columns the API uses to track WHO joined first and WHEN the meeting
-- actually went live / completed.
--
-- Status ladder (transitions enforced in FastAPI, not the DB):
--   scheduled  → default; nobody has joined yet.
--   waiting    → the first authorized participant clicked Join.
--   live       → the second (different) authorized participant clicked Join.
--   completed  → set by the /internal/peer-reports webhook when the AI
--                report actually lands — not by clock or by first-join.
--   cancelled  → creator explicitly cancelled.
-- ============================================================

alter table public.peer_scheduled_meetings
  drop constraint if exists peer_scheduled_meetings_status_check;

alter table public.peer_scheduled_meetings
  add constraint peer_scheduled_meetings_status_check
  check (status in ('scheduled', 'waiting', 'live', 'cancelled', 'completed'));

alter table public.peer_scheduled_meetings
  add column if not exists first_joiner_id uuid references public.profiles(id) on delete set null,
  add column if not exists live_at         timestamptz,
  add column if not exists completed_at    timestamptz;

-- The public "Upcoming" list filters on `status IN (...)` AND `scheduled_at
-- >= cutoff`. Without a composite index the query full-scans the table on
-- every 15-second poll from every dashboard tab; this makes the filter
-- planner-friendly at any table size.
create index if not exists idx_peer_scheduled_status_time
  on public.peer_scheduled_meetings(status, scheduled_at);

-- Public discovery: any AUTHENTICATED student may SELECT a meeting row so
-- the "Upcoming" panel can list every non-completed public/invited meeting.
-- The API layer redacts private fields (creator_id, invitee_id) before
-- returning to non-participants; RLS only gates raw table access, which
-- our routers never do for the public list (they use service-role +
-- explicit field redaction).
--
-- The existing "student_select_own_peer_scheduled" policy stays in place
-- for the "my meetings" view. Multiple SELECT policies on the same table
-- are additively OR'd in Postgres.
drop policy if exists "authenticated_select_public_peer_scheduled" on public.peer_scheduled_meetings;
create policy "authenticated_select_public_peer_scheduled"
  on public.peer_scheduled_meetings
  for select
  using (auth.role() = 'authenticated');

-- Refresh PostgREST's schema cache so the new columns/policies are
-- immediately visible over the REST API (avoids ~30 s PGRST205 window).
notify pgrst, 'reload schema';
