"""Admin / Super Admin sign-in, portal routing and authorization.

The sweeps walk the real route table, so a new /admin endpoint is covered the
moment it exists: forgetting its permission check fails a test here.
"""
import re

import pytest
from postgrest.exceptions import APIError

from app import deps
from app.main import app
from app.routers.shared import auth as auth_router
from app.services.admin.permissions import ALL_PERMISSIONS, GLOBAL_SCOPE_ID

PW = "Passw0rd!x"
SOME_ID = "11111111-1111-1111-1111-111111111111"

# Answer for any admin at all: identity and reference data, or counts reviewed in
# overview.py. Each still needs a valid Admin session, which the first sweep proves.
OPEN_TO_EVERY_ADMIN = {
    ("GET", "/admin/me"), ("GET", "/admin/permissions/catalog"), ("GET", "/admin/overview"), ("GET", "/admin/search"),
}
SUPER_ADMIN_ONLY = {
    ("POST", "/admin/admin-users"),
    ("POST", "/admin/admin-users/{id}/permissions"),
    ("POST", "/admin/admin-users/{id}/permissions/{id}/revoke"),
    ("POST", "/admin/admin-users/{id}/permissions/revoke-all"),
}


def admin_routes():
    routes = []
    for path, ops in app.openapi()["paths"].items():
        if path.startswith("/admin"):
            routes += [(method.upper(), re.sub(r"\{[^}]+\}", "{id}", path)) for method in ops]
    assert len(routes) > 30, "the route table should list the whole Admin API"
    return sorted(routes)


def call(env, method, path, headers=None):
    return env.client.request(method, path.replace("{id}", SOME_ID), headers=headers or {}, json={})


def login(env, email, password=PW, role="admin"):
    return env.client.post("/auth/login", json={"email": email, "password": password, "role": role})


@pytest.fixture
def people(env):
    env.h = {
        "super": env.user("super-1", "admin", email="super@test.dev", profile={"is_super_admin": True, "first_name": "Sue", "onboarded": True}),
        "admin": env.user("admin-1", "admin", email="admin@test.dev", profile={"is_super_admin": False, "first_name": "Al", "onboarded": True}),
        "candidate": env.user("cand-1", "candidate", email="cand@test.dev"),
        "company": env.user("hr-1", "company", email="hr@test.dev"),
        "college": env.user("tpo-1", "college", email="tpo@test.dev", profile={"college_id": "col-1"}),
    }
    return env


def grant(env, user_id, *permissions):
    for permission in permissions:
        env.db.add("admin_user_permissions", user_id=user_id, permission=permission,
                   scope_type="global", scope_id=GLOBAL_SCOPE_ID, expires_at=None)


# ── One sign-in page, two portals ────────────────────────────────────

def test_admin_is_routed_to_the_admin_portal(people):
    r = login(people, "admin@test.dev")
    assert r.status_code == 200 and r.json()["user"]["portal"] == "admin"


def test_super_admin_uses_the_same_login_and_is_routed_to_the_super_admin_portal(people):
    r = login(people, "super@test.dev")
    assert r.status_code == 200 and r.json()["user"]["portal"] == "super_admin"


def test_the_portal_comes_from_the_profile_on_refresh_too(people):
    refresh = login(people, "super@test.dev").json()["refreshToken"]
    r = people.client.post("/auth/refresh", json={"refreshToken": refresh})
    assert r.status_code == 200 and r.json()["user"]["portal"] == "super_admin"


def test_is_super_admin_on_a_non_admin_profile_means_nothing(env):
    env.user("odd-1", "candidate", email="odd@test.dev", profile={"is_super_admin": True})
    r = login(env, "odd@test.dev", role="candidate")
    assert r.status_code == 200 and r.json()["user"]["portal"] == "candidate"


# ── Invalid credentials ──────────────────────────────────────────────

def test_a_failed_admin_login_never_says_which_half_was_wrong(people):
    wrong_password = login(people, "admin@test.dev", "not-the-password")
    unknown_email = login(people, "nobody@test.dev")
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json() == {"detail": "Invalid email or password."}


def test_an_unconfirmed_admin_address_looks_like_any_other_failure(people):
    people.auth.users["admin-1"]["confirmed"] = False
    r = login(people, "admin@test.dev")
    assert r.status_code == 401 and r.json() == {"detail": "Invalid email or password."}


def test_signup_does_not_confirm_that_an_address_is_an_admin(people):
    r = people.client.post("/auth/signup", json={"email": "super@test.dev", "password": PW, "role": "candidate"})
    assert r.status_code == 409
    assert "admin" not in r.json()["detail"].lower()


# ── Unauthorized roles ───────────────────────────────────────────────

