"""Integration: the College Portal's read-only view of platform drives and student outcomes
(GET /api/dashboard/platform).

The data lives in tables owned by the Company and Candidate portals (job_drives, jobs, applications,
application_round_results, profiles). The fakes here do not evaluate RLS, so what is proven is the
application-level scoping: only the caller's college, only rostered students, no sensitive fields, and
no writes of any kind.
"""
import json

import pytest

from app.routers.college import platform

URL = "/api/dashboard/platform"


@pytest.fixture
def world(env):
    env.college("col-1", "Alpha College")
    env.college("col-2", "Beta College")
    a = env.user("tpo-a", "college", profile={"college_id": "col-1"})
    b = env.user("tpo-b", "college", profile={"college_id": "col-2"})

    env.db.add("companies", id="c1", name="Acme", owner_id="o1")
    env.db.add("companies", id="c2", name="Globex", owner_id="o2")
    env.db.add("jobs", id="j1", company_id="c1", title="Software Engineer", location="Pune", employment_type="full-time", status="live")
    env.db.add("jobs", id="j2", company_id="c2", title="QA Analyst", location="Remote", employment_type="internship", status="live")
    env.db.add("jobs", id="j3", company_id="c1", title="Unannounced Role", location="Pune", employment_type="full-time", status="live")

    env.db.add("job_drives", id="d1", job_id="j1", college_id="col-1", status="live", is_on_campus=True,
               apply_deadline="2030-01-10T00:00:00+00:00", min_cgpa=7.5, eligible_branches=["CSE", "IT"], eligible_batch_years=[2026])
    env.db.add("job_drives", id="d2", job_id="j2", college_id="col-1", status="closed", is_on_campus=False, apply_deadline="2029-01-01T00:00:00+00:00")
    env.db.add("job_drives", id="d3", job_id="j3", college_id="col-1", status="draft", apply_deadline="2031-01-01T00:00:00+00:00")   # a company's private draft
    env.db.add("job_drives", id="d4", job_id="j1", college_id="col-2", status="live", apply_deadline="2030-02-01T00:00:00+00:00")     # the SAME job, at the other college
    env.db.add("job_drive_rounds", id="r1", drive_id="d1", round_number=1, round_type="tech", mode="ai")
    env.db.add("job_drive_rounds", id="r2", drive_id="d1", round_number=2, round_type="hr", mode="live", window_start="2030-01-20T00:00:00+00:00")

    for sid, name, email, cid, placement in [
        ("sa", "Asha A", "asha@a.edu", "col-1", "not_placed"), ("sb", "Ben B", "ben@a.edu", "col-1", "not_placed"),
        ("sc", "Cara C", "cara@a.edu", "col-1", "not_placed"), ("sd", "Dev D", "dev@b.edu", "col-2", "not_placed"),
    ]:
        env.db.add("students", id=sid, college_id=cid, name=name, email=email, branch="CSE", graduation_year=2026,
                   employability_score=88, verification_status="verified", placement_status=placement, status="active")
    # platform accounts: pA/pB are on A's roster; pX claims College 1 but is on nobody's roster; pD is B's;
    # pM claims College 1 but their email is on B's roster; "ASHA@A.EDU" differs from the roster only by case.
    for pid, email, cid in [("pA", "ASHA@A.EDU", "col-1"), ("pB", "ben@a.edu", "col-1"), ("pC", "cara@a.edu", "col-1"),
                            ("pX", "stranger@a.edu", "col-1"), ("pD", "dev@b.edu", "col-2"), ("pM", "dev2@b.edu", "col-1")]:
        env.db.add("profiles", id=pid, email=email, role="candidate", college_id=cid)
    env.db.add("students", id="se", college_id="col-2", name="Eve E", email="dev2@b.edu", branch="IT", graduation_year=2026,
               employability_score=1, verification_status="pending", placement_status="not_placed", status="active")

    def apply(aid, pid, job, status):
        env.db.add("applications", id=aid, student_id=pid, job_id=job, company_id="c1", status=status,
                   applied_at=f"2029-12-{10 + len(env.db.rows('applications')):02d}T00:00:00+00:00")
    apply("a1", "pA", "j1", "hired"); apply("a2", "pA", "j2", "applied"); apply("a3", "pB", "j1", "shortlisted")
    apply("a4", "pX", "j1", "applied"); apply("a5", "pD", "j1", "hired"); apply("a6", "pA", "j3", "applied"); apply("a7", "pM", "j1", "hired")
    env.db.add("application_round_results", id="x1", application_id="a1", round_id="r1", status="shortlisted", round_score=97)
    env.db.add("application_round_results", id="x2", application_id="a1", round_id="r2", status="shortlisted")
    env.db.add("application_round_results", id="x3", application_id="a3", round_id="r1", status="pending")
    return type("W", (), {"a": a, "b": b})


