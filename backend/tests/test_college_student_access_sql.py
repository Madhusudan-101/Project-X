"""
student_access_and_onboarding_migration.sql -- runs it (after the repo's
other migrations) on a THROWAWAY PostgreSQL and checks the new columns'
constraints and that RLS still enforces college isolation on them.

Needs a scratch Postgres server you can create databases on. It is NOT run
against Supabase -- the test refuses any host containing "supabase".

    ADMIN_TEST_DATABASE_URL=postgresql://postgres@localhost:54329/postgres \
        python tests/test_college_student_access_sql.py

Skips (exit 0) when ADMIN_TEST_DATABASE_URL is unset. Exits 1 on any failure.
Creates database `college_student_access_test` and drops it at the end.
"""

from __future__ import annotations

import os
import sys
from urllib.parse import urlparse, urlunparse

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, HERE)

URL = os.environ.get("ADMIN_TEST_DATABASE_URL")
if not URL:
    print("SKIP: set ADMIN_TEST_DATABASE_URL to a scratch Postgres to run this test.")
    sys.exit(0)
if "supabase" in URL.lower():
    print("REFUSING: this test creates/drops a database and must never target Supabase.")
    sys.exit(1)

import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402

from test_admin_portal_sql import MIGRATIONS as BASE_MIGRATIONS, PRELUDE  # noqa: E402

DB = "college_student_access_test"
_parsed = urlparse(URL)
SERVER_URL = URL
TEST_URL = urlunparse(_parsed._replace(path=f"/{DB}"))

MIGRATIONS = BASE_MIGRATIONS + ["db/student_access_and_onboarding_migration.sql"]

C1, C2 = "c1000000-0000-0000-0000-000000000001", "c2000000-0000-0000-0000-000000000002"
T1, T2 = "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"

FIXTURE = f"""
insert into auth.users (id, email) values ('{T1}', 't1@x.test'), ('{T2}', 't2@x.test');
insert into public.colleges (id, name) values ('{C1}', 'Alpha College'), ('{C2}', 'Beta Institute');
insert into public.profiles (id, email, role, college_id) values
  ('{T1}', 't1@x.test', 'college', '{C1}'),
  ('{T2}', 't2@x.test', 'college', '{C2}');
insert into public.students (id, college_id, name, email, branch, graduation_year) values
  ('00000000-0000-0000-0000-0000000000a1', '{C1}', 'Stu One', 's1@x.test', 'CSE', 2026);
"""

passed = failed = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {label}")
    else:
        failed += 1
        print(f"  [FAIL] {label} -- {detail}")


def attempt(cur, sql: str) -> str:
    try:
        cur.execute(sql)
        return "ok"
    except psycopg2.Error as e:
        return e.pgcode or "error"


def main() -> int:
    admin = psycopg2.connect(SERVER_URL)
    admin.autocommit = True
    with admin.cursor() as cur:
        cur.execute(f"drop database if exists {DB}")
        cur.execute(f"create database {DB}")

    conn = psycopg2.connect(TEST_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print("\n== Setup: repo migrations + student_access_and_onboarding_migration.sql ==")
    cur.execute(PRELUDE)
    for path in MIGRATIONS:
        with open(os.path.join(BACKEND, path), encoding="utf-8") as f:
            cur.execute(f.read())
    print(f"  applied {len(MIGRATIONS)} migrations")
    with open(os.path.join(BACKEND, MIGRATIONS[-1]), encoding="utf-8") as f:
        cur.execute(f.read())
    check("migration is idempotent (second run succeeds)", True)
    cur.execute(FIXTURE)

    print("\n== Column defaults and constraints ==")
    cur.execute(f"select status, blocked_until, invited_at from public.students where college_id = '{C1}'")
    row = cur.fetchone()
    check("a new student defaults to status='active', nothing blocked/invited yet",
          row["status"] == "active" and row["blocked_until"] is None and row["invited_at"] is None, row)
    check("status rejects an invalid value",
          attempt(cur, "update public.students set status = 'sideways' where college_id = 'c1000000-0000-0000-0000-000000000001'") not in ("ok",))
    check("status accepts 'temporarily_blocked'",
          attempt(cur, "update public.students set status = 'temporarily_blocked' where college_id = 'c1000000-0000-0000-0000-000000000001'") == "ok")
    cur.execute("update public.students set status = 'active' where college_id = 'c1000000-0000-0000-0000-000000000001'")

    cur.execute(f"select plan from public.colleges where id = '{C1}'")
    check("a college defaults to plan='standard'", cur.fetchone()["plan"] == "standard")
    check("plan rejects an invalid value", attempt(cur, f"update public.colleges set plan = 'gold' where id = '{C1}'") not in ("ok",))
    check("plan accepts 'pro'", attempt(cur, f"update public.colleges set plan = 'pro' where id = '{C1}'") == "ok")

    print("\n== RLS: college isolation still holds on the new columns ==")
    cur.execute(f"select set_config('request.jwt.claim.sub', '{T2}', false)")
    cur.execute("set role authenticated")
    check("college 2 cannot block college 1's student directly via PostgREST-style access",
          attempt(cur, "update public.students set status = 'restricted' where college_id = 'c1000000-0000-0000-0000-000000000001'") == "ok"
          and cur.rowcount == 0)
    cur.execute("reset role")
    cur.execute(f"select status from public.students where college_id = '{C1}'")
    check("...and the row genuinely did not change", cur.fetchone()["status"] == "active")

    cur.execute(f"select set_config('request.jwt.claim.sub', '{T1}', false)")
    cur.execute("set role authenticated")
    check("college 1 CAN block its own student",
          attempt(cur, "update public.students set status = 'restricted', blocked_reason = 'x' where college_id = 'c1000000-0000-0000-0000-000000000001'") == "ok")
    cur.execute("reset role")
    cur.execute(f"select status from public.students where college_id = '{C1}'")
    check("...and it actually changed", cur.fetchone()["status"] == "restricted")

    print("\n== RLS: a College user cannot edit their own college's plan (no UPDATE policy) ==")
    cur.execute(f"select set_config('request.jwt.claim.sub', '{T1}', false)")
    cur.execute("set role authenticated")
    check("college 1 can READ its own plan", attempt(cur, f"select plan from public.colleges where id = '{C1}'") == "ok")
    result = attempt(cur, f"update public.colleges set plan = 'enterprise' where id = '{C1}'")
    check("...but cannot WRITE it (no UPDATE policy grants it to college users, so 0 rows match)",
          result == "ok" and cur.rowcount == 0, (result, cur.rowcount))
    cur.execute("reset role")
    cur.execute(f"select plan from public.colleges where id = '{C1}'")
    check("...and the plan is unchanged (still 'pro', set earlier as a direct DB session)", cur.fetchone()["plan"] == "pro")
    cur.execute(f"select set_config('request.jwt.claim.sub', '', false)")

    conn.close()
    with admin.cursor() as cur2:
        cur2.execute(f"drop database if exists {DB}")
    admin.close()

    print(f"\n=== {passed}/{passed + failed} passed, {failed} failed ===")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