@pytest.mark.parametrize("email", ["cand@test.dev", "hr@test.dev", "tpo@test.dev"])
def test_other_roles_cannot_sign_in_at_the_admin_portal(people, email):
    r = login(people, email)
    assert r.status_code == 403
    assert r.json() == {"detail": "This account does not have access to the Admin Portal."}


def test_an_account_with_no_profile_cannot_sign_in_at_the_admin_portal(env):
    env.auth.add_user("ghost-1", "ghost@test.dev", PW, {"role": "admin"})
    assert login(env, "ghost@test.dev").status_code == 403
    assert env.db.tables.get("profiles", []) == []


def test_a_blocked_admin_cannot_sign_in(people):
    people.db.tables["profiles"][1]["blocked_permanent"] = True
    r = login(people, "admin@test.dev")
    assert r.status_code == 403 and "suspended" in r.json()["detail"]


# ── Every protected route, every kind of caller ──────────────────────

@pytest.mark.parametrize("method,path", admin_routes())
def test_no_token_is_refused(env, method, path):
    assert call(env, method, path).status_code == 401


@pytest.mark.parametrize("method,path", admin_routes())
def test_a_forged_token_is_refused(env, method, path):
    assert call(env, method, path, {"Authorization": "Bearer eyJhbGciOiJub25lIn0.e30."}).status_code == 401


@pytest.mark.parametrize("method,path", admin_routes())
@pytest.mark.parametrize("who", ["candidate", "company", "college"])
def test_other_roles_are_refused_everywhere(people, who, method, path):
    assert call(people, method, path, people.h[who]).status_code == 403


@pytest.mark.parametrize("method,path", admin_routes())
def test_an_admin_with_no_grants_reaches_only_the_open_routes(people, method, path):
    status = call(people, method, path, people.h["admin"]).status_code
    if (method, path) in OPEN_TO_EVERY_ADMIN:
        assert status != 403
    elif path == "/admin/admin-users/{id}/permissions" and method == "GET":
        assert status == 403  # someone else's; their own is checked below
    else:
        assert status == 403, f"{method} {path} is reachable without a permission"


@pytest.mark.parametrize("method,path", sorted(SUPER_ADMIN_ONLY))
def test_super_admin_routes_stay_closed_with_every_grant_held(people, method, path):
    grant(people, "admin-1", *ALL_PERMISSIONS)
    r = call(people, method, path, people.h["admin"])
    assert r.status_code == 403 and r.json()["detail"] == "Super Admin access required."


def test_a_role_in_token_metadata_grants_nothing(env):
    # user_metadata is editable by the account holder, so this is what a forged claim looks like.
    h = env.user("cand-9", "candidate", meta={"role": "admin", "is_super_admin": True, "portal": "super_admin"})
    assert env.client.get("/admin/me", headers=h).status_code == 403
    assert env.client.get("/admin/users", headers=h).status_code == 403


# ── What /admin/me reports is what the portal guard trusts ───────────

def test_admin_me_reports_the_database_flag(people):
    assert people.client.get("/admin/me", headers=people.h["super"]).json()["is_super_admin"] is True
    assert people.client.get("/admin/me", headers=people.h["admin"]).json()["is_super_admin"] is False


def test_losing_super_admin_applies_to_the_very_next_request(people):
    assert people.client.post("/admin/admin-users", headers=people.h["super"], json={}).status_code == 422
    people.db.tables["profiles"][0]["is_super_admin"] = False
    assert people.client.get("/admin/me", headers=people.h["super"]).json()["is_super_admin"] is False
    assert people.client.post("/admin/admin-users", headers=people.h["super"], json={}).status_code == 403


def test_a_block_applies_to_the_very_next_request(people):
    assert people.client.get("/admin/me", headers=people.h["admin"]).status_code == 200
    people.db.tables["profiles"][1]["blocked_permanent"] = True
    assert people.client.get("/admin/me", headers=people.h["admin"]).status_code == 403


def test_an_admin_route_still_sees_a_block_when_the_earlier_lookup_fails_open(people, monkeypatch):
    people.db.tables["profiles"][1]["blocked_permanent"] = True
    real_table, calls = deps.db_client.table, {"n": 0}

    def first_lookup_fails(name):
        calls["n"] += 1
        if calls["n"] == 1:
            raise APIError({"message": "timeout", "code": "57014"})
        return real_table(name)

    monkeypatch.setattr(deps.db_client, "table", first_lookup_fails)
    assert people.client.get("/admin/me", headers=people.h["admin"]).status_code == 403


def test_a_missing_migration_is_named_not_reported_as_a_permissions_problem(people, monkeypatch):
    real_table = deps.db_client.table

    def no_column(name):
        query = real_table(name)
        real_select = query.select

        def select(columns="*", **kw):
            if "is_super_admin" in columns:
                raise APIError({"message": "column profiles.is_super_admin does not exist", "code": "42703"})
            return real_select(columns, **kw)

        query.select = select
        return query

    monkeypatch.setattr(deps.db_client, "table", no_column)
    r = people.client.get("/admin/me", headers=people.h["super"])
    assert r.status_code == 503 and "is_super_admin" in r.json()["detail"]


