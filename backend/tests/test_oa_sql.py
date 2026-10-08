"""
Online Assessment SQL test -- applies the OA migrations (and everything they depend on)
to a THROWAWAY PostgreSQL, loads the real problem seed, and checks constraints, defaults,
cascades and row-level security.

    OA_TEST_DATABASE_URL=postgresql://postgres@localhost:54329/postgres python tests/test_oa_sql.py

Skips (exit 0) when OA_TEST_DATABASE_URL is unset. Refuses any URL containing "supabase".
Creates database `oa_sql_test` and drops it at the end. Exits 1 on any failure.
"""

from __future__ import annotations

import json
import os
import sys
from urllib.parse import urlparse, urlunparse

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)

URL = os.environ.get("OA_TEST_DATABASE_URL")
if not URL:
    print("SKIP: set OA_TEST_DATABASE_URL to a scratch Postgres to run the OA SQL test.")
    sys.exit(0)
if "supabase" in URL.lower():
    print("REFUSING: this test creates/drops a database and must never target Supabase.")
    sys.exit(1)

import psycopg2  # noqa: E402

DB = "oa_sql_test"
_p = urlparse(URL)
TEST_URL = urlunparse(_p._replace(path=f"/{DB}"))

PRELUDE = """
do $$ begin  -- roles are cluster-wide and survive the dropped database
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin; end if;
end $$;
-- Supabase grants service_role BYPASSRLS at the platform level (outside any
-- migration file); mirrored here so `set role service_role` genuinely
-- exercises the same bypass a real backend request gets, for every
-- RLS-enabled, no-policy table (admin_events, admin_user_permissions, ...).
alter role service_role bypassrls;
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
    "db/migrations.sql", "incremental_migration.sql", "incremental_migration_candidate_profile.sql",
    "db/company_migration.sql", "db/company_onboarding_migration.sql", "db/resume_analysis_migration.sql",
    "db/jobs_and_applications_migration.sql", "db/jobs_eligibility_migration.sql",
    "db/college_onboarding_migration.sql", "db/job_internship_perks_and_colleges_seed.sql",
    "db/job_drives_migration.sql",
    "db/online_assessment_migration.sql", "db/online_assessment_coding_migration.sql",
]

fails = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f" -- {detail}" if not cond else ""))
    if not cond:
        fails.append(name)


admin = psycopg2.connect(URL)
admin.autocommit = True
with admin.cursor() as c:
    c.execute(f"drop database if exists {DB}")
    c.execute(f"create database {DB}")

conn = psycopg2.connect(TEST_URL)
conn.autocommit = True
cur = conn.cursor()
cur.execute(PRELUDE)
for m in MIGRATIONS:
    cur.execute(open(os.path.join(BACKEND, m), encoding="utf-8").read())
# idempotent: the two OA files must be safely re-runnable
for m in MIGRATIONS[-2:]:
    cur.execute(open(os.path.join(BACKEND, m), encoding="utf-8").read())
check("all migrations apply, OA ones twice", True)


def rejected(sql, args=()):
    cur.execute("savepoint s") if not conn.autocommit else None
    try:
        cur.execute(sql, args)
        return False
    except psycopg2.Error:
        return True


# ── real seed loads cleanly ─────────────────────────────────────────
seed = json.load(open(os.path.join(BACKEND, "db/seed/oa_problems.json")))
for p in seed:
    tests = p.pop("tests")
    cur.execute(
        "insert into oa_problems(id,title,difficulty,topics,statement_html,constraints_html,function_name,params,"
        "starter_code,languages,compare,validated) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (p["id"], p["title"], p["difficulty"], p["topics"], p["statement_html"], p["constraints_html"],
         p["function_name"], p["params"], json.dumps(p["starter_code"]), p["languages"], p["compare"], p["validated"]))
    for i, t in enumerate(tests, 1):
        cur.execute("insert into oa_problem_tests(problem_id,position,args,expected,is_visible) values (%s,%s,%s,%s,%s)",
                    (p["id"], i, json.dumps(t["args"]), json.dumps(t["expected"]), t["is_visible"]))
cur.execute("select count(*) from oa_problems"); n = cur.fetchone()[0]
check("seed loads every problem", n == len(seed), n)
cur.execute("select count(*) from oa_problems p where validated and not exists "
            "(select 1 from oa_problem_tests t where t.problem_id=p.id and t.is_visible) ")
check("every validated problem has at least one visible example", cur.fetchone()[0] == 0)
cur.execute("select count(*) from oa_problems p where validated and (select count(*) from oa_problem_tests t where t.problem_id=p.id and not t.is_visible) = 0")
check("every validated problem has hidden tests", cur.fetchone()[0] == 0)

check("bad compare mode rejected", rejected("insert into oa_problems(id,title,statement_html,function_name,compare) values ('x','x','x','x','weird')"))
check("bad difficulty rejected", rejected("insert into oa_problems(id,title,statement_html,function_name,difficulty) values ('y','y','y','y','Impossible')"))

# ── chain of rows ───────────────────────────────────────────────────
S1, S2, OWN = ("00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000a2", "00000000-0000-0000-0000-0000000000b1")
COL, CO, JOB, DR = ("c1000000-0000-0000-0000-000000000001", "a1000000-0000-0000-0000-000000000001",
                    "b1000000-0000-0000-0000-000000000001", "d1000000-0000-0000-0000-000000000001")
AP1, AP2, ASM, SEC, Q, ATT = ("e1000000-0000-0000-0000-000000000001", "e2000000-0000-0000-0000-000000000002",
                             "aa000000-0000-0000-0000-000000000001", "55000000-0000-0000-0000-000000000001",
                             "99000000-0000-0000-0000-000000000001", "77000000-0000-0000-0000-000000000001")
cur.execute("insert into auth.users(id,email) values (%s,'s@x.t'),(%s,'s2@x.t'),(%s,'o@x.t')", (S1, S2, OWN))
cur.execute("insert into colleges(id,name) values (%s,'C')", (COL,))
cur.execute("insert into profiles(id,email,role,name,college_id) values (%s,'s@x.t','candidate','S',%s),(%s,'s2@x.t','candidate','S2',%s)", (S1, COL, S2, COL))
cur.execute("insert into profiles(id,email,role,name) values (%s,'o@x.t','company','O')", (OWN,))
cur.execute("insert into companies(id,owner_id,name,industry,size) values (%s,%s,'K','Software','50-200')", (CO, OWN))
cur.execute("insert into jobs(id,company_id,title,description,domain,experience_level,location,deadline,status) values (%s,%s,'Eng','x','tech','fresher','P','2030-01-01','live')", (JOB, CO))
cur.execute("insert into job_drives(id,job_id,college_id,status,apply_deadline) values (%s,%s,%s,'live','2030-01-01')", (DR, JOB, COL))
cur.execute("insert into applications(id,student_id,job_id,company_id) values (%s,%s,%s,%s),(%s,%s,%s,%s)", (AP1, S1, JOB, CO, AP2, S2, JOB, CO))
cur.execute("insert into oa_assessments(id,drive_id,title) values (%s,%s,'OA') returning invite_mode", (ASM, DR))
check("new assessments default to invite-only", cur.fetchone()[0] == "invited")
check("one assessment per drive", rejected("insert into oa_assessments(drive_id,title) values (%s,'dup')", (DR,)))
cur.execute("insert into oa_sections(id,assessment_id,position,title,kind,duration_minutes) values (%s,%s,1,'C1','coding',15)", (SEC, ASM))
check("section kind / duration constrained", rejected("insert into oa_sections(assessment_id,position,title,kind,duration_minutes) values (%s,2,'x','essay',15)", (ASM,))
      and rejected("insert into oa_sections(assessment_id,position,title,kind,duration_minutes) values (%s,3,'x','coding',0)", (ASM,)))
cur.execute("insert into oa_questions(id,section_id,position,qtype,title,prompt,problem_id,points) values (%s,%s,1,'coding','Two Sum','p','two-sum',100)", (Q, SEC))
check("question must reference a real problem", rejected("insert into oa_questions(section_id,position,qtype,title,prompt,problem_id) values (%s,2,'coding','t','p','no-such')", (SEC,)))
cur.execute("insert into oa_attempts(id,application_id,student_id,assessment_id) values (%s,%s,%s,%s) returning tab_switches,fullscreen_exits,paste_events,status", (ATT, AP1, S1, ASM))
check("attempt counters + status default", cur.fetchone() == (0, 0, 0, "in_progress"))
check("one attempt per application", rejected("insert into oa_attempts(application_id,student_id,assessment_id) values (%s,%s,%s)", (AP1, S1, ASM)))
cur.execute("insert into oa_submissions(attempt_id,question_id,language,source,verdict,passed,total,score) values (%s,%s,'python','x','accepted',5,5,100)", (ATT, Q))
check("bad verdict rejected", rejected("insert into oa_submissions(attempt_id,question_id,language,source,verdict) values (%s,%s,'python','x','great')", (ATT, Q)))
cur.execute("insert into oa_answers(attempt_id,question_id,answer) values (%s,%s,'code')", (ATT, Q))
check("one answer row per attempt+question", rejected("insert into oa_answers(attempt_id,question_id,answer) values (%s,%s,'again')", (ATT, Q)))
cur.execute("insert into oa_invites(application_id,assessment_id) values (%s,%s)", (AP1, ASM))
check("one invite per application", rejected("insert into oa_invites(application_id,assessment_id) values (%s,%s)", (AP1, ASM)))

# ── RLS: students see only their own rows; hidden tests / submissions are server-only ──
def as_student(uid):
    cur.execute("begin"); cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (uid,))
    out = {}
    for t in ("oa_invites", "oa_attempts", "oa_problem_tests", "oa_submissions", "oa_answers"):
        cur.execute("savepoint sp")
        try:
            cur.execute(f"select count(*) from {t}"); out[t] = cur.fetchone()[0]
        except psycopg2.Error:
            out[t] = "denied"; cur.execute("rollback to savepoint sp")
    cur.execute("rollback")
    return out

mine, other = as_student(S1), as_student(S2)
check("student sees their own invite and attempt", mine["oa_invites"] == 1 and mine["oa_attempts"] == 1, mine)
check("another student sees neither", other["oa_invites"] == 0 and other["oa_attempts"] == 0, other)
check("hidden tests, submissions and answers are not readable by students",
      all(v in (0, "denied") for k, v in mine.items() if k in ("oa_problem_tests", "oa_submissions", "oa_answers")), mine)

# ── cascades ────────────────────────────────────────────────────────
cur.execute("delete from oa_assessments where id=%s", (ASM,))
cur.execute("select (select count(*) from oa_sections),(select count(*) from oa_questions),(select count(*) from oa_attempts),"
            "(select count(*) from oa_submissions),(select count(*) from oa_answers),(select count(*) from oa_invites)")
check("deleting an assessment removes everything under it", cur.fetchone() == (0, 0, 0, 0, 0, 0))
cur.execute("select count(*) from oa_problems")
check("...but never the problem library", cur.fetchone()[0] == len(seed))

conn.close()
with admin.cursor() as c:
    c.execute(f"drop database {DB}")
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
