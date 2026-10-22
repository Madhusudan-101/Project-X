"""Integration: the audit trail (public.admin_events) for College Portal actions and for admin requests
that are refused.

The fake database stores events exactly as log_event writes them; the real table's guarantees (who can
read or change it: no policy for anon/authenticated, service role only) are in
db/admin_portal_migration.sql and are not exercised here. Nothing in this file claims the trail is
tamper-proof — a holder of the service-role key can alter it.
"""
import io
import os
import re
import uuid

import pytest

from app.services.admin import permissions
from app.services.admin.events import EVENT_TYPES

CSV_HEAD = "name,email,branch,graduationYear\n"


@pytest.fixture(autouse=True)
def _fresh_throttle():
    permissions._DENIED_RECENT.clear()
    yield
    permissions._DENIED_RECENT.clear()


@pytest.fixture
def tpo(env):
    env.college("col-1", "Alpha College")
    return env.user("tpo-1", "college", profile={"college_id": "col-1"})


def events(env, event_type=None):
    rows = env.db.rows("admin_events")
    return [r for r in rows if event_type is None or r["event_type"] == event_type]


def only(env, event_type):
    found = events(env, event_type)
    assert len(found) == 1, [(e["event_type"], e["target_type"]) for e in events(env)]
    return found[0]


def add_student(env, tpo, email="ann@x.edu", name="Ann"):
    return env.client.post("/api/students/", headers=tpo, json={
        "name": name, "email": email, "branch": "CSE", "graduationYear": 2026}).json()["student"]


# ── College actions ───────────────────────────────────────────────────

def test_adding_updating_and_deleting_a_student_each_leave_one_event_that_names_the_student_not_the_data(env, tpo):
    s = add_student(env, tpo)
    created = only(env, "student_created")
    assert (created["actor_role"], created["actor_user_id"], created["result"]) == ("college", "tpo-1", "success")
    assert (created["target_type"], created["target_id"], created["target_label"]) == ("student", s["id"], "ann@x.edu")

    env.client.put(f"/api/students/{s['id']}", headers=tpo, json={"name": "Ann K", "placementStatus": "placed"})
    updated = only(env, "student_updated")
    assert updated["metadata"] == {"fields": ["name", "placement_status"]}          # which fields — never the values
    assert "Ann K" not in str(updated) and "placed" not in str(updated["metadata"])

    env.client.delete(f"/api/students/{s['id']}", headers=tpo)
    deleted = only(env, "student_deleted")
    assert deleted["target_id"] == s["id"] and deleted["target_label"] == "ann@x.edu"   # the only record of who it was
    assert env.db.rows("students") == []


def test_refused_or_no_op_requests_leave_no_event(env, tpo):
    s = add_student(env, tpo)
    before = len(events(env))
    env.client.put(f"/api/students/{s['id']}", headers=tpo, json={})                       # nothing to change
    env.client.put("/api/students/missing", headers=tpo, json={"name": "X"})               # not found
    env.client.delete("/api/students/missing", headers=tpo)
    env.client.post("/api/students/", headers=tpo, json={"name": "Bad", "email": "no", "branch": "CSE", "graduationYear": 2026})
    env.client.put("/api/students/bulk-placement-status", headers=tpo, json={"studentIds": ["missing"], "placementStatus": "placed"})
    assert len(events(env)) == before


def test_a_bulk_status_change_is_one_event_with_counts(env, tpo):
    ids = [add_student(env, tpo, f"s{i}@x.edu")["id"] for i in range(3)]
    env.client.put("/api/students/bulk-placement-status", headers=tpo, json={"studentIds": ids + ["nope"], "placementStatus": "placed"})
    event = only(env, "students_placement_updated")
    assert event["target_type"] == "roster" and event["target_id"] == "col-1"
    assert event["metadata"] == {"placement_status": "placed", "updated": 3, "requested": 4}


def test_blocking_restricting_and_unblocking_are_audited_even_when_the_student_has_no_platform_account(env, tpo):
    s = add_student(env, tpo)
    env.client.post(f"/api/students/{s['id']}/block", headers=tpo, json={"duration": "24h", "reason": "private reason"})
    env.client.post(f"/api/students/{s['id']}/restrict", headers=tpo, json={"reason": "another private reason"})
    env.client.post(f"/api/students/{s['id']}/unblock", headers=tpo, json={"reason": "third"})
    found = events(env, "student_access_changed")
    assert [e["metadata"]["status"] for e in found] == ["temporarily_blocked", "restricted", "active"]
    assert all(e["metadata"]["account_restricted"] is False and e["target_id"] == s["id"] for e in found)
    assert "private reason" not in str(found)                       # free-text reasons stay out of the roster events
    assert events(env, "user_blocked") == []                         # no linked account -> no account-level event


