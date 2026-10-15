#!/usr/bin/env python3
"""Load backend/db/seed/oa_problems.json into Supabase (idempotent).

    python scripts/oa_import/seed_problems.py [seed.json]

Uses the service-role client from the app's env (SUPABASE_URL /
SUPABASE_SERVICE_ROLE_KEY). Re-running refreshes problems and replaces their
tests; problems you've already used in an assessment keep working because
oa_questions references them by id.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))

from app.deps import db_client  # noqa: E402


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parents[1] / "db" / "seed" / "oa_problems.json"
    problems = json.load(open(path))
    for p in problems:
        tests = p.pop("tests")
        db_client.table("oa_problems").upsert(p, on_conflict="id").execute()
        db_client.table("oa_problem_tests").delete().eq("problem_id", p["id"]).execute()
        db_client.table("oa_problem_tests").insert(
            [{"problem_id": p["id"], "position": i, "args": t["args"], "expected": t["expected"],
              "is_visible": t["is_visible"]} for i, t in enumerate(tests, start=1)]
        ).execute()
        print(("✓ " if p["validated"] else "· ") + p["id"], f"({len(tests)} tests)")
    ok = sum(1 for p in problems if p["validated"])
    print(f"\n{len(problems)} problems loaded, {ok} validated (selectable by companies).")


if __name__ == "__main__":
    main()
