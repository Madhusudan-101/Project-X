#!/usr/bin/env python3
"""Delete Online Assessment webcam snapshots older than the retention period.

    cd backend && python scripts/purge_oa_snapshots.py [--days N] [--dry-run]

Removes the JPEGs from the private `oa-proctoring` bucket AND their oa_snapshots rows.
N defaults to OA_SNAPSHOT_RETENTION_DAYS (30). Run it daily (cron / scheduled task); the
instructions page tells candidates this number. The attempt counters (snapshots_taken, ...)
are kept, so a recruiter can still see that a flag existed after the photos are gone.
"""
import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.deps import db_client  # noqa: E402
from app.services.candidate import oa_snapshots  # noqa: E402

BATCH = 200


def purge(days: int, dry_run: bool = False) -> tuple[int, int]:
    """-> (removed, failed). Storage objects go first; rows only once their objects are gone."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    removed = failed = 0
    while True:
        rows = (db_client.table("oa_snapshots").select("id, path").lt("taken_at", cutoff)
                .order("taken_at", desc=False).limit(BATCH).execute().data or [])
        if not rows:
            break
        if dry_run:
            print(f"[dry run] {len(rows)}+ snapshots older than {days} days; stopping after the first batch.")
            break
        err = oa_snapshots.delete([r["path"] for r in rows])
        if err:
            print("storage delete failed, leaving rows so the next run retries:", err)
            failed += len(rows)
            break
        db_client.table("oa_snapshots").delete().in_("id", [r["id"] for r in rows]).execute()
        removed += len(rows)
    return removed, failed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    days = args.days or oa_snapshots.retention_days()
    removed, failed = purge(days, args.dry_run)
    if not args.dry_run:
        print(f"removed {removed} snapshot(s) older than {days} days" + (f"; {failed} failed" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
