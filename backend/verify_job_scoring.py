"""
Step 6 verification — Job Posting → Job Board → Application → Job-Scoped Scoring
==============================================================================

Creates 2 companies, 2 jobs with DIFFERENT weight configs, and 2 students,
has both students apply to both jobs (4 applications), then asserts:

  1. Each application gets its OWN application_analyses row (4 total, keyed
     by application_id), each with the weights snapshot of its own job.
  2. For a given student, the two jobs' analyses differ (weights actually
     applied) — no cross-contamination.
  3. Company A cannot read Company B's applicants / analyses / statuses,
     even by calling the API directly with Company A's session against
     Company B's job_id.
  4. Student 1 cannot read Student 2's application analysis via the API.
  5. (If SUPABASE_ANON_KEY is set) the RLS policies themselves block the
     same cross-tenant reads when hit directly with a user JWT.

Requirements to RUN this:
  * The FastAPI backend running and reachable (API_BASE below).
  * backend/.env populated (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    GEMINI_API_KEY). Set SUPABASE_ANON_KEY too for the direct-RLS checks.
  * db/jobs_and_applications_migration.sql already applied.

Usage:
    python verify_job_scoring.py            # run the full check
    python verify_job_scoring.py --reset    # tear down prior verify_* seed data only
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from datetime import date, timedelta

import httpx
from dotenv import load_dotenv
from supabase import ClientOptions, create_client

load_dotenv()

API_BASE = os.getenv("VERIFY_API_BASE", "http://127.0.0.1:8000").rstrip("/")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in environment.")
    sys.exit(1)

# `svc` is ONLY used for auth.admin.* and service-role table writes — never
# for sign-in. supabase-py rewrites a client's shared Authorization header to
# the current user's JWT on SIGNED_IN, which would turn the next admin call
# into a plain-user call → 403 "User not allowed" (see backend/app/deps.py).
_NO_SESSION = ClientOptions(auto_refresh_token=False, persist_session=False)
svc = create_client(SUPABASE_URL, SERVICE_KEY, options=_NO_SESSION)


def user_token(email: str, password: str) -> str:
    """Sign in on a throwaway client so no user JWT ever leaks onto `svc`."""
    tmp = create_client(SUPABASE_URL, SERVICE_KEY, options=_NO_SESSION)
    return tmp.auth.sign_in_with_password({"email": email, "password": password}).session.access_token

TAG = "verifyjs"  # marks every seed row so --reset can find them
PW = "Verify-Passw0rd!"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


# ── Seed data helpers ────────────────────────────────────────────────

def _email(kind: str, n: int) -> str:
    return f"{TAG}+{kind}{n}@example.com"


def reset() -> None:
    """Delete only this script's own seed rows + auth users."""
    print("Resetting prior verify seed data…")
    # analyses / applications / jobs cascade from companies; delete companies
    # by owner email, then profiles, then auth users.
    users = svc.auth.admin.list_users()
    for u in users:
        if u.email and u.email.startswith(f"{TAG}+"):
            try:
                svc.table("applications").delete().eq("student_id", u.id).execute()
            except Exception:
                pass
            try:
                svc.table("companies").delete().eq("owner_id", u.id).execute()
            except Exception:
                pass
            try:
                svc.table("resume_analyses").delete().eq("candidate_id", u.id).execute()
            except Exception:
                pass
            try:
                svc.table("profiles").delete().eq("id", u.id).execute()
            except Exception:
                pass
            try:
                svc.auth.admin.delete_user(u.id)
            except Exception:
                pass
    svc.table("colleges").delete().like("name", f"{TAG}%").execute()
    print("Reset done.")


def make_user(kind: str, n: int, role: str) -> dict:
    email = _email(kind, n)
    created = svc.auth.admin.create_user({
        "email": email,
        "password": PW,
        "email_confirm": True,
        "user_metadata": {"role": role},
    })
    uid = created.user.id
    svc.table("profiles").upsert({
        "id": uid, "email": email, "role": role,
        "first_name": kind.capitalize(), "last_name": str(n), "name": f"{kind.capitalize()} {n}",
        "onboarded": True,
    }).execute()
    return {"id": uid, "email": email, "token": user_token(email, PW)}


