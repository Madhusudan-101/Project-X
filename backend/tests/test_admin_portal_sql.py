"""
Admin Portal SQL migration test -- runs db/admin_portal_migration.sql on a
THROWAWAY PostgreSQL and checks every metric against a hand-computed fixture,
plus the security properties (service_role-only EXECUTE, profile role guard).

Needs a scratch Postgres server you can create databases on. It is NOT run
against Supabase -- the test refuses any host containing "supabase".

    ADMIN_TEST_DATABASE_URL=postgresql://postgres@localhost:54329/postgres \
        python tests/test_admin_portal_sql.py

Skips (exit 0) when ADMIN_TEST_DATABASE_URL is unset. Exits 1 on any failure.
The test creates database `admin_portal_test` and drops it at the end.
"""

from __future__ import annotations

import os
import sys
from urllib.parse import urlparse, urlunparse

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)

URL = os.environ.get("ADMIN_TEST_DATABASE_URL")
if not URL:
    print("SKIP: set ADMIN_TEST_DATABASE_URL to a scratch Postgres to run the SQL tests.")
    sys.exit(0)
if "supabase" in URL.lower():
    print("REFUSING: this test creates/drops a database and must never target Supabase.")
    sys.exit(1)

import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402

DB = "admin_portal_test"
_parsed = urlparse(URL)
SERVER_URL = URL
TEST_URL = urlunparse(_parsed._replace(path=f"/{DB}"))

# Supabase-compatible prelude: the roles, auth schema and storage stubs the repo's
# migrations assume exist. Default privileges mirror Supabase's (EXECUTE on new
# functions granted to anon/authenticated/service_role) so the migration's
# revoke loop is genuinely exercised.
PRELUDE = """
do $$ begin  -- roles are cluster-wide and survive the dropped database
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin; end if;
end $$;
create schema auth; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (name text, bucket_id text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
"""

MIGRATIONS = [
    "db/migrations.sql",
    "incremental_migration.sql",
    "incremental_migration_candidate_profile.sql",
    "db/company_migration.sql",
    "db/company_onboarding_migration.sql",
    "db/resume_analysis_migration.sql",
    "db/jobs_and_applications_migration.sql",
    "db/jobs_eligibility_migration.sql",
    "db/college_onboarding_migration.sql",
    "db/job_internship_perks_and_colleges_seed.sql",
    "db/job_drives_migration.sql",
    "db/admin_portal_migration.sql",
]

# ── Fixture (all timestamps explicit, UTC; every updated_at pinned so
#    "activity" is only what we put there) ───────────────────────────────
U = {n: f"00000000-0000-0000-0000-0000000000{i:02d}" for i, n in enumerate(
    ["admin", "t1", "t2", "o1", "o2", "o3", "s1", "s2", "s3", "s4", "s5", "s6", "s7"], start=1)}
C = {"c1": "c1000000-0000-0000-0000-000000000001", "c2": "c2000000-0000-0000-0000-000000000002",
     "c3": "c3000000-0000-0000-0000-000000000003"}
K = {"k1": "a1000000-0000-0000-0000-000000000001", "k2": "a2000000-0000-0000-0000-000000000002",
     "k3": "a3000000-0000-0000-0000-000000000003"}
J = {n: f"b{i}000000-0000-0000-0000-00000000000{i}" for i, n in enumerate(["j1", "j2", "j3", "j4", "j5"], start=1)}
D = {n: f"d{i}000000-0000-0000-0000-00000000000{i}" for i, n in enumerate(["d1", "d2", "d3", "d4"], start=1)}
A = {n: f"e{i}000000-0000-0000-0000-00000000000{i}" for i, n in enumerate(["a1", "a2", "a3", "a4", "a5", "a6", "a7"], start=1)}
# Second-phase fixtures (added after the base assertions run): ids kept out of the base dicts.
S8, S9 = "00000000-0000-0000-0000-000000000108", "00000000-0000-0000-0000-000000000109"
A8, A9, A10 = ("e8000000-0000-0000-0000-000000000008", "e9000000-0000-0000-0000-000000000009",
               "ea000000-0000-0000-0000-000000000010")
D5 = "d5000000-0000-0000-0000-000000000005"
ROUND_D2_R1 = "f1000000-0000-0000-0000-000000000001"