def test_blocking_a_student_with_a_platform_account_also_leaves_the_account_level_event(env, tpo):
    s = add_student(env, tpo)
    env.db.add("profiles", id="cand-1", email="ann@x.edu", role="candidate", college_id="col-1")
    env.client.post(f"/api/students/{s['id']}/restrict", headers=tpo, json={"reason": "policy"})
    assert only(env, "student_access_changed")["metadata"]["account_restricted"] is True
    assert only(env, "user_blocked")["target_id"] == "cand-1"


def test_invites_are_audited_with_counts_only(env, tpo, monkeypatch):
    from app import deps
    sent = []
    monkeypatch.setattr(deps.admin_client.auth.admin, "invite_user_by_email", lambda email, opts=None: sent.append(email), raising=False)
    add_student(env, tpo, "a@x.edu", "A")
    add_student(env, tpo, "b@x.edu", "B")
    for row in env.db.tables["students"]:
        row["status"] = "active"      # the database default; the in-memory fake does not apply it
    r = env.client.post("/api/students/onboard", headers=tpo, json={}).json()
    assert r["invited"] == 2 and sorted(sent) == ["a@x.edu", "b@x.edu"]
    event = only(env, "students_invited")
    assert event["metadata"]["invited"] == 2 and event["target_type"] == "roster"
    assert "a@x.edu" not in str(event["metadata"])
    env.client.post("/api/students/onboard", headers=tpo, json={})        # everyone already invited: nothing happened
    assert len(events(env, "students_invited")) == 1


def test_campus_drive_and_department_changes_are_audited(env, tpo):
    d = env.client.post("/api/drives/", headers=tpo, json={"companyName": "Acme", "role": "SDE", "eligibility": {}, "date": "2031-01-01", "status": "Draft"}).json()["drive"]
    env.client.put(f"/api/drives/{d['id']}", headers=tpo, json={"status": "Active"})
    env.client.delete(f"/api/drives/{d['id']}", headers=tpo)
    assert [(e["event_type"], e["target_label"]) for e in events(env) if e["target_type"] == "campus_drive"] == [
        ("campus_drive_created", "Acme"), ("campus_drive_updated", "Acme"), ("campus_drive_deleted", "Acme")]
    assert only(env, "campus_drive_updated")["metadata"] == {"fields": ["status"]}

    dep = env.client.post("/api/departments/", headers=tpo, json={"name": "CSE Dept", "code": "CSE"}).json()["department"]
    env.client.put(f"/api/departments/{dep['id']}", headers=tpo, json={"hodName": "Dr Rao"})
    env.client.delete(f"/api/departments/{dep['id']}", headers=tpo)
    assert [e["event_type"] for e in events(env) if e["target_type"] == "department"] == [
        "department_created", "department_updated", "department_deleted"]
    assert "Dr Rao" not in str(only(env, "department_updated"))


def test_a_csv_import_is_one_event_with_counts_and_a_preview_is_none(env, tpo):
    text = CSV_HEAD + "Ann,ann@x.edu,CSE,2026\nBob,bob@x.edu,IT,2026\n"
    files = lambda: {"file": ("r.csv", io.BytesIO(text.encode()), "text/csv")}
    env.client.post("/api/students/upload?dryRun=true", headers=tpo, files=files())
    assert events(env, "roster_imported") == []
    env.client.post("/api/students/upload", headers=tpo, files=files())
    assert only(env, "roster_imported")["metadata"] == {"created": 2, "updated": 0, "unchanged": 0, "rows_in_file": 2}


def test_logging_can_never_break_the_action_it_describes(env, tpo):
    env.db.fail_tables["insert"] = {"admin_events"}
    r = env.client.post("/api/students/", headers=tpo, json={"name": "Ann", "email": "ann@x.edu", "branch": "CSE", "graduationYear": 2026})
    assert r.status_code == 201 and len(env.db.rows("students")) == 1