# ── Privilege escalation ─────────────────────────────────────────────

@pytest.mark.parametrize("role", ["admin", "college"])
def test_signup_cannot_create_a_provisioned_role(env, role):
    r = env.client.post("/auth/signup", json={"email": "x@test.dev", "password": PW, "role": role})
    assert r.status_code == 403


def test_profile_update_cannot_change_role_or_super_admin(people):
    r = people.client.patch("/auth/profile", headers=people.h["admin"],
                            json={"role": "admin", "is_super_admin": True, "isSuperAdmin": True, "portal": "super_admin", "name": "A"})
    assert r.status_code == 200 and r.json()["portal"] == "admin"
    row = next(p for p in people.db.tables["profiles"] if p["id"] == "admin-1")
    assert row["is_super_admin"] is False


def test_profile_update_cannot_turn_a_candidate_into_an_admin(people):
    people.client.patch("/auth/profile", headers=people.h["candidate"], json={"role": "admin", "name": "C"})
    assert people.client.get("/admin/me", headers=people.h["candidate"]).status_code == 403


@pytest.mark.parametrize("action,body", [("block", {"permanent": True, "reason": "x"}), ("unblock", {})])
@pytest.mark.parametrize("target", ["super-1", "admin-2"])
def test_a_delegated_admin_cannot_block_or_unblock_any_admin(people, action, body, target):
    people.user("admin-2", "admin", email="peer@test.dev", profile={"is_super_admin": False})
    grant(people, "admin-1", "users.block", "users.unblock")
    r = people.client.post(f"/admin/users/{target}/{action}", headers=people.h["admin"], json=body)
    assert r.status_code == 403


def test_a_delegated_admin_can_still_block_an_ordinary_user(people):
    grant(people, "admin-1", "users.block")
    r = people.client.post("/admin/users/cand-1/block", headers=people.h["admin"], json={"permanent": True, "reason": "abuse"})
    assert r.status_code == 200


def test_a_super_admin_can_disable_and_re_enable_a_delegated_admin(people):
    people.user("admin-2", "admin", email="peer@test.dev", profile={"is_super_admin": False})
    body = {"permanent": True, "reason": "left the team"}
    assert people.client.post("/admin/users/admin-2/block", headers=people.h["super"], json=body).status_code == 200
    assert people.client.post("/admin/users/admin-2/unblock", headers=people.h["super"], json={}).status_code == 200


def test_a_new_delegated_admin_from_the_portal_is_never_a_super_admin(people, monkeypatch):
    monkeypatch.setattr(deps.admin_client.auth.admin, "create_user", people.auth.create_user)
    r = people.client.post("/admin/admin-users", headers=people.h["super"], json={
        "email": "new@test.dev", "first_name": "New", "last_name": "Admin", "is_super_admin": True,
    })
    assert r.status_code == 201
    row = next(p for p in people.db.tables["profiles"] if p["email"] == "new@test.dev")
    assert not row.get("is_super_admin")


# ── Logout ───────────────────────────────────────────────────────────

def test_logout_revokes_the_session_on_the_server(people):
    session = login(people, "super@test.dev").json()
    headers = {"Authorization": f"Bearer {session['token']}"}
    assert people.client.get("/admin/me", headers=headers).status_code == 200

    assert people.client.post("/auth/logout", headers=headers).json() == {"ok": True}

    assert people.client.get("/admin/me", headers=headers).status_code == 401
    assert people.client.post("/auth/refresh", json={"refreshToken": session["refreshToken"]}).status_code == 401


def test_logout_leaves_other_sessions_of_the_same_account_alone(people):
    first, second = login(people, "admin@test.dev").json(), login(people, "admin@test.dev").json()
    people.client.post("/auth/logout", headers={"Authorization": f"Bearer {first['token']}"})
    assert people.client.get("/admin/me", headers={"Authorization": f"Bearer {second['token']}"}).status_code == 200


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer already-dead"}, {"Authorization": "nonsense"}])
def test_logout_always_answers_ok(env, headers):
    r = env.client.post("/auth/logout", headers=headers)
    assert r.status_code == 200 and r.json() == {"ok": True}


def test_logout_answers_ok_even_if_supabase_is_down(people, monkeypatch):
    def boom(*a, **k):
        raise ConnectionError("supabase unreachable")

    monkeypatch.setattr(deps.admin_client.auth.admin, "sign_out", boom)
    assert auth_router.logout("Bearer anything") == {"ok": True}