def view(env, h):
    r = env.client.get(URL, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_college_sees_its_live_and_closed_drives_but_never_a_draft_or_another_colleges(env, world):
    body = view(env, world.a)
    assert [d["id"] for d in body["drives"]] == ["d2", "d1"]          # soonest apply deadline first; d3 (draft) and d4 (other college) absent
    d1 = next(d for d in body["drives"] if d["id"] == "d1")
    assert (d1["jobTitle"], d1["companyName"], d1["location"], d1["status"], d1["isOnCampus"]) == ("Software Engineer", "Acme", "Pune", "live", True)
    assert d1["eligibility"] == {"minCgpa": 7.5, "branches": ["CSE", "IT"], "batchYears": [2026]}
    assert [(r["number"], r["type"], r["mode"]) for r in d1["rounds"]] == [(1, "tech", "ai"), (2, "hr", "live")]
    assert "Unannounced Role" not in json.dumps(body)


def test_the_funnel_counts_only_students_on_this_colleges_roster(env, world):
    drives = {d["id"]: d for d in view(env, world.a)["drives"]}
    # j1 applicants: Asha (hired), Ben (shortlisted) on the roster; the stranger, the other college's student and the
    # student whose email is on the other college's roster are all excluded.
    assert drives["d1"]["funnel"] == {"applicants": 2, "inProgress": 0, "shortlisted": 1, "inInterview": 0, "selected": 1, "rejected": 0}
    assert drives["d2"]["funnel"]["applicants"] == 1 and drives["d2"]["funnel"]["inProgress"] == 1


def test_outcomes_list_each_rostered_student_with_their_applications_and_round_progress(env, world):
    body = view(env, world.a)
    assert body["studentsOnPlatform"] == 2 and [s["email"] for s in body["students"]] == ["asha@a.edu", "ben@a.edu"]   # selected first; roster email, not the account's
    asha = body["students"][0]
    assert (asha["studentId"], asha["name"], asha["selectedOnPlatform"], asha["placementStatus"]) == ("sa", "Asha A", True, "not_placed")
    by_job = {a["jobTitle"]: a for a in asha["applications"]}
    assert set(by_job) == {"Software Engineer", "QA Analyst"}            # her application to the draft drive is not shown
    assert by_job["Software Engineer"]["status"] == "hired"
    assert by_job["Software Engineer"]["rounds"] == [{"number": 1, "type": "tech", "mode": "ai", "status": "shortlisted"},
                                                     {"number": 2, "type": "hr", "mode": "live", "status": "shortlisted"}]
    ben = body["students"][1]
    assert ben["applications"][0]["rounds"][0]["status"] == "pending" and ben["selectedOnPlatform"] is False


def test_a_student_selected_on_the_platform_is_flagged_for_roster_review_and_the_roster_is_never_changed(env, world):
    before = [dict(r) for r in env.db.rows("students")]
    body = view(env, world.a)
    assert body["students"][0]["rosterNeedsReview"] is True and body["totals"] == {"applications": 3, "selected": 1, "needsRosterUpdate": 1}
    assert [dict(r) for r in env.db.rows("students")] == before
    env.db.tables["students"][0]["placement_status"] = "placed"                       # the TPO updates the roster themselves
    again = view(env, world.a)
    assert again["students"][0]["rosterNeedsReview"] is False and again["totals"]["needsRosterUpdate"] == 0


def test_another_college_sees_only_its_own_side_of_the_same_job(env, world):
    body = view(env, world.b)
    assert [d["id"] for d in body["drives"]] == ["d4"]
    assert body["drives"][0]["funnel"]["applicants"] == 1 and body["drives"][0]["funnel"]["selected"] == 1
    assert [s["email"] for s in body["students"]] == ["dev@b.edu"]        # pM (account says College 1) is not B's student; pD is
    dump = json.dumps(body)
    assert "asha@a.edu" not in dump and "Asha" not in dump and "QA Analyst" not in dump and "d1" not in dump


def test_a_profile_that_merely_claims_a_college_is_not_enough_it_must_also_be_on_the_roster(env, world):
    emails = [s["email"] for s in view(env, world.a)["students"]]
    assert "stranger@a.edu" not in emails and "dev2@b.edu" not in emails


def test_nothing_sensitive_is_ever_returned(env, world):
    allowed_student = {"studentId", "name", "email", "branch", "graduationYear", "placementStatus", "selectedOnPlatform", "rosterNeedsReview", "applications"}
    allowed_application = {"driveId", "jobTitle", "companyName", "status", "appliedAt", "rounds"}
    body = view(env, world.a)
    assert all(set(s) == allowed_student for s in body["students"])
    assert all(set(a) == allowed_application for s in body["students"] for a in s["applications"])
    dump = json.dumps(body).lower()
    for forbidden in ("score", "probability", "resume", "cover_letter", "screening", "ctc", "analysis", "round_score", "97"):
        assert forbidden not in dump, forbidden


def test_it_only_reads(env, world):
    env.db.log.clear()
    view(env, world.a)
    assert {op for op, _t in env.db.log} == {"select"}
    assert not {t for op, t in env.db.log if op != "select"}


def test_a_college_with_nothing_on_the_platform_gets_an_empty_view(env):
    env.college("col-9", "Empty College")
    h = env.user("tpo-9", "college", profile={"college_id": "col-9"})
    assert view(env, h) == {"drives": [], "students": [], "studentsOnPlatform": 0,
                            "totals": {"applications": 0, "selected": 0, "needsRosterUpdate": 0}}


def test_large_colleges_are_not_cut_off_by_paging_or_by_the_size_of_an_id_filter(env, monkeypatch):
    monkeypatch.setattr(platform, "_PAGE", 25)
    monkeypatch.setattr(platform, "_CHUNK", 7)
    env.college("col-1", "Alpha College")
    h = env.user("tpo-a", "college", profile={"college_id": "col-1"})
    env.db.add("companies", id="c1", name="Acme", owner_id="o")
    env.db.add("jobs", id="j1", company_id="c1", title="SDE", location="x", employment_type="full-time", status="live")
    env.db.add("job_drives", id="d1", job_id="j1", college_id="col-1", status="live", apply_deadline="2030-01-01T00:00:00+00:00")
    for i in range(80):
        env.db.add("students", id=f"s{i}", college_id="col-1", name=f"S{i:02d}", email=f"s{i}@a.edu", branch="CSE", graduation_year=2026,
                   employability_score=0, verification_status="pending", placement_status="not_placed", status="active")
        env.db.add("profiles", id=f"p{i}", email=f"s{i}@a.edu", role="candidate", college_id="col-1")
        env.db.add("applications", id=f"a{i}", student_id=f"p{i}", job_id="j1", company_id="c1", status="applied", applied_at="2029-12-01T00:00:00+00:00")
    body = view(env, h)
    assert body["studentsOnPlatform"] == 80 and len(body["students"]) == 80 and body["totals"]["applications"] == 80
    assert body["drives"][0]["funnel"]["applicants"] == 80


@pytest.mark.parametrize("role", ["candidate", "company", "admin"])
def test_other_roles_and_anonymous_callers_are_refused(env, role):
    h = env.user(f"u-{role}", role, profile={"is_super_admin": True} if role == "admin" else {})
    assert env.client.get(URL, headers=h).status_code == 403
    assert env.client.get(URL).status_code == 401


def test_a_database_failure_is_a_clean_500_not_a_traceback(env, world):
    env.db.fail_tables["select"] = {"applications"}
    r = env.client.get(URL, headers=world.a)
    assert r.status_code == 500 and r.json()["detail"] == "Could not load platform activity."