FIXTURE = f"""
insert into auth.users (id, email) select id::uuid, id || '@x.test' from unnest(array[{','.join(repr(v) for v in U.values())}]) id;

insert into public.colleges (id, name, city, created_at) values
  ('{C['c1']}', 'Alpha College', 'Pune', '2026-01-01'),
  ('{C['c2']}', 'Beta Institute', 'Delhi', '2026-01-01'),
  ('{C['c3']}', 'Gamma Directory', 'Goa', '2026-01-01');

insert into public.profiles (id, email, role, name, college_id, graduation_year, branch, created_at, updated_at) values
  ('{U['admin']}', 'admin@x.test', 'admin',     'Ada Admin', null,        null, null, '2026-01-01', '2026-01-01'),
  ('{U['t1']}',    't1@x.test',    'college',   'Tia One',   '{C['c1']}', null, null, '2026-01-02', '2026-01-02'),
  ('{U['t2']}',    't2@x.test',    'college',   'Tom Two',   '{C['c2']}', null, null, '2026-02-15', '2026-02-15'),
  ('{U['o1']}',    'o1@x.test',    'company',   'Owner One', null,        null, null, '2026-01-05', '2026-01-05'),
  ('{U['o2']}',    'o2@x.test',    'company',   'Owner Two', null,        null, null, '2026-02-01', '2026-02-01'),
  ('{U['o3']}',    'o3@x.test',    'company',   'Owner Three', null,      null, null, '2026-03-01', '2026-03-01'),
  ('{U['s1']}',    's1@x.test',    'candidate', 'Stu One',   '{C['c1']}', 2026, 'CSE', '2026-01-10', '2026-01-10'),
  ('{U['s2']}',    's2@x.test',    'candidate', 'Stu Two',   '{C['c1']}', 2026, 'CSE', '2026-01-20', '2026-01-20'),
  ('{U['s3']}',    's3@x.test',    'candidate', 'Stu Three', '{C['c1']}', 2026, 'IT',  '2026-02-05', '2026-02-05'),
  ('{U['s4']}',    's4@x.test',    'candidate', 'Stu Four',  '{C['c2']}', 2026, 'ECE', '2026-02-10', '2026-02-10'),
  ('{U['s5']}',    's5@x.test',    'candidate', 'Stu Five',  '{C['c2']}', 2027, 'ECE', '2026-03-01', '2026-03-01'),
  ('{U['s6']}',    's6@x.test',    'candidate', 'Stu Six',   '{C['c3']}', 2026, 'ME',  '2026-03-05', '2026-03-05'),
  ('{U['s7']}',    's7@x.test',    'candidate', '=Stu Seven', null,       2026, 'ME',  '2026-03-10', '2026-03-10');

insert into public.companies (id, owner_id, name, industry, size, created_at, updated_at) values
  ('{K['k1']}', '{U['o1']}', 'Kappa Corp',  'Software', '50-200', '2026-01-05', '2026-01-05'),
  ('{K['k2']}', '{U['o2']}', 'Lambda Ltd',  'Finance',  '200+',   '2026-02-01', '2026-02-01'),
  ('{K['k3']}', '{U['o3']}', 'Mu Studio',   'Design',   '1-10',   '2026-03-01', '2026-03-01');

insert into public.jobs (id, company_id, title, description, domain, experience_level, location, deadline,
                         status, employment_type, ctc_min, ctc_max, ctc_currency, created_at, updated_at) values
  ('{J['j1']}', '{K['k1']}', 'Backend Engineer', 'x', 'tech', 'fresher', 'Pune',  '2026-12-01', 'live', 'full-time', 600000, 1200000, 'INR', '2026-01-15', '2026-01-15'),
  ('{J['j2']}', '{K['k1']}', 'Intern',           'x', 'tech', 'fresher', 'Pune',  '2026-12-01', 'live', 'intern',    null, null,      'INR', '2026-01-16', '2026-01-16'),
  ('{J['j3']}', '{K['k2']}', 'Analyst',          'x', 'non-tech', 'fresher', 'Delhi', '2026-12-01', 'live', 'full-time', 1500000, 2500000, 'INR', '2026-02-10', '2026-02-10'),
  ('{J['j4']}', '{K['k2']}', 'Remote Analyst',   'x', 'non-tech', 'fresher', 'Remote','2026-12-01', 'live', 'full-time', 90000, 120000, 'USD', '2026-02-11', '2026-02-11'),
  ('{J['j5']}', '{K['k3']}', 'Designer',         'x', 'non-tech', 'fresher', 'Goa',   '2026-12-01', 'draft', 'full-time', null, null,   'INR', '2026-03-05', '2026-03-05');

insert into public.job_drives (id, job_id, college_id, status, apply_deadline, created_at, updated_at) values
  ('{D['d1']}', '{J['j1']}', '{C['c1']}', 'live',   '2026-12-01', '2026-01-20', '2026-01-20'),
  ('{D['d2']}', '{J['j1']}', '{C['c2']}', 'closed', '2026-12-01', '2026-02-01', '2026-02-01'),
  ('{D['d3']}', '{J['j3']}', '{C['c1']}', 'live',   '2026-12-01', '2026-02-15', '2026-02-15'),
  ('{D['d4']}', '{J['j2']}', '{C['c2']}', 'draft',  '2026-12-01', '2026-03-01', '2026-03-01');

insert into public.applications (id, student_id, job_id, company_id, status, applied_at, updated_at) values
  ('{A['a1']}', '{U['s1']}', '{J['j1']}', '{K['k1']}', 'hired',        '2026-01-25', '2026-01-25'),
  ('{A['a2']}', '{U['s2']}', '{J['j1']}', '{K['k1']}', 'rejected',     '2026-01-26', '2026-01-26'),
  ('{A['a3']}', '{U['s3']}', '{J['j1']}', '{K['k1']}', 'shortlisted',  '2026-02-06', '2026-02-06'),
  ('{A['a4']}', '{U['s4']}', '{J['j1']}', '{K['k1']}', 'in_interview', '2026-02-12', '2026-02-12'),
  ('{A['a5']}', '{U['s5']}', '{J['j1']}', '{K['k1']}', 'applied',      '2026-03-02', '2026-03-02'),
  ('{A['a6']}', '{U['s1']}', '{J['j3']}', '{K['k2']}', 'applied',      '2026-02-20', '2026-02-20'),
  ('{A['a7']}', '{U['s3']}', '{J['j3']}', '{K['k2']}', 'hired',        '2026-02-25', '2026-02-25');

-- a5 is still 'applied' but a company shortlisted it at round 1 -> counts as shortlisted.
insert into public.job_drive_rounds (id, drive_id, round_number, round_type, mode)
  values ('f1000000-0000-0000-0000-000000000001', '{D['d2']}', 1, 'tech', 'ai');
insert into public.application_round_results (application_id, round_id, status, decided_at)
  values ('{A['a5']}', 'f1000000-0000-0000-0000-000000000001', 'shortlisted', '2026-03-03');

insert into public.ai_interview_sessions (student_id, completed, created_at)
  values ('{U['s6']}', true, '2026-02-20');
"""

passed = failed = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {label}")
    else:
        failed += 1
        print(f"  [FAIL] {label} -- {detail}")


def q(cur, sql: str, params=None):
    cur.execute(sql, params)
    return cur.fetchall()


def fn(cur, name: str, *args):
    ph = ", ".join(["%s"] * len(args))
    return q(cur, f"select * from public.{name}({ph})", args)


def scalar_json(cur, name: str, *args):
    ph = ", ".join(["%s"] * len(args))
    cur.execute(f"select public.{name}({ph})", args)
    return next(iter(cur.fetchone().values()))


def attempt(cur, sql: str) -> str:
    """Run `sql`; 'ok' on success, else the Postgres error code (or 'error')."""
    try:
        cur.execute(sql)
        return "ok"
    except psycopg2.Error as e:
        return e.pgcode or "error"


ALL = (None, None)
FEB = ("2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z")