def make_company(n: int) -> dict:
    u = make_user("company", n, "company")
    row = svc.table("companies").insert({
        "owner_id": u["id"], "name": f"{TAG} Company {n}",
        "industry": "Software", "size": "11-50", "hiring_domains": ["tech"],
    }).execute().data[0]
    return {**u, "company_id": row["id"]}


def make_resume_analysis(student_id: str) -> None:
    """Minimal but schema-valid resume_analyses row so scoring has inputs."""
    mv = svc.table("model_versions").select("id").eq("version_label", f"{TAG}-seed").limit(1).execute()
    if mv.data:
        mv_id = mv.data[0]["id"]
    else:
        mv_id = svc.table("model_versions").insert({
            "version_label": f"{TAG}-seed", "prompt_text": "seed",
        }).execute().data[0]["id"]

    output_json = {
        "detected_discrepancies": [],
        "role_fit": {
            "matched_skills": ["Python", "FastAPI", "PostgreSQL"],
            "missing_skills": ["Kubernetes"],
            "fit_summary": "Solid backend fundamentals with room to grow on infra.",
        },
        "strengths": ["Ships end-to-end projects", "Clear README documentation"],
        "weaknesses": ["Resume runs to two pages"],
        "resume_corrections": ["Trim the projects section to the top 3."],
        "next_week_action_plan": [
            "Add integration tests to the main project",
            "Deploy the API to a cloud provider",
            "Read one paper on distributed systems",
            "Refactor the auth module",
            "Write API docs",
            "Solve 3 graph problems",
            "Open a PR to an OSS repo",
        ],
        "overall_rating": {"score": 68, "verdict": "Promising, Needs Polish",
                           "summary": "Real project experience; infra depth is the gap."},
    }
    portfolio = {
        "github": {"public_repos": 12, "top_languages": ["Python", "TypeScript"],
                   "notable_repos": [{"name": "task-api", "stars": 8, "is_fork": False}]},
        "leetcode": {"solved": {"easy": 90, "medium": 60, "hard": 8}, "contest_rating": 1520},
        "codeforces": None,
    }
    svc.table("resume_analyses").insert({
        "candidate_id": student_id, "model_version_id": mv_id,
        "role_target": "Backend Engineer", "source": "real_user",
        "parsed_resume_text": "Seed resume text for verification. Backend engineer, Python, FastAPI, "
                              "built a task API with Postgres, deployed on Render. LeetCode 158 solved.",
        "portfolio_metrics_json": portfolio, "output_json": output_json,
        "overall_score": 68, "latency_ms": 1234,
    }).execute()


def create_job_via_api(company: dict, n: int, weights: dict, college_id: str | None) -> str:
    body = {
        "title": f"{TAG} Job {n}",
        "description": "Verification job. Build and maintain backend services in Python/FastAPI "
                       "with Postgres. Own features end to end. " + ("x" * 20),
        "domain": "tech",
        "experience_level": "fresher",
        "location": "Remote",
        "openings_count": 3,
        "deadline": (date.today() + timedelta(days=30)).isoformat(),
        "visibility": "all",
        "skills": ["Python", "FastAPI", "PostgreSQL", "Docker"],
        "visible_college_ids": [],
        "weights": weights,
        "publish": True,
    }
    r = httpx.post(f"{API_BASE}/company/jobs", json=body,
                   headers={"Authorization": f"Bearer {company['token']}"}, timeout=30)
    r.raise_for_status()
    return r.json()["id"]


# ── Main ─────────────────────────────────────────────────────────────

