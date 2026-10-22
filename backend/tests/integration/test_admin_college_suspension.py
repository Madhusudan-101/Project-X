"""Integration: suspending and reactivating a college (POST /admin/colleges/{id}/suspend | /reactivate).

A suspension is the existing account block applied to every TPO account of the college (see
services/admin/college_lifecycle.py), so the effect — refusal on the very next request — is the same
mechanism that already protects every other blocked account. These tests prove the transitions, the
authorization, the precision of reactivation and the all-or-nothing behaviour; RLS (current_college_id()
ignoring a blocked account) is covered by db/tpo_access_hardening_migration.sql and its SQL test only.
"""
import pytest
from postgrest.exceptions import APIError

from app.services.admin import college_lifecycle as cl
from app.services.admin import permissions

C1 = "c1000000-0000-0000-0000-000000000001"
C2 = "c2000000-0000-0000-0000-000000000002"
GHOST = "c9000000-0000-0000-0000-000000000009"
REASON = {"reason": "Contract dispute with the institution"}


@pytest.fixture(autouse=True)
def _fresh_throttle():
    permissions._DENIED_RECENT.clear()
    yield
    permissions._DENIED_RECENT.clear()


@pytest.fixture
def world(env):
    env.db.add("colleges", id=C1, name="Alpha College", onboarding_completed=True)
    env.db.add("colleges", id=C2, name="Beta College")
    w = type("W", (), {})()
    w.tpo1 = env.user("tpo-1", "college", profile={"college_id": C1})
    w.tpo2 = env.user("tpo-2", "college", profile={"college_id": C1})
    w.tpo_b = env.user("tpo-b", "college", profile={"college_id": C2})
    w.student = env.db.add("students", id="s1", college_id=C1, name="Asha", email="asha@a.edu", branch="CSE", graduation_year=2026,
                           employability_score=1, verification_status="pending", placement_status="not_placed", status="active")
    w.cand = env.user("cand-1", "candidate", profile={"college_id": C1})
    w.sup = env.user("adm-sup", "admin", profile={"is_super_admin": True})
    w.plain = env.user("adm-plain", "admin", profile={"is_super_admin": False})
    return w


def suspend(env, h, college=C1, body=REASON):
    return env.client.post(f"/admin/colleges/{college}/suspend", headers=h, json=body)


def reactivate(env, h, college=C1, body=None):
    return env.client.post(f"/admin/colleges/{college}/reactivate", headers=h, json=body or {})


def profile(env, pid):
    return env.db.one("profiles", id=pid)


def events(env, kind):
    return [e for e in env.db.rows("admin_events") if e["event_type"] == kind]


def grant(env, uid, permission, scope_type="global", scope_id=None, expires_at=None):
    return env.db.add("admin_user_permissions", user_id=uid, permission=permission, scope_type=scope_type,
                      scope_id=scope_id or permissions.GLOBAL_SCOPE_ID, expires_at=expires_at)


# ── authorization ─────────────────────────────────────────────────────

@pytest.mark.parametrize("path", ["suspend", "reactivate"])
def test_only_signed_in_admins_with_the_permission_can_use_either_action(env, world, path):
    url = f"/admin/colleges/{C1}/{path}"
    body = REASON if path == "suspend" else {}
    assert env.client.post(url, json=body).status_code == 401
    for h in (world.cand, world.tpo1, world.tpo_b):               # including the college's OWN TPO
        assert env.client.post(url, headers=h, json=body).status_code == 403
    assert env.client.post(url, headers=world.plain, json=body).status_code == 403       # admin, no grants
    grant(env, "adm-plain", "colleges.view")
    assert env.client.post(url, headers=world.plain, json=body).status_code == 403       # view does not imply suspend
    assert [profile(env, a).get("blocked_permanent") for a in ("tpo-1", "tpo-2")] == [None, None]


def test_a_grant_scoped_to_one_college_works_for_that_college_only(env, world):
    grant(env, "adm-plain", "colleges.suspend", "college", C2)
    assert suspend(env, world.plain, C1).status_code == 403
    assert reactivate(env, world.plain, C1).status_code == 403
    assert suspend(env, world.plain, C2).status_code == 200
    assert profile(env, "tpo-b")["blocked_permanent"] is True and profile(env, "tpo-1").get("blocked_permanent") is None


