"""Integration: who may call the College Portal API, and what one college can never see of another's.

Everything here goes through the real FastAPI app, routers and auth dependencies; only Supabase is
replaced by the in-memory fakes (tests/integration/fakes.py). The fakes do NOT evaluate row-level
security, so these tests prove the application layer (role check from the profile row, college_id from
the authenticated session, per-request user-JWT client, explicit tenant filter). The RLS policies
themselves are only exercised by the SQL tests against a real PostgreSQL (tests/test_college_student_access_sql.py).
"""
import io
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app import deps
from app.main import app

COLLEGE_PREFIXES = ("/api/students", "/api/drives", "/api/departments", "/api/shortlist", "/api/dashboard")
ZERO = "00000000-0000-0000-0000-000000000000"


def college_routes():
    """Every (METHOD, concrete path) the College Portal exposes, discovered from the live app."""
    out = []
    for path, ops in app.openapi()["paths"].items():
        if not path.startswith(COLLEGE_PREFIXES):
            continue
        concrete = path.replace("{student_id}", ZERO).replace("{drive_id}", ZERO).replace("{department_id}", ZERO)
        assert "{" not in concrete, f"unhandled path parameter in {path}"
        out += [(m.upper(), concrete) for m in ops if m.upper() in ("GET", "POST", "PUT", "PATCH", "DELETE")]
    return out


ROUTES = college_routes()


def call(env, method, path, headers=None, **kw):
    if method in ("POST", "PUT", "PATCH") and "files" not in kw and "json" not in kw:
        kw["json"] = {}
    return env.client.request(method, path, headers=headers or {}, **kw)


def csv_file(text="name,email,branch,graduationYear\nA,a@x.com,CSE,2026\n"):
    return {"file": ("r.csv", io.BytesIO(text.encode()), "text/csv")}


@pytest.fixture
def two_colleges(env):
    env.college("col-1", "Alpha College")
    env.college("col-2", "Beta College")
    a = env.user("tpo-a", "college", profile={"college_id": "col-1"})
    b = env.user("tpo-b", "college", profile={"college_id": "col-2"})
    sa = env.db.add("students", id="stu-a", college_id="col-1", name="Asha A", email="asha@a.edu", branch="CSE",
                    graduation_year=2026, employability_score=90, verification_status="verified",
                    placement_status="not_placed", status="active")
    env.db.add("students", id="stu-b", college_id="col-2", name="Bela B", email="bela@b.edu", branch="IT",
               graduation_year=2027, employability_score=40, verification_status="pending",
               placement_status="placed", status="active")
    env.db.add("company_drives", id="drv-a", college_id="col-1", company_name="Acme", role="SDE",
               eligibility={}, drive_date="2030-01-01", status="Active")
    env.db.add("company_drives", id="drv-b", college_id="col-2", company_name="Globex", role="QA",
               eligibility={}, drive_date="2030-02-01", status="Draft")
    env.db.add("departments", id="dep-a", college_id="col-1", name="Computer Science", code="CSE")
    env.db.add("departments", id="dep-b", college_id="col-2", name="Information Technology", code="IT")
    return SimpleNamespace(a=a, b=b, student_a=sa)


# ── who may call ──────────────────────────────────────────────────────

def test_the_route_sweep_actually_covers_the_college_api():
    assert len(ROUTES) >= 25
    assert ("POST", "/api/students/upload") in ROUTES and ("GET", f"/api/drives/{ZERO}/eligible") in ROUTES


@pytest.mark.parametrize("method,path", ROUTES)
def test_no_token_and_a_garbage_token_are_unauthorised_on_every_route(env, method, path):
    assert call(env, method, path).status_code == 401
    assert call(env, method, path, {"Authorization": "Bearer not-a-real-token"}).status_code == 401


@pytest.mark.parametrize("role", ["candidate", "company", "admin"])
def test_every_other_role_is_refused_on_every_college_route(env, role):
    h = env.user(f"u-{role}", role, profile={"is_super_admin": True} if role == "admin" else {})
    refused = {(m, p): call(env, m, p, h).status_code for m, p in ROUTES}
    assert set(refused.values()) == {403}, {k: v for k, v in refused.items() if v != 403}


