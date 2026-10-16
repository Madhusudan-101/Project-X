#!/usr/bin/env bash
# Proves, on a throwaway Postgres, that:
#   * every PeerMeet migration runs, and runs again without errors (idempotent);
#   * a person can read only THEIR OWN consent answers, report rows and flags, and cannot write any of them;
#   * the new report reasons, the no-show status and the absent_id column exist;
#   * the same-session consent rule (one answer per person per session) is enforced by the database.
# It starts its own temporary server, so it never touches a real database. Needs Postgres 16 binaries.
#   backend/tests/sql/peer_precall_rls_test.sh
set -euo pipefail
B="${PG_BIN:-/usr/lib/postgresql/16/bin}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DB_DIR="$(cd "$HERE/../../db" && pwd)"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54330}"
RUN=""
if [[ "$(id -u)" == "0" ]]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  chown postgres "$WORK"; chmod 755 "$WORK"
  RUN="su postgres -c"
fi
run() { if [[ -n "$RUN" ]]; then $RUN "$1"; else bash -c "$1"; fi; }
cleanup() { run "$B/pg_ctl -D $WORK/data -m fast stop" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
run "$B/initdb -D $WORK/data -A trust >/dev/null && $B/pg_ctl -D $WORK/data -o '-p $PORT -k $WORK' -l $WORK/log -w start >/dev/null"
export PGOPTIONS="-c client_min_messages=warning"
P="psql -h $WORK -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -d postgres"

$P <<'SQL'
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create or replace function public.trigger_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create table public.profiles (id uuid primary key, email text, role text, name text, first_name text, last_name text, branch text, college_id uuid);
create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public, auth to authenticated, service_role;
SQL

FILES=(apply_peer_matchmaking_and_scheduling.sql peer_interview_reports_migration.sql peer_phase1_hardening_migration.sql
  peer_safety_migration.sql peer_consent_migration.sql peer_feedback_migration.sql peer_notifications_migration.sql
  peer_matching_preferences_migration.sql peer_precall_migration.sql)
for pass in 1 2; do
  for f in "${FILES[@]}"; do $P -f "$DB_DIR/$f" >/dev/null; done
  echo "ok: all ${#FILES[@]} migrations ran (pass $pass)"
done
$P -c "grant select, insert, update, delete on all tables in schema public to authenticated, service_role"

ALICE=aaaaaaaa-0000-0000-0000-000000000001; BOB=bbbbbbbb-0000-0000-0000-000000000002
$P <<SQL
insert into public.profiles(id,email,role) values ('$ALICE','a@t.dev','candidate'),('$BOB','b@t.dev','candidate');
insert into public.peer_session_consents(student_id, room_id, answer, consent_version) values
  ('$ALICE','room-1',true,'v1'), ('$BOB','room-1',false,'v1');
insert into public.peer_user_flags(student_id, no_show_count, interviewer_onboarding_seen_at) values
  ('$ALICE', 2, now()), ('$BOB', 0, null);
insert into public.peer_user_reports(reporter_id, reported_id, room_id, reason, details) values
  ('$ALICE','$BOB','room-1','rude','x'), ('$BOB','$ALICE','room-1','not_genuine_effort','y');
SQL

as_user() { # as_user <uuid> <sql>  : run as a signed-in person (RLS applies)
  $P -tA <<SQL
set role authenticated; select set_config('request.jwt.claim.sub', '$1', false) as _ \\gset
$2
SQL
}
expect() { # expect <label> <got> <want>
  if [[ "$2" == "$3" ]]; then echo "ok: $1"; else echo "FAIL: $1 (got '$2', want '$3')"; exit 1; fi
}
expect_denied() { # expect_denied <label> <uuid> <sql>
  if as_user "$2" "$3" >/dev/null 2>&1; then
    local n; n=$(as_user "$2" "$3" 2>&1 | grep -c "^UPDATE 0\|^DELETE 0\|^INSERT 0" || true)
    echo "FAIL: $1 (write was allowed)"; exit 1
  else echo "ok: $1"; fi
}

expect "Alice reads only her own consent rows" "$(as_user $ALICE "select count(*) from public.peer_session_consents;")" "1"
expect "...and it is hers" "$(as_user $ALICE "select student_id from public.peer_session_consents;")" "$ALICE"
expect "Bob cannot see Alice's consent" "$(as_user $BOB "select count(*) from public.peer_session_consents where student_id='$ALICE';")" "0"
expect "Alice reads only her own flags" "$(as_user $ALICE "select count(*) from public.peer_user_flags;")" "1"
expect "Bob cannot see Alice's no-show count" "$(as_user $BOB "select count(*) from public.peer_user_flags where student_id='$ALICE';")" "0"
expect "Alice sees only reports she filed" "$(as_user $ALICE "select count(*) from public.peer_user_reports;")" "1"
expect "...and not the one about her" "$(as_user $ALICE "select count(*) from public.peer_user_reports where reported_id='$ALICE';")" "0"
expect "Bob's reports are invisible to Alice" "$(as_user $ALICE "select count(*) from public.peer_user_reports where reporter_id='$BOB';")" "0"

expect_denied "Nobody can write a Yes for themselves from the browser" "$ALICE" "insert into public.peer_session_consents(student_id,room_id,answer,consent_version) values ('$ALICE','room-2',true,'v1');"
expect_denied "Nobody can write a Yes for someone else" "$ALICE" "insert into public.peer_session_consents(student_id,room_id,answer,consent_version) values ('$BOB','room-2',true,'v1');"
expect "Alice cannot flip Bob's No to Yes" "$(as_user $ALICE "update public.peer_session_consents set answer=true where student_id='$BOB'; select answer from public.peer_session_consents where student_id='$BOB';" | tail -1)" ""
expect "...Bob's answer is still No" "$($P -tA -c "select answer from public.peer_session_consents where student_id='$BOB';")" "f"
as_user $ALICE "update public.peer_user_flags set no_show_count=0 where student_id='$ALICE'; update public.peer_user_flags set interviewer_onboarding_seen_at=null where student_id='$ALICE';" >/dev/null 2>&1 || true
expect "Alice cannot reset her own no-show count" "$($P -tA -c "select no_show_count from public.peer_user_flags where student_id='$ALICE';")" "2"
expect "...or un-see the onboarding message" "$($P -tA -c "select (interviewer_onboarding_seen_at is not null) from public.peer_user_flags where student_id='$ALICE';")" "t"
expect_denied "Nobody can file a report from the browser (reports go through the API)" "$ALICE" "insert into public.peer_user_reports(reporter_id,reported_id,room_id,reason) values ('$ALICE','$BOB','room-9','rude');"
as_user $ALICE "delete from public.peer_user_reports; delete from public.peer_session_consents; delete from public.peer_user_flags;" >/dev/null 2>&1 || true
expect "Deleting from the browser removes nothing" "$($P -tA -c "select (select count(*) from public.peer_user_reports) || '/' || (select count(*) from public.peer_session_consents) || '/' || (select count(*) from public.peer_user_flags);")" "2/2/2"

$P <<SQL
set role service_role; select set_config('request.jwt.claim.role','service_role',false) as _ \\gset
insert into public.peer_session_consents(student_id,room_id,answer,consent_version) values ('$ALICE','room-3',true,'v1');
SQL
expect "The service role (the API) can write consent" "$($P -tA -c "select count(*) from public.peer_session_consents where room_id='room-3';")" "1"

# the database's own rules
$P -tA -c "insert into public.peer_session_consents(student_id,room_id,answer,consent_version) values ('$ALICE','room-1',true,'v1');" >/dev/null 2>&1 && { echo "FAIL: a second answer for the same session was accepted"; exit 1; } || echo "ok: one answer per person per session"
$P -tA -c "insert into public.peer_user_reports(reporter_id,reported_id,room_id,reason) values ('$ALICE','$BOB','room-5','not_a_reason');" >/dev/null 2>&1 && { echo "FAIL: an unknown report reason was accepted"; exit 1; } || echo "ok: unknown report reasons are refused"
expect "Both new report reasons exist" "$($P -tA -c "select count(*) from public.peer_user_reports where reason in ('rude','not_genuine_effort');")" "2"
expect "no_show is a valid meeting status" "$($P -tA -c "select count(*) from pg_constraint where conname='peer_scheduled_meetings_status_check' and pg_get_constraintdef(oid) like '%no_show%';")" "1"
expect "absent_id exists" "$($P -tA -c "select count(*) from information_schema.columns where table_name='peer_scheduled_meetings' and column_name='absent_id';")" "1"
expect "insufficient exists and defaults to false" "$($P -tA -c "select column_default from information_schema.columns where table_name='peer_interview_reports' and column_name='insufficient';")" "false"
echo "ALL SQL CHECKS PASSED"