# ── Refused admin requests ─────────────────────────────────────────────

@pytest.fixture
def delegated(env):
    return env.user("adm-del", "admin", profile={"is_super_admin": False})


def test_a_delegated_admin_asking_for_something_they_hold_no_grant_for_is_recorded_as_a_failure(env, delegated):
    r = env.client.get("/admin/colleges", headers=delegated)
    assert r.status_code == 403
    event = only(env, "access_denied")
    assert (event["result"], event["actor_role"], event["actor_user_id"], event["target_type"]) == ("failure", "admin", "adm-del", "admin_route")
    assert event["metadata"] == {"permission": "colleges.view", "method": "GET", "path": "/admin/colleges", "reason": "no active grant"}


def test_the_denied_event_never_contains_the_request_body_or_the_query_string_or_the_token(env, delegated):
    token = delegated["Authorization"].split(" ", 1)[1]
    env.client.post("/admin/colleges", headers=delegated, json={"email": "secret@x.edu", "first_name": "S", "last_name": "T", "college_name": "Hidden"})
    env.client.get("/admin/colleges?search=confidential", headers=delegated)
    dump = str(events(env, "access_denied"))
    assert "secret@x.edu" not in dump and "confidential" not in dump and token not in dump


def test_repeated_denials_of_the_same_permission_are_recorded_once_per_minute(env, delegated):
    for _ in range(5):
        env.client.get("/admin/colleges", headers=delegated)
    assert len(events(env, "access_denied")) == 1
    env.client.get("/admin/candidates", headers=delegated)                   # a different permission is a different fact
    assert sorted(e["metadata"]["permission"] for e in events(env, "access_denied")) == ["candidates.view", "colleges.view"]


def test_a_scoped_grant_used_outside_its_scope_and_a_super_admin_only_route_are_recorded(env, delegated):
    allowed, other = str(uuid.uuid4()), str(uuid.uuid4())
    env.db.add("admin_user_permissions", user_id="adm-del", permission="colleges.view", scope_type="college", scope_id=allowed, expires_at=None)
    assert env.client.get(f"/admin/colleges/{other}", headers=delegated).status_code == 403
    assert env.client.post("/admin/admin-users", headers=delegated, json={"email": "x@y.zz", "first_name": "A", "last_name": "B"}).status_code == 403
    found = {e["metadata"]["reason"]: e["metadata"] for e in events(env, "access_denied")}
    assert found["outside the granted scope"]["path"] == f"/admin/colleges/{other}"
    assert found["super admin only"]["permission"] == "super_admin"


def test_a_super_admin_and_a_non_admin_leave_no_denied_events(env):
    sup = env.user("adm-sup", "admin", profile={"is_super_admin": True})
    cand = env.user("cand-1", "candidate")
    env.db.rpc_handlers["admin_list_colleges"] = lambda p: []
    env.client.get("/admin/colleges", headers=sup)
    env.client.get("/admin/colleges", headers=cand)           # refused by the role check: not an admin, nothing to attribute
    assert events(env, "access_denied") == []


# ── Registry hygiene ──────────────────────────────────────────────────

APP = os.path.join(os.path.dirname(__file__), "..", "..", "app")


def test_every_event_type_the_code_emits_is_registered_and_every_registered_type_is_emitted():
    emitted = set()
    for root, _dirs, files in os.walk(APP):
        for name in files:
            if name.endswith(".py"):
                text = open(os.path.join(root, name), encoding="utf-8").read()
                emitted |= set(re.findall(r'(?:log_event|log_college_action)\(\s*"([a-z_]+)"', text))
    assert emitted <= EVENT_TYPES, f"emitted but not registered: {emitted - EVENT_TYPES}"
    assert EVENT_TYPES <= emitted, f"registered but never emitted (the registry must not be aspirational): {EVENT_TYPES - emitted}"


def test_every_event_type_has_a_label_in_the_admin_portal_so_the_audit_log_never_shows_a_raw_code():
    path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "src", "components", "admin", "status.ts")
    if not os.path.exists(path):
        pytest.skip("frontend sources are not next to the backend in this checkout")
    labels = open(path, encoding="utf-8").read()
    missing = sorted(t for t in EVENT_TYPES if not re.search(rf"^\s*{t}:\s*\"", labels, re.M))
    assert missing == []