def test_global_grant_and_super_admin_can_suspend_but_an_expired_grant_cannot(env, world):
    grant(env, "adm-plain", "colleges.suspend", expires_at="2000-01-01T00:00:00+00:00")
    assert suspend(env, world.plain).status_code == 403                     # expired
    env.db.tables["admin_user_permissions"].clear()
    grant(env, "adm-plain", "colleges.suspend")
    assert suspend(env, world.plain).status_code == 200
    assert reactivate(env, world.sup).status_code == 200                    # a super admin may undo it
    assert suspend(env, world.sup).status_code == 200


def test_a_blocked_admin_cannot_suspend_anyone(env, world):
    grant(env, "adm-plain", "colleges.suspend")
    env.db.one("profiles", id="adm-plain")["blocked_permanent"] = True
    assert suspend(env, world.plain).status_code == 403


def test_a_refused_attempt_changes_nothing_and_is_recorded_as_a_denied_request(env, world):
    suspend(env, world.plain)
    assert events(env, "college_suspended") == []
    (denied,) = events(env, "access_denied")
    assert denied["metadata"]["permission"] == "colleges.suspend" and denied["result"] == "failure"


def test_the_permission_is_in_the_catalog_and_can_be_scoped_to_a_college(env, world):
    mods = {m["module"]: m for m in env.client.get("/admin/permissions/catalog", headers=world.plain).json()["modules"]}
    assert "colleges.suspend" in mods["colleges"]["permissions"] and "college" in mods["colleges"]["scopable_as"]


def test_a_super_admin_can_grant_the_permission_for_one_college_and_the_grantee_can_then_use_it(env, world):
    r = env.client.post("/admin/admin-users/adm-plain/permissions", headers=world.sup,
                        json={"permission": "colleges.suspend", "scope_type": "college", "scope_id": C1})
    assert r.status_code == 201, r.text
    assert suspend(env, world.plain, C1).status_code == 200
    assert suspend(env, world.plain, C2).status_code == 403


# ── the transition ────────────────────────────────────────────────────

def test_suspending_blocks_every_tpo_account_permanently_with_the_reason_and_who_did_it(env, world):
    r = suspend(env, world.sup)
    assert r.status_code == 200, r.text
    assert r.json()["accounts_suspended"] == 2
    assert r.json()["suspension"] == {"state": "suspended", "accounts_total": 2, "accounts_suspended": 2, "accounts_active": 0}
    for pid in ("tpo-1", "tpo-2"):
        p = profile(env, pid)
        assert (p["blocked_permanent"], p["blocked_by"], p["blocked_reason"]) == (True, "adm-sup", "College suspended: Contract dispute with the institution")
        assert p["blocked_at"]


def test_the_effect_is_immediate_total_and_confined_to_the_college_tpo_accounts(env, world):
    assert env.client.get("/api/students/", headers=world.tpo1).status_code == 200
    suspend(env, world.sup)
    for h in (world.tpo1, world.tpo2):
        r = env.client.get("/api/students/", headers=h)
        assert r.status_code == 403 and "suspended" in r.json()["detail"]
        assert env.client.get("/api/dashboard/onboarding", headers=h).status_code == 403
        assert env.client.post("/api/students/", headers=h, json={"name": "X", "email": "x@x.edu", "branch": "CSE", "graduationYear": 2026}).status_code == 403
    login = env.client.post("/auth/login", json={"email": "tpo-1@test.dev", "password": "Passw0rd!x", "role": "college"})
    assert login.status_code == 403 and "suspended" in login.json()["detail"]
    # nobody else is affected
    assert env.client.get("/api/students/", headers=world.tpo_b).status_code == 200
    assert profile(env, "cand-1").get("blocked_permanent") is None and profile(env, "adm-sup").get("blocked_permanent") is None


def test_nothing_the_college_owns_is_deleted_or_changed(env, world):
    before = {t: [dict(r) for r in env.db.rows(t)] for t in ("students", "colleges")}
    suspend(env, world.sup)
    reactivate(env, world.sup)
    assert {t: [dict(r) for r in env.db.rows(t)] for t in before} == before


def test_reactivating_restores_exactly_what_the_suspension_took_away(env, world):
    suspend(env, world.sup)
    r = reactivate(env, world.sup, body={"reason": "Dispute resolved"})
    assert r.status_code == 200 and r.json()["suspension"]["state"] == "active" and r.json()["accounts_restored"] == 2
    for pid in ("tpo-1", "tpo-2"):
        p = profile(env, pid)
        assert (p["blocked_permanent"], p["blocked_until"], p["blocked_by"], p["blocked_reason"]) == (False, None, None, None)
    assert env.client.get("/api/students/", headers=world.tpo1).status_code == 200


