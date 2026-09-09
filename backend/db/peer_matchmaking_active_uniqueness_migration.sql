-- ============================================================
-- Peer Matchmaking — broaden the "active ticket per student"
-- uniqueness guard from waiting-only to (waiting OR matched)
--
-- Run AFTER peer_matchmaking_and_scheduling_migration.sql.
--
-- Why
-- ---
-- The original partial unique index was:
--   uniq_peer_mm_waiting_per_student  (student_id) WHERE status = 'waiting'
--
-- That prevents duplicate queue entries but leaves a race window when a
-- single user searches from two tabs concurrently: both RPC calls run to
-- completion (SKIP LOCKED just guarantees they pick different peers), each
-- router then inserts a fresh row with status='matched' for the same
-- caller, and the user ends up matched to two different peers in two
-- different rooms while both peers wait alone.
--
-- The corrected guard is:
--   uniq_peer_mm_active_per_student  (student_id) WHERE status IN ('waiting','matched')
--
-- Any second concurrent write from the same user then fails with a unique
-- violation, which peer.request_matchmaking already handles by re-reading
-- the existing row and returning it (see the "Unique violation → the other
-- request won" branch). No behavioral change for the single-tab flow.
--
-- Data cleanup
-- ------------
-- Existing production rows may already contain duplicate ('matched', same
-- student_id) pairs from before this guard existed. To avoid failing to
-- create the new index over pre-existing duplicates, we first collapse the
-- oldest duplicates in each cluster to 'cancelled' (keeping the newest
-- 'matched' row), which is the state the frontend and matcher already
-- ignore. Waiting duplicates would already have failed the old index, so
-- no cleanup is needed for those.
-- ============================================================

-- 1) Collapse pre-existing duplicate 'matched' rows per student, if any,
--    keeping the most recent one. Older duplicates get status='cancelled'
--    so the new partial index can be created without a unique violation.
with ranked as (
  select id,
         row_number() over (
           partition by student_id
           order by matched_at desc nulls last, created_at desc
         ) as rn
  from public.peer_matchmaking_tickets
  where status = 'matched'
)
update public.peer_matchmaking_tickets t
   set status = 'cancelled'
  from ranked
 where t.id = ranked.id
   and ranked.rn > 1;

-- 2) Drop the old waiting-only guard (kept for a beat via
--    'drop index if exists' so this migration is safely re-runnable).
drop index if exists public.uniq_peer_mm_waiting_per_student;

-- 3) Broaden the guard to cover matched too.
create unique index if not exists uniq_peer_mm_active_per_student
  on public.peer_matchmaking_tickets(student_id)
  where status in ('waiting', 'matched');

-- 4) Force PostgREST to see the new index immediately.
notify pgrst, 'reload schema';
