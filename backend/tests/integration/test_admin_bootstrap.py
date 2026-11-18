"""The predefined Admin and Super Admin logins (services/admin/bootstrap.py), created when
the API starts. Each `start()` runs the app's real lifespan, as uvicorn does; calling it
twice is a server restart. Sign-ins go through the real /auth/login route against the
fake Supabase, which stores a supplied bcrypt hash and checks sign-ins against it."""
import logging

import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from app import deps
from app.main import app
from app.services.admin.permissions import ALL_PERMISSIONS

ADMIN_EMAIL, ADMIN_PASSWORD = "Admin@gmail.com", "@dm!n"
SUPER_EMAIL, SUPER_PASSWORD = "SAdmin@gmail.com", "$@dm!n"
VARS = {
    "BOOTSTRAP_ADMIN_EMAIL": ADMIN_EMAIL, "BOOTSTRAP_ADMIN_PASSWORD": ADMIN_PASSWORD,
    "BOOTSTRAP_SUPER_ADMIN_EMAIL": SUPER_EMAIL, "BOOTSTRAP_SUPER_ADMIN_PASSWORD": SUPER_PASSWORD,
}


@pytest.fixture
def world(env, monkeypatch):
    monkeypatch.setattr(deps.admin_client.auth.admin, "create_user", env.auth.create_user)
    env.db.tables.setdefault("admin_user_permissions", [])
    for name, value in VARS.items():
        monkeypatch.setenv(name, value)
    return env


def start():
    """One server start: the lifespan runs on enter, as under uvicorn."""
    with TestClient(app):
        pass


def login(env, email, password, role="admin"):
    return env.client.post("/auth/login", json={"email": email, "password": password, "role": role})


def bearer(env, email, password):
    r = login(env, email, password)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def profile(env, email):
    return next((p for p in env.db.tables.get("profiles", []) if p["email"] == email.lower()), None)


# ── sign-in and portal routing ──────────────────────────────────────────