def test_repeating_a_transition_is_a_conflict_and_changes_nothing(env, world):
    assert reactivate(env, world.sup).status_code == 409                      # not suspended yet
    assert suspend(env, world.sup).status_code == 200
    again = suspend(env, world.sup)
    assert again.status_code == 409 and "already suspended" in again.json()["detail"]
    assert reactivate(env, world.sup).status_code == 200
    assert reactivate(env, world.sup).status_code == 409
    assert suspend(env, world.sup).status_code == 200                          # and it can be suspended again
    assert len(events(env, "college_suspended")) == 2 and len(events(env, "college_reactivated")) == 1


def test_bad_requests_are_refused(env, world):
    assert suspend(env, world.sup, body={}).status_code == 422
    assert suspend(env, world.sup, body={"reason": "   "}).status_code == 422
    assert suspend(env, world.sup, body={"reason": "x" * 451}).status_code == 422
    assert suspend(env, world.sup, college="not-a-uuid").status_code == 422
    assert suspend(env, world.sup, college=GHOST).status_code == 404 and reactivate(env, world.sup, college=GHOST).status_code == 404
    assert reactivate(env, world.sup, body={"reason": "x" * 501}).status_code == 422
    assert profile(env, "tpo-1").get("blocked_permanent") is None


def test_a_college_without_a_tpo_account_cannot_be_suspended(env, world):
    env.db.add("colleges", id=GHOST, name="Directory-only College")
    r = suspend(env, world.sup, college=GHOST)
    assert r.status_code == 409 and "no TPO account" in r.json()["detail"]


# ── precision: other blocks are never touched ───────────────────────────

def test_a_tpo_blocked_for_another_reason_stays_blocked_with_that_reason_through_suspend_and_reactivate(env, world):
    env.db.one("profiles", id="tpo-2").update(blocked_permanent=True, blocked_reason="Shared a password", blocked_by="adm-plain")
    r = suspend(env, world.sup)
    assert r.json()["accounts_suspended"] == 1 and r.json()["suspension"]["state"] == "suspended"
    assert profile(env, "tpo-2")["blocked_reason"] == "Shared a password" and profile(env, "tpo-2")["blocked_by"] == "adm-plain"
    back = reactivate(env, world.sup).json()
    assert back["accounts_restored"] == 1 and back["accounts_left_blocked"] == 1 and back["suspension"]["state"] == "active"
    assert profile(env, "tpo-1")["blocked_permanent"] is False
    assert (profile(env, "tpo-2")["blocked_permanent"], profile(env, "tpo-2")["blocked_reason"]) == (True, "Shared a password")
    assert env.client.get("/api/students/", headers=world.tpo2).status_code == 403


def test_a_college_whose_every_tpo_is_already_blocked_is_not_suspended_twice(env, world):
    for pid in ("tpo-1", "tpo-2"):
        env.db.one("profiles", id=pid).update(blocked_permanent=True, blocked_reason="individually")
    r = suspend(env, world.sup)
    assert r.status_code == 409 and "already blocked" in r.json()["detail"]
    assert reactivate(env, world.sup).status_code == 409


def test_a_temporary_block_that_has_expired_does_not_count_as_blocked(env, world):
    env.db.one("profiles", id="tpo-2").update(blocked_until="2000-01-01T00:00:00+00:00", blocked_reason="old")
    assert suspend(env, world.sup).json()["accounts_suspended"] == 2


def test_an_account_added_after_the_suspension_makes_it_partial_and_suspending_again_completes_it(env, world):
    suspend(env, world.sup)
    env.user("tpo-3", "college", profile={"college_id": C1})
    env.db.rpc_handlers["admin_list_colleges"] = lambda p: [{"college_id": C1, "name": "Alpha College", "total_count": 1}]
    state = env.client.get(f"/admin/colleges/{C1}", headers=world.sup).json()["suspension"]
    assert state == {"state": "partial", "accounts_total": 3, "accounts_suspended": 2, "accounts_active": 1}
    again = suspend(env, world.sup)
    assert again.status_code == 200 and again.json()["accounts_suspended"] == 1 and again.json()["suspension"]["state"] == "suspended"


# ── all-or-nothing ────────────────────────────────────────────────────