def main() -> int:
    admin = psycopg2.connect(SERVER_URL)
    admin.autocommit = True
    with admin.cursor() as cur:
        cur.execute(f"drop database if exists {DB}")
        cur.execute(f"create database {DB}")

    conn = psycopg2.connect(TEST_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print("\n== Setup: repo migrations in order + admin migration ==")
    cur.execute(PRELUDE)
    for path in MIGRATIONS:
        with open(os.path.join(BACKEND, path), encoding="utf-8") as f:
            cur.execute(f.read())
    print(f"  applied {len(MIGRATIONS)} migrations")
    # Re-running must be a no-op error-wise (idempotent).
    with open(os.path.join(BACKEND, MIGRATIONS[-1]), encoding="utf-8") as f:
        cur.execute(f.read())
    check("admin migration is idempotent (second run succeeds)", True)
    cur.execute(FIXTURE)

    print("\n== admin_overview: all time ==")
    o = scalar_json(cur, "admin_overview", *ALL)
    t, p = o["totals"], o["period"]
    check("totals.users = 13 profiles", t["users"] == 13, t)
    check("totals.candidates = 7, recruiters = 3, admins = 1", (t["candidates"], t["recruiters"], t["admins"]) == (7, 3, 1), t)
    check("totals.colleges = 2 registered (Gamma is directory-only)", t["colleges"] == 2, t)
    check("totals.colleges_in_directory = 3 (+seed rows excluded by id filter)", t["colleges_in_directory"] >= 3, t)
    check("totals.companies = 3", t["companies"] == 3, t)
    check("drives: 4 total = 2 live + 1 closed + 1 draft",
          (t["drives"], t["drives_live"], t["drives_closed"], t["drives_draft"]) == (4, 2, 1, 1), t)
    check("colleges_with_drives = 2, companies_with_drives = 2 (Mu Studio has none)",
          (t["colleges_with_drives"], t["companies_with_drives"]) == (2, 2), t)
    check("applications = 7 over 5 distinct applicants", (p["applications"], p["applicants"]) == (7, 5), p)
    check("shortlisted = 5 (incl. hired, in_interview and a round-result-only shortlist)", p["shortlisted"] == 5, p)
    check("selected = 2 by 2 distinct candidates", (p["selected"], p["selected_applicants"]) == (2, 2), p)
    check("drives_with_applications = 3 (D1, D2, D3)", p["drives_with_applications"] == 3, p)
    check("funnel is monotonic: selected <= shortlisted <= applications",
          p["selected"] <= p["shortlisted"] <= p["applications"], p)

    print("\n== admin_overview: February window (cohort semantics) ==")
    o = scalar_json(cur, "admin_overview", *FEB)
    p = o["period"]
    check("applications in Feb = 4 (a3, a4, a6, a7)", p["applications"] == 4, p)
    check("applicants in Feb = 3 (s1, s3, s4)", p["applicants"] == 3, p)
    check("shortlisted = 3, selected = 1 (a7)", (p["shortlisted"], p["selected"], p["selected_applicants"]) == (3, 1, 1), p)
    check("new: 2 candidates, 1 company, 1 college, 2 drives",
          (p["new_candidates"], p["new_companies"], p["new_colleges"], p["drives_created"]) == (2, 1, 1, 2), p)
    check("active in Feb: 4 candidates (incl. AI-interview only), 2 companies, 2 colleges",
          (p["active_candidates"], p["active_companies"], p["active_colleges"]) == (4, 2, 2), p)
    # totals must not move with the range
    check("totals are all-time regardless of range (4 drives, 7 candidates)", (o["totals"]["drives"], o["totals"]["candidates"]) == (4, 7), o["totals"])

    print("\n== admin_trends ==")
    rows = fn(cur, "admin_trends", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z", "month", "UTC")
    check("3 monthly buckets", len(rows) == 3, len(rows))
    check("candidates per month = 2/2/3", [r["new_candidates"] for r in rows] == [2, 2, 3], rows)
    check("applications per month = 2/4/1", [r["applications"] for r in rows] == [2, 4, 1], rows)
    check("selected per month = 1/1/0", [r["selected"] for r in rows] == [1, 1, 0], rows)
    check("drives created = 1/2/1, colleges registered = 1/1/0",
          ([r["drives_created"] for r in rows], [r["new_colleges"] for r in rows]) == ([1, 2, 1], [1, 1, 0]), rows)
    rows = fn(cur, "admin_trends", "2026-01-24T00:00:00Z", "2026-01-29T00:00:00Z", "day", "UTC")
    check("day buckets are zero-filled: 5 points for a 5-day range", len(rows) == 5, len(rows))
    check("Jan 25 has the hire, Jan 27 has nothing", (rows[1]["selected"], rows[3]["applications"]) == (1, 0), rows)
    rows = fn(cur, "admin_trends", None, None, "month", "UTC")
    months = [(r["bucket"].year, r["bucket"].month) for r in rows]
    check("all-time trend starts at the earliest record (Jan 2026) and runs contiguously to today",
          months[0] == (2026, 1) and months == sorted(set(months)) and len(rows) >= 3, months)
    check("all-time trend loses nothing: 7 applications, 7 candidates",
          (sum(r["applications"] for r in rows), sum(r["new_candidates"] for r in rows)) == (7, 7))
    rows = fn(cur, "admin_trends", "2026-01-24T00:00:00Z", "2026-01-29T00:00:00Z", "day", "IST-5:30")
    check("time-zone aware buckets (UTC+5:30 day starts at 18:30Z the day before)", rows[0]["bucket"].hour == 18 and rows[0]["bucket"].minute == 30, rows[0])
    rows = fn(cur, "admin_trends", "2026-01-24T00:00:00Z", "2026-01-29T00:00:00Z", "day", "Not/AZone")
    check("unknown time zone falls back to UTC instead of erroring", len(rows) == 5, len(rows))
    rows = fn(cur, "admin_trends", "2030-01-01T00:00:00Z", "2030-01-08T00:00:00Z", "day", "UTC")
    check("empty range returns zeroed buckets, not nothing", len(rows) == 7 and sum(r["applications"] for r in rows) == 0)

    print("\n== admin_list_colleges ==")
    rows = fn(cur, "admin_list_colleges", *ALL, None, "registered", None, None, "applications", "desc", 25, 0)
    check("registered list = Alpha, Beta only", sorted(r["name"] for r in rows) == ["Alpha College", "Beta Institute"], [r["name"] for r in rows])
    a, b = rows[0], rows[1]
    check("Alpha: 3 candidates, 2 drives, 2 companies", (a["candidates"], a["drives"], a["companies"]) == (3, 2, 2), a)
    check("Alpha: 5 apps / 3 applicants / 3 shortlisted / 2 selected",
          (a["applications"], a["applicants"], a["shortlisted"], a["selected"], a["selected_applicants"]) == (5, 3, 3, 2, 2), a)
    check("Beta: 2 drives but 1 company (both drives are Kappa's)", (b["drives"], b["companies"]) == (2, 1), b)
    check("Beta: 2 apps, 2 shortlisted, 0 selected", (b["applications"], b["shortlisted"], b["selected"]) == (2, 2, 0), b)
    check("total_count carried on every row", all(r["total_count"] == 2 for r in rows))
    check("has_account true for registered colleges", all(r["has_account"] for r in rows))
    rows = fn(cur, "admin_list_colleges", *ALL, None, "directory", None, None, "name", "asc", 25, 0)
    check("directory filter returns colleges without an account, incl. Gamma",
          "Gamma Directory" in [r["name"] for r in rows] and not any(r["has_account"] for r in rows), [r["name"] for r in rows][:5])
    rows = fn(cur, "admin_list_colleges", *ALL, "alp", "all", None, None, "name", "asc", 25, 0)
    check("search is case-insensitive substring", [r["name"] for r in rows] == ["Alpha College"], rows)
    rows = fn(cur, "admin_list_colleges", *ALL, "%", "all", None, None, "name", "asc", 25, 0)
    check("search treats % literally (no wildcard injection)", rows == [], rows)
    rows = fn(cur, "admin_list_colleges", *ALL, None, "registered", None, None, "placement_rate", "desc", 25, 0)
    check("sort by placement rate: Alpha (2/3) before Beta (0/2)", [r["name"] for r in rows] == ["Alpha College", "Beta Institute"], rows)
    rows = fn(cur, "admin_list_colleges", *ALL, None, "registered", None, None, "name", "desc", 1, 1)
    check("pagination: page 2 of size 1 (name desc) = Alpha", [r["name"] for r in rows] == ["Alpha College"] and rows[0]["total_count"] == 2, rows)
    rows = fn(cur, "admin_list_colleges", *FEB, None, "registered", "inactive", None, "name", "asc", 25, 0)
    check("activity filter: nobody inactive in Feb", rows == [], rows)
    rows = fn(cur, "admin_list_colleges", "2026-03-15T00:00:00Z", "2026-03-20T00:00:00Z", None, "registered", "inactive", None, "name", "asc", 25, 0)
    check("activity filter: both inactive in a quiet window", len(rows) == 2, rows)
    rows = fn(cur, "admin_list_colleges", *ALL, None, "all", None, C["c1"], "name", "asc", 25, 0)
    check("p_college_id returns exactly that college", len(rows) == 1 and rows[0]["college_id"] == C["c1"], rows)
    rows = fn(cur, "admin_list_colleges", *ALL, None, "registered", None, None, "; drop table profiles; --", "asc", 25, 0)
    check("unknown sort key is harmless (no dynamic SQL)", len(rows) == 2, rows)

    print("\n== admin_list_companies ==")
    rows = fn(cur, "admin_list_companies", *ALL, None, None, None, None, "applications", "desc", 25, 0)
    k1 = next(r for r in rows if r["name"] == "Kappa Corp")
    k3 = next(r for r in rows if r["name"] == "Mu Studio")
    check("3 companies, Kappa first by applications", len(rows) == 3 and rows[0]["name"] == "Kappa Corp", [r["name"] for r in rows])
    check("Kappa: 2 jobs, 3 drives, 2 colleges", (k1["jobs"], k1["drives"], k1["colleges"]) == (2, 3, 2), k1)
    check("Kappa: 5 apps / 5 applicants / 4 shortlisted / 1 selected",
          (k1["applications"], k1["applicants"], k1["shortlisted"], k1["selected"]) == (5, 5, 4, 1), k1)
    check("Mu Studio: no drives, no colleges, no applications (its only activity is posting a draft job)",
          (k3["drives"], k3["colleges"], k3["applications"]) == (0, 0, 0) and str(k3["last_activity"]).startswith("2026-03-05"), k3)
    check("owner email joined from profiles", k1["owner_email"] == "o1@x.test", k1)
    rows = fn(cur, "admin_list_companies", *ALL, "lambda", None, None, None, "name", "asc", 25, 0)
    check("company search matches name", [r["name"] for r in rows] == ["Lambda Ltd"], rows)

    print("\n== admin_list_candidates ==")
    rows = fn(cur, "admin_list_candidates", *ALL, None, None, None, None, None, False, "name", "asc", 25, 0)
    st = {r["name"]: r["placement_status"] for r in rows}
    check("7 candidates", len(rows) == 7, len(rows))
    check("statuses: s1 placed, s2 rejected (only application was rejected), s3 placed, s4 in_process, "
          "s5 in_process (round-result shortlist, still live), s6/s7 not_applied",
          (st["Stu One"], st["Stu Two"], st["Stu Three"], st["Stu Four"], st["Stu Five"], st["Stu Six"], st["=Stu Seven"]) ==
          ("placed", "rejected", "placed", "in_process", "in_process", "not_applied", "not_applied"), st)
    rows = fn(cur, "admin_list_candidates", *ALL, None, C["c1"], None, None, None, False, "name", "asc", 25, 0)
    check("college filter: Alpha has 3 candidates", len(rows) == 3, len(rows))
    rows = fn(cur, "admin_list_candidates", *ALL, None, None, K["k2"], None, None, False, "name", "asc", 25, 0)
    check("company filter keeps only applicants to that company (s1, s3)", sorted(r["name"] for r in rows) == ["Stu One", "Stu Three"], rows)
    check("under a company filter, counts use only that company's applications", all(r["applications"] == 1 for r in rows), rows)
    rows = fn(cur, "admin_list_candidates", *ALL, None, None, K["k2"], None, "placed", False, "name", "asc", 25, 0)
    check("status is computed over the SAME filtered facts: only s3 is 'placed' at Lambda (s1 was hired at Kappa)",
          [r["name"] for r in rows] == ["Stu Three"], rows)
    rows = fn(cur, "admin_list_candidates", *ALL, None, None, None, D["d2"], None, False, "name", "asc", 25, 0)
    check("drive filter (D2 = Kappa @ Beta): s4, s5", sorted(r["name"] for r in rows) == ["Stu Five", "Stu Four"], rows)
    rows = fn(cur, "admin_list_candidates", *FEB, None, None, None, None, "placed", False, "name", "asc", 25, 0)
    check("status inside the Feb cohort: only s3 (hired Feb 25); s1's hire was in January", [r["name"] for r in rows] == ["Stu Three"], rows)
    rows = fn(cur, "admin_list_candidates", *FEB, None, None, None, None, None, True, "name", "asc", 25, 0)
    check("registered_in_range: s3, s4 signed up in Feb", sorted(r["name"] for r in rows) == ["Stu Four", "Stu Three"], rows)
    rows = fn(cur, "admin_list_candidates", *ALL, "ONE", None, None, None, None, False, "name", "asc", 25, 0)
    check("candidate search by name substring", [r["name"] for r in rows] == ["Stu One"], rows)
    rows = fn(cur, "admin_list_candidates", *ALL, None, None, None, None, "not_applied", False, "registered_at", "asc", 25, 0)
    check("not_applied = s6, s7 (oldest first)", [r["name"] for r in rows] == ["Stu Six", "=Stu Seven"], rows)

    print("\n== admin_list_drives / admin_list_partnerships ==")
    rows = fn(cur, "admin_list_drives", *ALL, None, None, None, None, "applications", "desc", 25, 0)
    by = {r["drive_id"]: r for r in rows}
    check("4 drives listed", len(rows) == 4, len(rows))
    check("D1: 3 apps, 1 selected; D3: 2 apps, 1 selected; D4: none",
          (by[D["d1"]]["applications"], by[D["d1"]]["selected"], by[D["d3"]]["applications"], by[D["d3"]]["selected"], by[D["d4"]]["applications"]) == (3, 1, 2, 1, 0),
          {k[:2]: (v["applications"], v["selected"]) for k, v in by.items()})
    rows = fn(cur, "admin_list_drives", "2026-03-15T00:00:00Z", "2026-03-20T00:00:00Z", None, None, None, None, "applications", "desc", 25, 0)
    check("a drive is listed only if created in range or applied to in range", rows == [], rows)
    rows = fn(cur, "admin_list_drives", *ALL, None, "live", None, None, "applications", "desc", 25, 0)
    check("status filter", sorted(r["status"] for r in rows) == ["live", "live"], rows)
    rows = fn(cur, "admin_list_partnerships", *ALL, None, None, None, "applications", "desc", 25, 0)
    pairs = {(r["company_name"], r["college_name"]): r for r in rows}
    check("exactly 3 partnerships — only where a drive exists", len(rows) == 3, list(pairs))
    check("Kappa x Beta: 2 drives, 2 apps", (pairs[("Kappa Corp", "Beta Institute")]["drives"], pairs[("Kappa Corp", "Beta Institute")]["applications"]) == (2, 2), pairs)
    check("Kappa x Alpha: 1 drive, 3 apps, 1 selected",
          (pairs[("Kappa Corp", "Alpha College")]["drives"], pairs[("Kappa Corp", "Alpha College")]["applications"], pairs[("Kappa Corp", "Alpha College")]["selected"]) == (1, 3, 1), pairs)
    check("no fabricated pair for Lambda x Beta", ("Lambda Ltd", "Beta Institute") not in pairs)
    rows = fn(cur, "admin_list_partnerships", *ALL, None, K["k2"], None, "company", "asc", 25, 0)
    check("company filter on partnerships", len(rows) == 1 and rows[0]["college_name"] == "Alpha College", rows)

    print("\n== admin_ctc_stats ==")
    c = scalar_json(cur, "admin_ctc_stats", *ALL)
    check("posted: 2 INR full-time roles (intern, USD and no-CTC excluded)", c["posted"]["roles"] == 2, c["posted"])
    check("posted: avg 1.45M, highest 2.5M, lowest 600k",
          (c["posted"]["average"], c["posted"]["highest"], c["posted"]["lowest"]) == (1450000, 2500000, 600000), c["posted"])
    check("1 non-INR role reported as excluded", c["excluded_other_currency"] == 1, c)
    check("filled = the roles of the 2 selected applications", (c["filled"]["roles"], c["filled"]["average"]) == (2, 1450000), c["filled"])
    dist = {d["bucket"]: d["count"] for d in c["posted"]["distribution"]}
    check("distribution: 900k -> 6-10 LPA, 2M -> 15-25 LPA", (dist["6-10 LPA"], dist["15-25 LPA"], dist["Under 3 LPA"]) == (1, 1, 0), dist)
    c = scalar_json(cur, "admin_ctc_stats", "2030-01-01T00:00:00Z", "2030-02-01T00:00:00Z")
    check("no data in range -> null stats (UI shows N/A), not zeros", c["filled"]["average"] is None and c["posted"]["highest"] is None, c)

    print("\n== admin_activity ==")
    rows = fn(cur, "admin_activity", 5)
    check("5 items, newest first", len(rows) == 5 and rows == sorted(rows, key=lambda r: r["occurred_at"], reverse=True), rows)
    kinds = {r["kind"] for r in fn(cur, "admin_activity", 50)}
    check("feed covers registrations, drives, applications and selections",
          {"candidate_registered", "company_registered", "college_registered", "drive_created",
           "application_submitted", "candidate_selected"} <= kinds, kinds)

    print("\n== M1: a candidate rejected AFTER a round-1 shortlist is not 'in process' ==")
    cur.execute(f"""
      insert into auth.users (id, email) values ('{S8}', 's8@x.test'), ('{S9}', 's9@x.test');
      insert into public.profiles (id, email, role, name, college_id, graduation_year, branch, created_at, updated_at) values
        ('{S8}', 's8@x.test', 'candidate', 'Stu Eight', '{C['c2']}', 2026, 'ECE', '2026-04-01', '2026-04-01'),
        ('{S9}', 's9@x.test', 'candidate', 'Stu Nine',  '{C['c1']}', 2026, 'CSE', '2026-04-01', '2026-04-01');
      insert into public.applications (id, student_id, job_id, company_id, status, applied_at, updated_at) values
        ('{A8}',  '{S8}', '{J['j1']}', '{K['k1']}', 'rejected', '2026-04-02', '2026-04-02'),
        ('{A9}',  '{S9}', '{J['j1']}', '{K['k1']}', 'hired',    '2026-04-05', '2026-04-05'),
        ('{A10}', '{S9}', '{J['j3']}', '{K['k2']}', 'hired',    '2026-04-06', '2026-04-06');
      -- s8 was shortlisted at round 1 of Kappa's drive at Beta, then the company rejected the application
      insert into public.application_round_results (application_id, round_id, status, decided_at)
        values ('{A8}', '{ROUND_D2_R1}', 'shortlisted', '2026-04-03');
    """)
    rows = {r["name"]: r for r in fn(cur, "admin_list_candidates", *ALL, None, None, None, None, None, False, "name", "asc", 50, 0)}
    e = rows["Stu Eight"]
    check("shortlisted at round 1 then application rejected -> status 'rejected' (was 'in_process')", e["placement_status"] == "rejected", e)
    check("...but it still counts as EVER shortlisted (funnel stage), 1 application", (e["shortlisted"], e["applications"]) == (1, 1), e)
    rej = sorted(r["name"] for r in fn(cur, "admin_list_candidates", *ALL, None, None, None, None, "rejected", False, "name", "asc", 50, 0))
    check("status filter 'rejected' = s2 (never shortlisted) and s8 (rejected after shortlist)", rej == ["Stu Eight", "Stu Two"], rej)
    cur.execute(f"update public.application_round_results set status = 'rejected' where application_id = '{A['a5']}'")
    r = fn(cur, "admin_list_candidates", *ALL, "Stu Five", None, None, None, None, False, "name", "asc", 5, 0)[0]
    check("a round-level 'rejected' also eliminates it even though application.status is still 'applied'", r["placement_status"] == "rejected", r)
    cur.execute(f"update public.application_round_results set status = 'shortlisted' where application_id = '{A['a5']}'")

    print("\n== M5: a candidate hired twice is one placed candidate, two selected applications ==")
    o = scalar_json(cur, "admin_overview", *ALL)
    p = o["period"]
    check("applications 10, applicants 7 (s9 counted once although she applied twice)", (p["applications"], p["applicants"]) == (10, 7), p)
    check("selected = 4 applications but selected_applicants = 3 candidates (s1, s3, s9)", (p["selected"], p["selected_applicants"]) == (4, 3), p)
    check("shortlisted = 8 (hired imply shortlisted; s8 stays shortlisted after rejection)", p["shortlisted"] == 8, p)
    check("funnel still monotonic", p["selected"] <= p["shortlisted"] <= p["applications"], p)
    n = fn(cur, "admin_list_candidates", *ALL, "Stu Nine", None, None, None, None, False, "name", "asc", 5, 0)[0]
    check("candidate row: 2 applications, 2 selected, status placed", (n["applications"], n["selected"], n["placement_status"]) == (2, 2, "placed"), n)
    cols = {r["name"]: r for r in fn(cur, "admin_list_colleges", *ALL, None, "registered", None, None, "name", "asc", 25, 0)}
    a, b = cols["Alpha College"], cols["Beta Institute"]
    check("Alpha: 7 apps / 4 applicants / 4 selected applications but 3 selected candidates",
          (a["applications"], a["applicants"], a["selected"], a["selected_applicants"]) == (7, 4, 4, 3), a)
    check("Beta: 3 apps / 3 applicants / 0 selected", (b["applications"], b["applicants"], b["selected"]) == (3, 3, 0), b)
    cmp = {r["name"]: r for r in fn(cur, "admin_list_companies", *ALL, None, None, None, None, "name", "asc", 25, 0)}
    check("Kappa: 7 apps, 2 selected applications / 2 selected candidates; Lambda: 3 apps, 2 / 2",
          ((cmp["Kappa Corp"]["applications"], cmp["Kappa Corp"]["selected"], cmp["Kappa Corp"]["selected_applicants"]),
           (cmp["Lambda Ltd"]["applications"], cmp["Lambda Ltd"]["selected"], cmp["Lambda Ltd"]["selected_applicants"])) == ((7, 2, 2), (3, 2, 2)), cmp)
    cp = fn(cur, "admin_list_candidates", *ALL, None, None, K["k2"], None, "placed", False, "name", "asc", 25, 0)
    check("placed AT Lambda = s3 and s9 (s1 was hired at Kappa, only 'applied' at Lambda)", sorted(r["name"] for r in cp) == ["Stu Nine", "Stu Three"], cp)

    print("\n== M2: history stays with the college the student belonged to WHEN THEY APPLIED ==")
    snap = q(cur, f"select id::text, college_id::text from public.applications where id in ('{A['a1']}', '{A8}')")
    check("the trigger snapshotted each application's college at insert (a1 -> Alpha, a8 -> Beta)",
          {r["id"]: r["college_id"] for r in snap} == {A["a1"]: C["c1"], A8: C["c2"]}, snap)
    cur.execute(f"update public.profiles set college_id = '{C['c2']}' where id = '{U['s1']}'")   # s1 moves Alpha -> Beta
    cols = {r["name"]: r for r in fn(cur, "admin_list_colleges", *ALL, None, "registered", None, None, "name", "asc", 25, 0)}
    check("after s1 changes college, Alpha keeps s1's applications (still 7) and Beta does not gain them (still 3)",
          (cols["Alpha College"]["applications"], cols["Beta Institute"]["applications"]) == (7, 3),
          (cols["Alpha College"]["applications"], cols["Beta Institute"]["applications"]))
    check("...and the two partnerships keep their history (Kappa x Alpha: 4 apps, 2 selected)",
          any(r["company_name"] == "Kappa Corp" and r["college_name"] == "Alpha College" and (r["applications"], r["selected"]) == (4, 2)
              for r in fn(cur, "admin_list_partnerships", *ALL, None, None, None, "applications", "desc", 25, 0)))
    # Applications are updated all through their life (shortlisted, hired, ...): an UPDATE must not re-snapshot
    # the applicant's CURRENT college either. Rolled back, so the fixture is untouched.
    cur.execute("begin")
    cur.execute(f"update public.applications set status = status where id = '{A['a1']}'")
    kept = q(cur, f"select college_id::text from public.applications where id = '{A['a1']}'")[0]["college_id"]
    cur.execute("rollback")
    check("an UPDATE of an old application keeps its snapshot (a1 stays Alpha although s1 is now at Beta)",
          kept == C["c1"], kept)
    # A LEGACY row (predates the snapshot column) has no snapshot: it falls back to the current college.
    cur.execute("alter table public.applications disable trigger applications_snapshot_college")
    cur.execute(f"update public.applications set college_id = null where id = '{A['a1']}'")
    cur.execute("alter table public.applications enable trigger applications_snapshot_college")
    cols = {r["name"]: r for r in fn(cur, "admin_list_colleges", *ALL, None, "registered", None, None, "name", "asc", 25, 0)}
    check("legacy row without a snapshot falls back to the student's CURRENT college (a1 now counts for Beta)",
          (cols["Alpha College"]["applications"], cols["Beta Institute"]["applications"]) == (6, 4),
          (cols["Alpha College"]["applications"], cols["Beta Institute"]["applications"]))
    cur.execute("alter table public.applications disable trigger applications_snapshot_college")
    cur.execute(f"update public.applications set college_id = '{C['c1']}' where id = '{A['a1']}'")
    cur.execute("alter table public.applications enable trigger applications_snapshot_college")
    cur.execute(f"update public.profiles set college_id = '{C['c1']}' where id = '{U['s1']}'")
    # A student cannot mis-attribute (or re-attribute) their own application through the public API.
    cur.execute(f"select set_config('request.jwt.claim.sub', '{U['s6']}', false)")
    cur.execute("set role authenticated")
    forged = "ok"
    try:
        cur.execute(f"""insert into public.applications (student_id, job_id, company_id, status, college_id)
                        values ('{U['s6']}', '{J['j1']}', '{K['k1']}', 'applied', '{C['c1']}')""")   # forged: Alpha
    except psycopg2.Error as e:
        forged = e.pgcode
    cur.execute("reset role")
    check("a student can still apply directly (RLS allows their own row)", forged == "ok", forged)
    got = q(cur, f"select college_id::text from public.applications where student_id = '{U['s6']}'")[0]["college_id"]
    check("a client-supplied college_id is OVERWRITTEN from the profile (s6 is at Gamma, not the forged Alpha)", got == C["c3"], got)
    cur.execute("set role authenticated")
    try:
        cur.execute(f"update public.applications set college_id = '{C['c1']}' where student_id = '{U['s6']}'")
    except psycopg2.Error:
        pass
    cur.execute("reset role")
    got = q(cur, f"select college_id::text from public.applications where student_id = '{U['s6']}'")[0]["college_id"]
    check("the snapshot is immutable: re-pointing it via UPDATE is ignored", got == C["c3"], got)
    cur.execute(f"select set_config('request.jwt.claim.sub', '', false)")

    print("\n== M3: Overview covers ALL colleges; the Colleges table covers registered ones — and the gap is measured ==")
    cur.execute(f"""
      insert into public.job_drives (id, job_id, college_id, status, apply_deadline, created_at, updated_at)
        values ('{D5}', '{J['j1']}', '{C['c3']}', 'live', '2026-12-01', '2026-04-10', '2026-04-10');
      insert into public.applications (student_id, job_id, company_id, status, applied_at, updated_at)
        values ('{U['s7']}', '{J['j3']}', '{K['k2']}', 'applied', '2026-04-12', '2026-04-12');   -- s7 has no college at all
    """)
    o = scalar_json(cur, "admin_overview", *ALL)
    t, p = o["totals"], o["period"]
    check("drives: 5 across all colleges, 4 at registered ones (D5 is at directory-only Gamma)",
          (t["drives"], t["drives_at_registered_colleges"]) == (5, 4), t)
    check("applications: 12 in total; 10 at registered colleges (s6 @ Gamma and college-less s7 are the gap)",
          (p["applications"], p["applications_at_registered_colleges"]) == (12, 10), p)
    reg = q(cur, "select coalesce(sum(applications), 0)::int a, coalesce(sum(drives), 0)::int d "
                 "from public.admin_list_colleges(null, null, null, 'registered', null, null, 'name', 'asc', 500, 0)")[0]
    check("RECONCILES: the sum over the registered-colleges table equals the *_at_registered_colleges figures",
          (reg["a"], reg["d"]) == (p["applications_at_registered_colleges"], t["drives_at_registered_colleges"]), (reg, p["applications_at_registered_colleges"]))
    d = fn(cur, "admin_list_colleges", *ALL, None, "directory", None, None, "name", "asc", 500, 0)
    gamma = next(r for r in d if r["name"] == "Gamma Directory")
    check("the directory-only view exposes exactly the activity the default table leaves out (Gamma: 1 drive, 1 application)",
          (gamma["drives"], gamma["applications"]) == (1, 1), gamma)

    print("\n== M5: College Portal roster / campus-drive activity — reported separately, never merged ==")
    before = scalar_json(cur, "admin_overview", *ALL)
    MAY = ("2026-05-01T00:00:00Z", "2026-06-01T00:00:00Z")
    quiet = {r["name"]: r["is_active"] for r in fn(cur, "admin_list_colleges", *MAY, None, "registered", None, None, "name", "asc", 25, 0)}
    check("before any roster activity in May, both registered colleges are inactive in that window", quiet == {"Alpha College": False, "Beta Institute": False}, quiet)
    cur.execute(f"""
      insert into public.students (college_id, name, email, branch, graduation_year, placement_status, created_at, updated_at) values
        ('{C['c1']}', 'Roster One', 'r1@x.test', 'CSE', 2026, 'not_placed', '2026-05-10', '2026-05-10'),
        ('{C['c1']}', 'Roster Two', 'r2@x.test', 'CSE', 2026, 'placed',     '2026-05-12', '2026-05-12');
      insert into public.company_drives (college_id, company_name, role, drive_date, created_at, updated_at)
        values ('{C['c2']}', 'Manual Co', 'SDE', '2026-05-11', '2026-05-11', '2026-05-11');
    """)
    cols = {r["name"]: r for r in fn(cur, "admin_list_colleges", *MAY, None, "registered", None, None, "name", "asc", 25, 0)}
    a, b = cols["Alpha College"], cols["Beta Institute"]
    check("a roster upload makes Alpha ACTIVE in May; a manual Campus Drive makes Beta ACTIVE in May", (a["is_active"], b["is_active"]) == (True, True), (a, b))
    check("Alpha: roster_students 2, roster_placed 1 (TPO-marked), portal_drives 0", (a["roster_students"], a["roster_placed"], a["portal_drives"]) == (2, 1, 0), a)
    check("Beta: portal_drives 1 (the TPO's manual Campus Drive)", b["portal_drives"] == 1, b)
    check("platform 'candidates' on Alpha (4: s1, s2, s3, s9) is NOT the roster count (2) — different datasets",
          (a["candidates"], a["roster_students"]) == (4, 2), a)
    after = scalar_json(cur, "admin_overview", *ALL)
    check("roster and Campus Drives do NOT change any platform KPI (drives, candidates, applications, selected)",
          (after["totals"]["drives"], after["totals"]["candidates"], after["period"]["applications"], after["period"]["selected"]) ==
          (before["totals"]["drives"], before["totals"]["candidates"], before["period"]["applications"], before["period"]["selected"]),
          (before["totals"], after["totals"]))
    check("...and the roster's 'placed' student is not counted as a platform selection", after["period"]["selected"] == 4, after["period"])
    check("the TPO's manual Campus Drive is not a platform drive (5 platform drives, none created in May)",
          (after["totals"]["drives"], scalar_json(cur, "admin_overview", *MAY)["period"]["drives_created"]) == (5, 0))

    print("\n== Platform Control Center: blocking is computed, never a stored yes/no ==")
    cur.execute(f"update public.profiles set blocked_permanent=false, blocked_until=null, blocked_reason=null, blocked_at=null, blocked_by=null where id='{U['s1']}'")
    row = fn(cur, "admin_list_users", *ALL, None, None, None, U['s1'], "created_at", "desc", 5, 0)[0]
    check("unblocked candidate: is_blocked=false", row["is_blocked"] is False, row)
    cur.execute(f"update public.profiles set blocked_permanent=true, blocked_reason='policy', blocked_by='{U['admin']}', blocked_at=now() where id='{U['s1']}'")
    row = fn(cur, "admin_list_users", *ALL, None, None, None, U['s1'], "created_at", "desc", 5, 0)[0]
    check("permanently blocked: is_blocked=true, blocked_by_email resolved", row["is_blocked"] is True and row["blocked_by_email"] == "admin@x.test", row)
    cur.execute(f"update public.profiles set blocked_permanent=false, blocked_until = now() + interval '1 hour' where id='{U['s1']}'")
    row = fn(cur, "admin_list_users", *ALL, None, None, None, U['s1'], "created_at", "desc", 5, 0)[0]
    check("temporarily blocked with a future blocked_until: is_blocked=true", row["is_blocked"] is True, row)
    cur.execute(f"update public.profiles set blocked_until = now() - interval '1 hour' where id='{U['s1']}'")
    row = fn(cur, "admin_list_users", *ALL, None, None, None, U['s1'], "created_at", "desc", 5, 0)[0]
    check("blocked_until now in the PAST, with no job having run: is_blocked=false automatically", row["is_blocked"] is False, row)
    check("admin_list_users can filter to only blocked / only active accounts",
          all(r["is_blocked"] for r in fn(cur, "admin_list_users", *ALL, None, None, "blocked", None, "created_at", "desc", 50, 0)) and
          not any(r["is_blocked"] for r in fn(cur, "admin_list_users", *ALL, None, None, "active", None, "created_at", "desc", 50, 0)))
    cur.execute(f"update public.profiles set blocked_permanent=false, blocked_until=null, blocked_reason=null, blocked_at=null, blocked_by=null where id='{U['s1']}'")

    print("\n== Platform Control Center: the block-column guard trigger ==")
    cur.execute("set role authenticated")
    check("authenticated cannot set blocked_permanent on itself",
          attempt(cur, f"update public.profiles set blocked_permanent = true where id = '{U['s1']}'") == "42501")
    check("authenticated cannot set blocked_until on itself",
          attempt(cur, f"update public.profiles set blocked_until = now() + interval '1 day' where id = '{U['s1']}'") == "42501")
    cur.execute("reset role")
    check("...and nothing actually changed", q(cur, f"select blocked_permanent from public.profiles where id='{U['s1']}'")[0]["blocked_permanent"] is False)
    cur.execute("set role service_role")
    check("service_role (the backend) CAN block a user",
          attempt(cur, f"update public.profiles set blocked_permanent = true, blocked_reason='t' where id = '{U['s1']}'") == "ok")
    cur.execute("reset role")
    cur.execute(f"update public.profiles set blocked_permanent=false, blocked_reason=null where id='{U['s1']}'")

    print("\n== Platform Control Center: central event log + Audit Log vs Live Activity ==")
    cur.execute(f"""
      insert into public.admin_events (event_type, actor_user_id, actor_role, actor_label, target_type, target_id, target_label, result, metadata)
        values ('user_blocked', '{U['admin']}', 'admin', 'Ada Admin', 'user', '{U['s1']}', 's1@x.test', 'success', '{{"permanent": true}}'::jsonb);
      insert into public.admin_events (event_type, actor_role, actor_label, result)
        values ('user_login', 'candidate', 's1@x.test', 'failure');
    """)
    events = fn(cur, "admin_list_events", *ALL, None, "user_blocked", None, None, None, None, "created_at", "desc", 10, 0)
    check("admin_list_events finds the block event by type, resolves target_label", len(events) == 1 and events[0]["target_label"] == "s1@x.test", events)
    failures = fn(cur, "admin_list_events", *ALL, None, None, None, None, "failure", None, "created_at", "desc", 10, 0)
    check("admin_list_events filters by result=failure (the audit trail of blocked attempts)",
          len(failures) == 1 and failures[0]["event_type"] == "user_login", failures)
    feed = fn(cur, "admin_activity_feed", None, None, None, None, 500)
    kinds = {r["kind"] for r in feed}
    check("Live Activity merges a derived kind (application_submitted)...", "application_submitted" in kinds, kinds)
    check("...with a SUCCESSFUL admin_events kind (user_blocked)...", "user_blocked" in kinds, kinds)
    check("...but EXCLUDES failed events (the blocked login attempt) -- that's the Audit Log's job, not the friendly feed's",
          "user_login" not in kinds, kinds)
    ids = [r["id"] for r in feed]
    check("every feed row has a stable synthetic id and no two collide", len(ids) == len(set(ids)), len(ids) - len(set(ids)))
    page1 = fn(cur, "admin_activity_feed", None, None, None, None, 3)
    cursor_ts = page1[-1]["occurred_at"]
    page2 = fn(cur, "admin_activity_feed", None, None, cursor_ts, None, 3)
    check("keyset pagination (p_before) returns strictly older rows, no overlap with the previous page",
          all(r["occurred_at"] < cursor_ts for r in page2) and not ({r["id"] for r in page1} & {r["id"] for r in page2}),
          [r["occurred_at"] for r in page2])

    print("\n== Platform Control Center: department breakdown uses RAW branch text ==")
    dept = {r["branch"]: r for r in fn(cur, "admin_department_breakdown", *ALL, None)}
    check("Alpha's candidates split CSE/IT exactly as entered (not alias-merged)", set(dept) >= {"CSE", "IT", "ECE", "ME"}, dept)
    check("CSE candidates = 3 (s1, s2, s9)", dept["CSE"]["candidates"] == 3, dept["CSE"])
    scoped = {r["branch"]: r for r in fn(cur, "admin_department_breakdown", *ALL, C['c1'])}
    check("scoping to Alpha College excludes other colleges' branches (no ECE at Alpha)", "ECE" not in scoped, scoped)

    print("\n== Platform Control Center: CTC by company (posted vs filled) ==")
    ctc = {r["company_name"]: r for r in fn(cur, "admin_ctc_by_company", *ALL)}
    check("Kappa Corp posted 1 INR role (the intern and Lambda's USD role are excluded, as in admin_ctc_stats)",
          ctc["Kappa Corp"]["posted_roles"] == 1, ctc.get("Kappa Corp"))
    check("Kappa Corp filled 2 roles (s1 and s9 were both hired for its Backend Engineer job)", ctc["Kappa Corp"]["filled_roles"] == 2, ctc["Kappa Corp"])
    check("Lambda Ltd (Analyst, INR) filled 2 roles too (s3 and s9)", ctc.get("Lambda Ltd", {}).get("filled_roles") == 2, ctc.get("Lambda Ltd"))

    print("\n== Platform Control Center: alerts fire only on real conditions ==")
    cur.execute(f"update public.job_drives set status='live', created_at = now() - interval '10 days' where id = '{D['d3']}'")
    cur.execute(f"delete from public.applications where job_id = '{J['j3']}' and company_id = '{K['k2']}'")
    alerts = {a["alert_type"] for a in fn(cur, "admin_alerts")}
    check("a live drive with zero applications, open for a week, triggers an alert", "drive_no_applications" in alerts, alerts)
    check("the earlier failed login attempt triggers the blocked-login alert", "blocked_login_attempts" in alerts, alerts)
    cur.execute(f"delete from public.applications where id = '{A['a7']}'")  # restore for later checks not to be affected
    cur.execute(f"insert into public.applications (id, student_id, job_id, company_id, status, applied_at, updated_at) values ('{A['a7']}', '{U['s3']}', '{J['j3']}', '{K['k2']}', 'hired', '2026-02-25', '2026-02-25')")
    cur.execute(f"update public.job_drives set status='closed' where id = '{D['d3']}'")

    print("\n== Platform Control Center: global search ==")
    res = fn(cur, "admin_global_search", "alpha", 5)
    check("finds 'Alpha College' by partial, case-insensitive name", any(r["entity_type"] == "college" and r["title"] == "Alpha College" for r in res), res)
    res = fn(cur, "admin_global_search", "kappa", 5)
    check("finds 'Kappa Corp' by name", any(r["entity_type"] == "company" for r in res), res)
    res = fn(cur, "admin_global_search", "", 5)
    check("a blank query returns nothing (no accidental full-table dump)", res == [], res)

    print("\n== Platform Control Center: platform usage counts only what is actually tracked ==")
    usage = scalar_json(cur, "admin_platform_usage", *ALL)
    check("counts the events just inserted (1 success + 1 failure user_login, 1 user_blocked)",
          usage["logins"] >= 0 and usage["blocked_login_attempts"] >= 1 and usage["users_blocked"] >= 1, usage)
    check("events_tracking_since reflects the earliest admin_events row (honest about no history before it)",
          usage["events_tracking_since"] is not None, usage)

    print("\n== Security: EXECUTE is service_role only ==")
    print("-- (admin_* functions, generically: every function this migration ships is covered)")
    cur.execute("select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'admin\\_%' order by 1")
    all_admin_fns = [r["proname"] for r in cur.fetchall()]
    leaky = []
    for name in all_admin_fns:
        cur.execute(f"select has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') "
                    f"from pg_proc p where p.oid = 'public.{name}'::regproc")
        leaked = cur.fetchone()
        if leaked and any(leaked.values()):
            leaky.append(name)
    check(f"none of the {len(all_admin_fns)} admin_* functions are executable by anon/authenticated (incl. every function added in this session)",
          not leaky, leaky)
    for role, expect_ok in (("anon", False), ("authenticated", False), ("service_role", True)):
        cur.execute(f"set role {role}")
        try:
            cur.execute("select public.admin_overview(null, null)")
            got = True
        except psycopg2.Error as e:
            got = False
            code = e.pgcode
        cur.execute("reset role")
        check(f"{role}: admin_overview {'allowed' if expect_ok else 'denied (42501)'}",
              got == expect_ok and (expect_ok or code == "42501"))
    cur.execute("set role authenticated")
    for helper in ("admin_actor_events()", "admin_app_facts(null, null)", "admin_college_accounts()"):
        try:
            cur.execute(f"select * from public.{helper}")
            got = True
        except psycopg2.Error:
            got = False
        check(f"authenticated cannot read raw helper {helper}", not got)
    cur.execute("reset role")

    print("\n== Security: profiles role guard ==")
    cur.execute("set role authenticated")

    check("authenticated cannot promote own role to admin",
          attempt(cur, f"update public.profiles set role = 'admin' where id = '{U['s1']}'") == "42501")
    check("authenticated cannot flip candidate -> college",
          attempt(cur, f"update public.profiles set role = 'college' where id = '{U['s2']}'") == "42501")
    check("authenticated cannot insert an admin profile",
          attempt(cur, f"insert into public.profiles (id, email, role) values (gen_random_uuid(), 'evil@x.test', 'admin')") == "42501")
    check("authenticated cannot insert a college profile",
          attempt(cur, f"insert into public.profiles (id, email, role) values (gen_random_uuid(), 'evil2@x.test', 'college')") == "42501")
    check("a College user cannot re-point their college_id at another college",
          attempt(cur, f"update public.profiles set college_id = '{C['c2']}' where id = '{U['t1']}'") == "42501")
    check("authenticated CAN still update ordinary profile fields",
          attempt(cur, f"update public.profiles set name = 'Renamed' where id = '{U['s1']}'") == "ok")
    check("a candidate can still pick/change their own college_id",
          attempt(cur, f"update public.profiles set college_id = '{C['c2']}' where id = '{U['s1']}'") == "ok")
    cur.execute("reset role")
    cur.execute("set role service_role")
    check("service_role (backend) can set roles",
          attempt(cur, f"update public.profiles set role = 'candidate' where id = '{U['s7']}'") == "ok")
    cur.execute("reset role")
    check("direct DB session (migrations / SQL editor) is unrestricted",
          attempt(cur, f"update public.profiles set role = 'candidate' where id = '{U['s7']}'") == "ok")

    conn.close()
    with admin.cursor() as cur2:
        cur2.execute(f"drop database if exists {DB}")
    admin.close()

    print(f"\n=== {passed}/{passed + failed} passed, {failed} failed ===")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