def test_admin_credentials_open_the_admin_portal(world):
    start()
    r = login(world, ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 200
    user = r.json()["user"]
    assert (user["role"], user["portal"], user["onboarded"]) == ("admin", "admin", True)
    me = world.client.get("/admin/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).json()
    assert me["is_super_admin"] is False


def test_super_admin_credentials_open_the_super_admin_portal(world):
    start()
    r = login(world, SUPER_EMAIL, SUPER_PASSWORD)
    assert r.status_code == 200
    user = r.json()["user"]
    assert (user["role"], user["portal"], user["onboarded"]) == ("admin", "super_admin", True)
    me = world.client.get("/admin/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).json()
    assert me["is_super_admin"] is True


def test_the_email_is_not_case_sensitive(world):
    start()
    assert login(world, "admin@GMAIL.com", ADMIN_PASSWORD).status_code == 200
    assert login(world, "sadmin@gmail.com", SUPER_PASSWORD).status_code == 200


@pytest.mark.parametrize("email,password", [
    (ADMIN_EMAIL, "@dm!n "), (ADMIN_EMAIL, "@DM!N"), (ADMIN_EMAIL, SUPER_PASSWORD),
    (SUPER_EMAIL, ADMIN_PASSWORD), (SUPER_EMAIL, "$@dm!"), ("nobody@gmail.com", ADMIN_PASSWORD),
])
def test_incorrect_credentials_are_rejected_with_one_message(world, email, password):
    start()
    r = login(world, email, password)
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid email or password."
    assert "token" not in r.json()


def test_the_accounts_cannot_sign_in_at_another_portal(world):
    start()
    for role in ("candidate", "company", "college"):
        assert login(world, ADMIN_EMAIL, ADMIN_PASSWORD, role).status_code == 403
        assert login(world, SUPER_EMAIL, SUPER_PASSWORD, role).status_code == 403


# ── backend authorization ───────────────────────────────────────────────

SUPER_ADMIN_ONLY = [
    ("post", "/admin/admin-users", {"email": "new@test.dev", "first_name": "N", "last_name": "A"}),
    ("post", "/admin/admin-users/{admin}/permissions", {"permission": "colleges.view"}),
    ("post", "/admin/admin-users/{admin}/permissions/some-grant/revoke", None),
    ("post", "/admin/admin-users/{admin}/permissions/revoke-all", None),
]


@pytest.mark.parametrize("method,path,body", SUPER_ADMIN_ONLY)
def test_admin_cannot_call_super_admin_apis(world, method, path, body):
    start()
    h = bearer(world, ADMIN_EMAIL, ADMIN_PASSWORD)
    url = path.format(admin=profile(world, ADMIN_EMAIL)["id"])
    r = getattr(world.client, method)(url, headers=h, **({"json": body} if body is not None else {}))
    assert r.status_code == 403
    assert r.json()["detail"] == "Super Admin access required."


def test_super_admin_can_manage_admins(world):
    start()
    h = bearer(world, SUPER_EMAIL, SUPER_PASSWORD)
    r = world.client.post("/admin/admin-users", headers=h,
                          json={"email": "delegate@test.dev", "first_name": "Dee", "last_name": "Legate"})
    assert r.status_code == 201
    delegate = profile(world, "delegate@test.dev")["id"]
    r = world.client.post(f"/admin/admin-users/{delegate}/permissions", headers=h, json={"permission": "colleges.view"})
    assert r.status_code == 201


def test_admin_can_use_the_admin_portal(world):
    start()
    h = bearer(world, ADMIN_EMAIL, ADMIN_PASSWORD)
    held = {g["permission"] for g in world.db.tables["admin_user_permissions"] if g["user_id"] == profile(world, ADMIN_EMAIL)["id"]}
    assert held == set(ALL_PERMISSIONS)
    assert world.client.get("/admin/colleges", headers=h).status_code == 200


@pytest.mark.parametrize("path", ["/admin/me", "/admin/colleges", "/admin/admin-users/x/permissions"])
def test_no_or_forged_token_is_refused(world, path):
    start()
    assert world.client.get(path).status_code == 401
    assert world.client.get(path, headers={"Authorization": "Bearer forged"}).status_code == 401


def test_a_candidate_token_is_refused_on_admin_apis(world):
    start()
    h = world.user("cand-1", "candidate")
    assert world.client.get("/admin/me", headers=h).status_code == 403
    assert world.client.post("/admin/admin-users", headers=h, json={}).status_code == 403


# ── restarts ────────────────────────────────────────────────────────────

def test_a_restart_creates_nothing_twice_and_both_logins_still_work(world):
    start()
    counts = (len(world.auth.users), len(world.db.tables["profiles"]), len(world.db.tables["admin_user_permissions"]))
    start()
    start()
    assert (len(world.auth.users), len(world.db.tables["profiles"]), len(world.db.tables["admin_user_permissions"])) == counts
    assert sum(p["email"] == "admin@gmail.com" for p in world.db.tables["profiles"]) == 1
    assert sum(p["email"] == "sadmin@gmail.com" for p in world.db.tables["profiles"]) == 1
    assert login(world, ADMIN_EMAIL, ADMIN_PASSWORD).json()["user"]["portal"] == "admin"
    assert login(world, SUPER_EMAIL, SUPER_PASSWORD).json()["user"]["portal"] == "super_admin"


def test_a_restart_keeps_a_changed_password(world, monkeypatch):
    start()
    uid = profile(world, ADMIN_EMAIL)["id"]
    world.auth.update_user_by_id(uid, {"password": "a-new-longer-password"})
    start()
    assert login(world, ADMIN_EMAIL, "a-new-longer-password").status_code == 200
    assert login(world, ADMIN_EMAIL, ADMIN_PASSWORD).status_code == 401


def test_a_restart_keeps_grants_a_super_admin_revoked(world):
    start()
    h = bearer(world, SUPER_EMAIL, SUPER_PASSWORD)
    admin_id = profile(world, ADMIN_EMAIL)["id"]
    assert world.client.post(f"/admin/admin-users/{admin_id}/permissions/revoke-all", headers=h).status_code == 200
    start()
    assert not [g for g in world.db.tables["admin_user_permissions"] if g["user_id"] == admin_id and not g.get("revoked_at")]


def test_a_restart_keeps_a_block(world):
    start()
    p = profile(world, ADMIN_EMAIL)
    p["blocked_permanent"] = True
    start()
    assert profile(world, ADMIN_EMAIL)["blocked_permanent"] is True
    assert login(world, ADMIN_EMAIL, ADMIN_PASSWORD).status_code == 403


# ── secrets ─────────────────────────────────────────────────────────────

def test_only_a_bcrypt_hash_is_stored_and_no_password_is_logged_or_returned(world, caplog):
    caplog.set_level(logging.DEBUG)
    start()
    for email, password in ((ADMIN_EMAIL, ADMIN_PASSWORD), (SUPER_EMAIL, SUPER_PASSWORD)):
        user = world.auth.users[profile(world, email)["id"]]
        assert user["password"] is None
        assert user["password_hash"].startswith("$2a$12$")
        assert password not in user["password_hash"]
        body = login(world, email, password).text
        assert password not in body
        assert "password" not in body.lower()
    for password in (ADMIN_PASSWORD, SUPER_PASSWORD):
        assert password not in caplog.text
        assert password not in str(world.db.tables)
    assert "BOOTSTRAP_ADMIN_PASSWORD is shorter than 8 characters" in caplog.text


# ── what it refuses to do ───────────────────────────────────────────────

def test_an_existing_non_admin_account_is_never_promoted_and_the_api_still_starts(world, caplog):
    world.user("cand-1", "candidate", email="admin@gmail.com")
    start()
    assert profile(world, ADMIN_EMAIL)["role"] == "candidate"
    assert "already belongs to a candidate account" in caplog.text
    assert world.client.get("/admin/me").status_code == 401  # the app is serving


def test_missing_migrations_are_named_and_nothing_is_created(world, monkeypatch, caplog):
    real_table = world.db.table

    def table(name):
        if name == "admin_user_permissions":
            raise APIError({"message": "relation does not exist", "code": "42P01"})
        return real_table(name)

    monkeypatch.setattr(deps.db_client, "table", table)
    start()
    assert "admin_permissions_migration.sql" in caplog.text
    assert world.db.tables.get("profiles", []) == []


def test_a_supabase_outage_does_not_stop_the_api(world, monkeypatch, caplog):
    def down(*a, **k):
        raise ConnectionError("unreachable")

    monkeypatch.setattr(deps.admin_client.auth.admin, "create_user", down)
    start()
    assert "Predefined admin accounts were not set up" in caplog.text


def test_nothing_happens_without_the_variables(world, monkeypatch):
    for name in VARS:
        monkeypatch.delenv(name)
    start()
    assert world.db.tables.get("profiles", []) == []


def test_half_a_pair_is_reported(world, monkeypatch, caplog):
    monkeypatch.delenv("BOOTSTRAP_ADMIN_PASSWORD")
    start()
    assert "BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set together" in caplog.text
    assert world.db.tables.get("profiles", []) == []


def test_one_address_for_both_is_refused(world, monkeypatch, caplog):
    monkeypatch.setenv("BOOTSTRAP_SUPER_ADMIN_EMAIL", "admin@GMAIL.com")
    start()
    assert "different email addresses" in caplog.text
    assert world.db.tables.get("profiles", []) == []


def test_supabase_would_have_refused_the_plaintext(world):
    """Why the hash is sent: Supabase Auth refuses a plaintext password under 6
    characters on its admin API, whatever the project setting."""
    from supabase_auth.errors import AuthApiError
    with pytest.raises(AuthApiError, match="at least 6"):
        world.auth.create_user({"email": "x@test.dev", "password": ADMIN_PASSWORD, "email_confirm": True})