def test_a_failure_while_suspending_rolls_back_the_accounts_already_blocked_and_logs_nothing(env, world, monkeypatch):
    real, calls = cl.update_profile, {"n": 0}

    def flaky(pid, payload):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("database went away")
        return real(pid, payload)
    monkeypatch.setattr(cl, "update_profile", flaky)
    r = suspend(env, world.sup)
    assert r.status_code == 500 and "undone" in r.json()["detail"]
    assert [profile(env, a).get("blocked_permanent") for a in ("tpo-1", "tpo-2")] == [False, None] or \
           [bool(profile(env, a).get("blocked_permanent")) for a in ("tpo-1", "tpo-2")] == [False, False]
    assert env.client.get("/api/students/", headers=world.tpo1).status_code == 200
    assert events(env, "college_suspended") == []


def test_a_failure_while_reactivating_restores_what_it_can_says_so_and_a_retry_finishes(env, world, monkeypatch):
    suspend(env, world.sup)
    real, calls = cl.update_profile, {"n": 0}

    def flaky(pid, payload):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("database went away")
        return real(pid, payload)
    monkeypatch.setattr(cl, "update_profile", flaky)
    r = reactivate(env, world.sup)
    assert r.status_code == 500 and "1 of 2" in r.json()["detail"]
    assert events(env, "college_reactivated")[0]["result"] == "failure"
    monkeypatch.setattr(cl, "update_profile", real)
    assert reactivate(env, world.sup).status_code == 200
    assert env.client.get("/api/students/", headers=world.tpo1).status_code == 200 and env.client.get("/api/students/", headers=world.tpo2).status_code == 200


# ── audit & visibility ────────────────────────────────────────────────

def test_both_transitions_are_audited_with_actor_target_outcome_and_no_secrets(env, world):
    suspend(env, world.sup)
    reactivate(env, world.sup, body={"reason": "Resolved"})
    s, a = events(env, "college_suspended")[0], events(env, "college_reactivated")[0]
    assert (s["actor_user_id"], s["actor_role"], s["target_type"], s["target_id"], s["target_label"], s["result"]) == (
        "adm-sup", "admin", "college", C1, "Alpha College", "success")
    assert s["metadata"] == {"accounts_suspended": 2, "accounts_already_blocked": 0, "reason": "Contract dispute with the institution"}
    assert a["metadata"] == {"accounts_restored": 2, "accounts_failed": 0, "accounts_left_blocked": 0, "reason": "Resolved"}
    assert "tpo-1@test.dev" not in str(s) + str(a)


def test_the_college_detail_shows_the_state_the_accounts_the_reason_and_whether_onboarding_finished(env, world):
    env.db.rpc_handlers["admin_list_colleges"] = lambda p: [{"college_id": C1, "name": "Alpha College", "total_count": 1}]
    before = env.client.get(f"/admin/colleges/{C1}", headers=world.sup).json()
    assert before["suspension"]["state"] == "active" and before["onboarding_completed"] is True
    assert [a["is_blocked"] for a in before["accounts"]] == [False, False]
    suspend(env, world.sup)
    after = env.client.get(f"/admin/colleges/{C1}", headers=world.sup).json()
    assert after["suspension"]["state"] == "suspended"
    assert all(a["is_blocked"] and a["blocked_reason"].startswith("College suspended: ") for a in after["accounts"])
    assert set(after["accounts"][0]) == {"id", "email", "name", "created_at", "onboarded", "is_blocked", "blocked_reason"}


def test_onboarding_status_is_unknown_not_no_when_the_onboarding_migration_is_not_applied(env, world, monkeypatch):
    env.db.rpc_handlers["admin_list_colleges"] = lambda p: [{"college_id": C1, "name": "Alpha College", "total_count": 1}]
    # an unreadable column surfaces as an API error; the endpoint must say "unknown" rather than pretend "false"
    from app import deps
    orig = deps.db_client.table

    def table(name):
        q = orig(name)
        real = q.execute

        def execute():
            if name == "colleges" and "onboarding_completed" in str(q._cols):     # only the read of that one column fails
                raise APIError({"message": "column colleges.onboarding_completed does not exist", "code": "42703", "hint": None, "details": None})
            return real()
        q.execute = execute
        return q
    monkeypatch.setattr(deps.db_client, "table", table)
    r = env.client.get(f"/admin/colleges/{C1}", headers=world.sup)
    assert r.status_code == 200 and r.json()["onboarding_completed"] is None