def main() -> int:
    if "--reset" in sys.argv:
        reset()
        return 0

    # Fresh start
    reset()

    print("\nSeeding…")
    college_id = svc.table("colleges").insert({"name": f"{TAG} Institute of Tech"}).execute().data[0]["id"]

    company_a = make_company(1)
    company_b = make_company(2)

    students = []
    for i in (1, 2):
        u = make_user("student", i, "candidate")
        svc.table("profiles").update({"domain": "tech", "college_id": college_id}).eq("id", u["id"]).execute()
        make_resume_analysis(u["id"])
        students.append(u)

    # Two jobs, DELIBERATELY different weight configs.
    weights_a = {"resume_weight": 70, "github_weight": 20, "leetcode_weight": 10,
                 "interview_weight": 0, "assessment_weight": 0}
    weights_b = {"resume_weight": 10, "github_weight": 10, "leetcode_weight": 30,
                 "interview_weight": 25, "assessment_weight": 25}
    job_a = create_job_via_api(company_a, 1, weights_a, college_id)
    job_b = create_job_via_api(company_b, 2, weights_b, college_id)
    print(f"  job_a={job_a} (company A, resume-heavy)")
    print(f"  job_b={job_b} (company B, balanced/leetcode-heavy)")

    # Each student applies to BOTH jobs → 4 applications.
    print("\nApplying (4 applications) and waiting for scoring…")
    app_ids: dict[tuple[int, str], str] = {}
    for idx, s in enumerate(students, start=1):
        for job_id in (job_a, job_b):
            r = httpx.post(f"{API_BASE}/candidate/jobs/{job_id}/apply",
                           headers={"Authorization": f"Bearer {s['token']}"}, timeout=30)
            r.raise_for_status()
            app_ids[(idx, job_id)] = r.json()["id"]

    # Poll application_analyses (scoring runs in a BackgroundTask + real Gemini call).
    deadline = time.time() + 180
    while time.time() < deadline:
        rows = svc.table("application_analyses").select("application_id").in_(
            "application_id", list(app_ids.values())
        ).execute().data
        if len(rows) == 4:
            break
        time.sleep(4)

    analyses = {
        r["application_id"]: r
        for r in svc.table("application_analyses").select("*").in_(
            "application_id", list(app_ids.values())
        ).execute().data
    }

    print("\n── Assertions ──")

    # 1. Exactly 4 analyses, one per application_id.
    check("4 distinct analyses, one per application_id",
          len(analyses) == 4 and all(a in analyses for a in app_ids.values()),
          f"{len(analyses)}/4 present")

    # 2. Every analysis's denormalized keys agree with its application.
    keys_ok = True
    for (sidx, job_id), app_id in app_ids.items():
        a = analyses.get(app_id)
        if not a:
            keys_ok = False
            continue
        app = svc.table("applications").select("*").eq("id", app_id).single().execute().data
        if a["job_id"] != app["job_id"] or a["student_id"] != app["student_id"] or a["company_id"] != app["company_id"]:
            keys_ok = False
    check("analysis job_id/student_id/company_id match their application", keys_ok)

    # 3. Weights snapshot on each analysis == its job's weights.
    snap_ok = True
    for (sidx, job_id), app_id in app_ids.items():
        a = analyses.get(app_id, {})
        want = weights_a if job_id == job_a else weights_b
        if a.get("weights_snapshot") != want:
            snap_ok = False
    check("each analysis stored ITS OWN job's weight snapshot", snap_ok)

    # 4. For each student, Job A vs Job B analyses differ (weights applied).
    diff_ok = True
    detail = []
    for sidx in (1, 2):
        a = analyses[app_ids[(sidx, job_a)]]
        b = analyses[app_ids[(sidx, job_b)]]
        same_composite = abs(float(a["weighted_composite"]) - float(b["weighted_composite"])) < 0.01
        same_prob = a["placement_probability"] == b["placement_probability"]
        if same_composite and same_prob:
            diff_ok = False
        detail.append(
            f"S{sidx}: A comp={a['weighted_composite']} p={a['placement_probability']} | "
            f"B comp={b['weighted_composite']} p={b['placement_probability']}"
        )
    check("same student, different job → different result (no cross-contamination)", diff_ok,
          " ; ".join(detail))

    # 5. Company A cannot see Company B's applicants (API tampering).
    ra = httpx.get(f"{API_BASE}/company/jobs/{job_b}/applicants",
                   headers={"Authorization": f"Bearer {company_a['token']}"}, timeout=30)
    check("Company A → GET Company B job applicants is blocked", ra.status_code in (403, 404),
          f"HTTP {ra.status_code}")

    # 6. Company A cannot read a specific Company B analysis (API tampering).
    some_b_app = app_ids[(1, job_b)]
    rb = httpx.get(f"{API_BASE}/company/jobs/{job_b}/applicants/{some_b_app}",
                   headers={"Authorization": f"Bearer {company_a['token']}"}, timeout=30)
    check("Company A → GET Company B applicant analysis is blocked", rb.status_code in (403, 404),
          f"HTTP {rb.status_code}")

    # 7. Company A cannot PATCH status on Company B's application.
    rc = httpx.patch(f"{API_BASE}/company/jobs/{job_b}/applicants/{some_b_app}/status",
                     json={"status": "shortlisted"},
                     headers={"Authorization": f"Bearer {company_a['token']}"}, timeout=30)
    check("Company A → PATCH Company B applicant status is blocked", rc.status_code in (403, 404),
          f"HTTP {rc.status_code}")

    # 8. Student 1 cannot read Student 2's analysis via the API.
    s2_app = app_ids[(2, job_a)]
    rd = httpx.get(f"{API_BASE}/candidate/jobs/applications/{s2_app}",
                   headers={"Authorization": f"Bearer {students[0]['token']}"}, timeout=30)
    check("Student 1 → GET Student 2 application analysis is blocked", rd.status_code in (403, 404),
          f"HTTP {rd.status_code}")

    # 9. Sanity: each party CAN read their own.
    own_company = httpx.get(f"{API_BASE}/company/jobs/{job_b}/applicants",
                            headers={"Authorization": f"Bearer {company_b['token']}"}, timeout=30)
    own_student = httpx.get(f"{API_BASE}/candidate/jobs/applications/{app_ids[(1, job_a)]}",
                            headers={"Authorization": f"Bearer {students[0]['token']}"}, timeout=30)
    check("Company B CAN read its own applicants", own_company.status_code == 200,
          f"HTTP {own_company.status_code}")
    check("Student 1 CAN read their own analysis", own_student.status_code == 200,
          f"HTTP {own_student.status_code}")

    # 10. Direct RLS check (only if an anon key is available).
    if ANON_KEY:
        acli = create_client(SUPABASE_URL, ANON_KEY)
        acli.postgrest.auth(company_a["token"])
        leaked = acli.table("application_analyses").select("id").eq("job_id", job_b).execute().data
        check("RLS: Company A JWT sees 0 rows of Company B analyses (direct table read)",
              len(leaked) == 0, f"{len(leaked)} rows leaked")

        acli2 = create_client(SUPABASE_URL, ANON_KEY)
        acli2.postgrest.auth(students[0]["token"])
        leaked2 = acli2.table("application_analyses").select("id").neq("student_id", students[0]["id"]).execute().data
        check("RLS: Student 1 JWT sees 0 other students' analyses (direct table read)",
              len(leaked2) == 0, f"{len(leaked2)} rows leaked")

        acli3 = create_client(SUPABASE_URL, ANON_KEY)
        acli3.postgrest.auth(students[0]["token"])
        w_leak = acli3.table("job_weights").select("job_id").execute().data
        check("RLS: a student JWT sees 0 job_weights rows (weights never exposed to students)",
              len(w_leak) == 0, f"{len(w_leak)} rows leaked")
    else:
        print("  [skip] direct-RLS checks — set SUPABASE_ANON_KEY in backend/.env to run them.")

    # ── Summary ──
    print("\n" + "=" * 64)
    print("WEIGHT SNAPSHOTS & SCORES")
    for sidx in (1, 2):
        for label, job_id in (("A resume-heavy", job_a), ("B balanced", job_b)):
            a = analyses[app_ids[(sidx, job_id)]]
            print(f"  Student {sidx} × Job {label}: weights={a['weights_snapshot']} "
                  f"composite={a['weighted_composite']} placement_probability={a['placement_probability']}")
    print("=" * 64)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed.")
    failed = [n for n, ok, _ in results if not ok]
    if failed:
        print("FAILED: " + "; ".join(failed))
        return 1
    print("ALL CHECKS PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
