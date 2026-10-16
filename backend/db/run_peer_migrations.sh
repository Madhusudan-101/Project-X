#!/usr/bin/env bash
# Runs every PeerMeet SQL file against your database, in the right order, from the terminal.
#
#   export DATABASE_URL='postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres'
#   ./backend/db/run_peer_migrations.sh            # run all
#   ./backend/db/run_peer_migrations.sh --dry-run  # only list what would run
#
# Get the URL in Supabase: Project Settings > Database > Connection string (URI). Use the direct (5432)
# or session-pooler string, not the transaction pooler. Every file is safe to run again, and the script
# stops at the first error so you never end up half-migrated without knowing.
set -euo pipefail

cd "$(dirname "$0")"

FILES=(
  apply_peer_matchmaking_and_scheduling.sql
  peer_interview_reports_migration.sql
  peer_phase1_hardening_migration.sql
  peer_safety_migration.sql
  peer_consent_migration.sql
  peer_feedback_migration.sql
  peer_notifications_migration.sql
  peer_matching_preferences_migration.sql
  peer_precall_migration.sql
)

if [[ "${1:-}" == "--dry-run" ]]; then
  printf 'Would run, in order:\n'
  printf '  %s\n' "${FILES[@]}"
  exit 0
fi

: "${DATABASE_URL:?Set DATABASE_URL to your Supabase connection string first (see the top of this file).}"
command -v psql >/dev/null || { echo "psql is not installed (macOS: brew install libpq, Ubuntu: apt install postgresql-client)."; exit 1; }

for f in "${FILES[@]}"; do
  echo "==> $f"
  psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --quiet --file "$f"
done
echo "Done. All PeerMeet migrations applied."
