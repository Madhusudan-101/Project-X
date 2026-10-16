-- ============================================================
-- PeerMeet: better matching
--
-- Run AFTER peer_notifications_migration.sql. Idempotent.
--   * tickets can carry an optional topic; the matcher PREFERS someone waiting on the same topic
--     (or no topic) but never makes anyone wait for it: a different topic is still a match
--   * the matcher avoids pairing someone with the person they were matched with in the last 24 hours
--     (unless nobody else is waiting)
-- ============================================================

alter table public.peer_matchmaking_tickets
  add column if not exists topic text;

drop function if exists public.claim_peer_matchmaking_ticket(uuid, text);
drop function if exists public.claim_peer_matchmaking_ticket(uuid, text, text);

create or replace function public.claim_peer_matchmaking_ticket(
  p_student_id uuid,
  p_room_id    text,
  p_topic      text default null
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
   order by
     -- 1) people they have not just met (matched in the last 24 hours) come first
     (exists (select 1 from public.peer_matchmaking_tickets prev
               where prev.matched_at > now() - interval '24 hours'
                 and ((prev.student_id = p_student_id and prev.matched_with = t.student_id)
                   or (prev.student_id = t.student_id and prev.matched_with = p_student_id)))) asc,
     -- 2) then the same topic (or either side open to any topic)
     (case when p_topic is null or t.topic is null or t.topic = p_topic then 0 else 1 end) asc,
     -- 3) then whoever has waited longest
     t.created_at asc
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

grant execute on function public.claim_peer_matchmaking_ticket(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