def test_a_role_claimed_in_the_editable_token_metadata_is_never_trusted(env):
    """user_metadata is writable by the account holder; the role must come from the profiles row."""
    env.college("col-1")
    h = env.user("sneaky", "candidate", meta={"role": "college", "collegeId": "col-1"})
    env.db.tables["profiles"][-1]["college_id"] = "col-1"
    assert {call(env, m, p, h).status_code for m, p in ROUTES} == {403}


def test_a_college_account_that_is_not_linked_to_a_college_is_refused_everywhere(env):
    h = env.user("tpo-x", "college")
    assert {call(env, m, p, h).status_code for m, p in ROUTES} == {403}


@pytest.mark.parametrize("block", [
    {"blocked_permanent": True},
    {"blocked_until": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()},
])
def test_a_blocked_tpo_is_refused_on_every_route_immediately(env, block):
    env.college("col-1")
    h = env.user("tpo-blocked", "college", profile={"college_id": "col-1", **block})
    assert {call(env, m, p, h).status_code for m, p in ROUTES} == {403}


def test_a_temporary_block_that_has_expired_no_longer_applies(env):
    env.college("col-1")
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    h = env.user("tpo-ok", "college", profile={"college_id": "col-1", "blocked_until": past})
    assert env.client.get("/api/students/", headers=h).status_code == 200


# ── the college boundary ─────────────────────────────────────────────

def test_every_college_route_runs_on_the_callers_own_token_so_row_level_security_applies(env, two_colleges, monkeypatch):
    """The tenant data is read through a client bound to the caller's JWT (deps.get_user_supabase), never
    through the service-role client that bypasses RLS."""
    seen = []
    real = deps.create_client

    def spy(*a, **k):
        client = real(*a, **k)
        return SimpleNamespace(table=client.table, rpc=client.rpc,
                               postgrest=SimpleNamespace(auth=lambda token: seen.append(token)))
    monkeypatch.setattr(deps, "create_client", spy)
    via_service_role = []
    service_table = deps.db_client.table
    monkeypatch.setattr(deps.db_client, "table", lambda name: (via_service_role.append(name), service_table(name))[1])
    token_a = two_colleges.a["Authorization"].split(" ", 1)[1]
    for path in ("/api/students/", "/api/drives/", "/api/departments/", "/api/dashboard/stats", "/api/shortlist/export"):
        assert env.client.get(path, headers=two_colleges.a).status_code == 200
    assert seen == [token_a] * 5
    # the service-role client is used for the caller's own profile row (who they are), never for tenant tables
    assert set(via_service_role) == {"profiles"}


def test_one_college_cannot_read_change_or_delete_anything_of_anothers_by_id(env, two_colleges):
    b = two_colleges.b
    before = {t: [dict(r) for r in env.db.rows(t)] for t in ("students", "company_drives", "departments")}
    attempts = [
        ("GET", "/api/students/stu-a", None),
        ("PUT", "/api/students/stu-a", {"name": "Hacked", "placementStatus": "placed"}),
        ("DELETE", "/api/students/stu-a", None),
        ("POST", "/api/students/stu-a/block", {"duration": "24h", "reason": "x"}),
        ("POST", "/api/students/stu-a/restrict", {"reason": "x"}),
        ("POST", "/api/students/stu-a/unblock", {"reason": "x"}),
        ("PUT", "/api/drives/drv-a", {"companyName": "Hacked"}),
        ("DELETE", "/api/drives/drv-a", None),
        ("GET", "/api/drives/drv-a/eligible", None),
        ("GET", "/api/departments/dep-a", None),
        ("PUT", "/api/departments/dep-a", {"name": "Hacked"}),
        ("DELETE", "/api/departments/dep-a", None),
    ]
    for method, path, body in attempts:
        r = env.client.request(method, path, headers=b, **({"json": body} if body is not None else {}))
        assert r.status_code == 404, (method, path, r.status_code, r.text)
    assert {t: [dict(r) for r in env.db.rows(t)] for t in before} == before


def test_bulk_and_invite_actions_ignore_another_colleges_student_ids(env, two_colleges):
    r = env.client.put("/api/students/bulk-placement-status", headers=two_colleges.b,
                       json={"studentIds": ["stu-a"], "placementStatus": "placed"})
    assert r.json()["updatedCount"] == 0
    inv = env.client.post("/api/students/onboard", headers=two_colleges.b, json={"studentIds": ["stu-a"]}).json()
    assert inv["considered"] == 0 and inv["invited"] == 0
    assert env.db.one("students", id="stu-a")["placement_status"] == "not_placed"


def test_lists_exports_shortlists_and_statistics_only_ever_describe_the_callers_own_college(env, two_colleges):
    b = two_colleges.b
    assert [s["email"] for s in env.client.get("/api/students/", headers=b).json()] == ["bela@b.edu"]
    assert [d["companyName"] for d in env.client.get("/api/drives/", headers=b).json()] == ["Globex"]
    assert [d["name"] for d in env.client.get("/api/departments/", headers=b).json()] == ["Information Technology"]
    export = env.client.get("/api/students/export", headers=b).text
    assert "bela@b.edu" in export and "asha@a.edu" not in export
    short = env.client.post("/api/shortlist/filter", headers=b, json={}).json()
    assert short["total"] == 1 and short["students"][0]["email"] == "bela@b.edu"
    assert "asha@a.edu" not in env.client.get("/api/shortlist/export", headers=b).text
    stats = env.client.get("/api/dashboard/stats", headers=b).json()
    assert stats["totalStudents"] == 1 and stats["placedStudents"] == 1 and stats["totalDrives"] == 1
    assert sum(env.client.get("/api/dashboard/score-distribution", headers=b).json().values()) == 1
    assert env.client.get("/api/drives/drv-b/eligible", headers=b).json()["eligibleStudents"][0]["email"] == "bela@b.edu"
    dept = env.client.get("/api/departments/dep-b", headers=b).json()
    assert dept["studentCount"] == 1 and [s["email"] for s in dept["students"]] == ["bela@b.edu"]


def test_a_college_id_supplied_by_the_client_is_ignored_in_queries_and_bodies(env, two_colleges):
    b = two_colleges.b
    assert [s["email"] for s in env.client.get("/api/students/?college_id=col-1", headers=b).json()] == ["bela@b.edu"]
    created = env.client.post("/api/students/", headers=b, json={
        "name": "Zed", "email": "zed@b.edu", "branch": "IT", "graduationYear": 2027, "college_id": "col-1", "collegeId": "col-1"})
    assert created.status_code == 201 and created.json()["student"]["college_id"] == "col-2"
    drive = env.client.post("/api/drives/", headers=b, json={
        "companyName": "Initech", "role": "SDE", "eligibility": {}, "date": "2031-01-01", "status": "Active", "college_id": "col-1"})
    assert drive.status_code == 201
    assert env.db.one("company_drives", company_name="Initech")["college_id"] == "col-2"
    dep = env.client.post("/api/departments/", headers=b, json={"name": "Mechanical", "code": "ME", "college_id": "col-1"})
    assert dep.status_code == 201 and env.db.one("departments", name="Mechanical")["college_id"] == "col-2"
    upd = env.client.put("/api/students/stu-b", headers=b, json={"name": "Bela Two", "college_id": "col-1"})
    assert upd.status_code == 200 and env.db.one("students", id="stu-b")["college_id"] == "col-2"


def test_two_colleges_may_hold_the_same_email_and_each_sees_only_its_own_record(env, two_colleges):
    for h, name in ((two_colleges.a, "Shared A"), (two_colleges.b, "Shared B")):
        assert env.client.post("/api/students/", headers=h, json={
            "name": name, "email": "shared@x.edu", "branch": "CSE", "graduationYear": 2026}).status_code == 201
    assert [s["name"] for s in env.client.get("/api/students/?graduationYear=2026", headers=two_colleges.b).json()
            if s["email"] == "shared@x.edu"] == ["Shared B"]


def test_blocking_a_student_of_one_college_never_touches_a_same_email_account_of_another(env, two_colleges):
    """The block is mirrored onto a candidate account only when that account belongs to the SAME college."""
    env.db.add("profiles", id="cand-b", email="asha@a.edu", role="candidate", college_id="col-2")
    r = env.client.post("/api/students/stu-a/block", headers=two_colleges.a, json={"duration": "24h", "reason": "x"})
    assert r.status_code == 200 and r.json()["accountRestricted"] is False
    assert not env.db.one("profiles", id="cand-b").get("blocked_until")


def test_the_college_api_never_serves_platform_or_admin_data(env, two_colleges):
    assert env.client.get("/admin/overview", headers=two_colleges.a).status_code == 403
    assert env.client.get("/admin/colleges", headers=two_colleges.a).status_code == 403
    assert env.client.get("/admin/me", headers=two_colleges.a).status_code == 403
