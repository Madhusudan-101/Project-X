"""seed_admin_accounts.py against the fake Supabase: what it creates, what it refuses to
touch, and that a rerun changes nothing."""
import argparse
import os
import sys

import pytest
from postgrest.exceptions import APIError

from app import deps
from app.services.admin.permissions import ALL_PERMISSIONS

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
import seed_admin_accounts as seed_script  # noqa: E402

PROJECT = "example"  # conftest points SUPABASE_URL at example.supabase.co


@pytest.fixture
def world(env, monkeypatch, tmp_path):
    monkeypatch.setattr(deps.admin_client.auth.admin, "create_user", env.auth.create_user)
    monkeypatch.setattr(seed_script, "CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setattr(seed_script, "SUPABASE_URL", f"https://{PROJECT}.supabase.co")
    for var in ("SEED_ADMIN_PASSWORD", "SEED_SUPER_ADMIN_PASSWORD"):
        monkeypatch.delenv(var, raising=False)
    env.db.tables.setdefault("admin_user_permissions", [])
    return env


def run(project=PROJECT, admin="admin@test.dev", super_admin="super@test.dev", reset=False):
    seed_script.seed(argparse.Namespace(project=project, admin_email=admin, super_admin_email=super_admin, reset_passwords=reset))


def profile(env, email):
    return next((p for p in env.db.tables.get("profiles", []) if p["email"] == email), None)


def saved_password(label):
    for line in open(seed_script.CREDENTIALS_FILE, encoding="utf-8"):
        if line.startswith(f"{label}:"):
            return line.rsplit(" / ", 1)[1].strip()
    raise AssertionError(f"{label} not in credentials file")


def test_creates_both_accounts_with_the_right_roles(world):
    run()
    assert profile(world, "super@test.dev")["role"] == "admin"
    assert profile(world, "super@test.dev")["is_super_admin"] is True
    assert profile(world, "admin@test.dev")["role"] == "admin"
    assert not profile(world, "admin@test.dev").get("is_super_admin")


def test_both_logins_work_through_the_real_login_route(world):
    run()
    r = world.client.post("/auth/login", json={"email": "super@test.dev", "password": saved_password("Super Admin"), "role": "admin"})
    assert r.status_code == 200 and r.json()["user"]["portal"] == "super_admin"
    r = world.client.post("/auth/login", json={"email": "admin@test.dev", "password": saved_password("Admin"), "role": "admin"})
    assert r.status_code == 200 and r.json()["user"]["portal"] == "admin"


def test_the_admin_can_use_the_portal_but_not_manage_admins(world):
    run()
    grants = {g["permission"] for g in world.db.tables["admin_user_permissions"]}
    assert grants == set(ALL_PERMISSIONS)
    token = world.client.post("/auth/login", json={
        "email": "admin@test.dev", "password": saved_password("Admin"), "role": "admin"}).json()["token"]
    r = world.client.post("/admin/admin-users", headers={"Authorization": f"Bearer {token}"}, json={})
    assert r.status_code == 403


def test_passwords_stay_off_the_terminal_and_out_of_the_profile_rows(world, capsys):
    run()
    out = capsys.readouterr().out
    for label in ("Admin", "Super Admin"):
        password = saved_password(label)
        assert len(password) >= 20
        assert password not in out
        assert password not in str(world.db.tables["profiles"])


def test_a_rerun_changes_nothing(world):
    run()
    first = saved_password("Admin")
    profiles, grants = len(world.db.tables["profiles"]), len(world.db.tables["admin_user_permissions"])
    run()
    assert len(world.db.tables["profiles"]) == profiles
    assert len(world.db.tables["admin_user_permissions"]) == grants
    assert saved_password("Admin") == first
    uid = profile(world, "admin@test.dev")["id"]
    assert world.auth.users[uid]["password"] == first


def test_reset_passwords_replaces_them(world, monkeypatch):
    monkeypatch.setattr(deps.admin_client.auth.admin, "update_user_by_id", world.auth.update_user_by_id)
    run()
    before = saved_password("Admin")
    run(reset=True)
    after = saved_password("Admin")
    assert before != after
    assert world.auth.users[profile(world, "admin@test.dev")["id"]]["password"] == after


def test_an_existing_non_admin_account_is_never_promoted(world):
    world.user("cand-1", "candidate", email="cand@test.dev")
    with pytest.raises(seed_script.SeedError, match="already belongs to a candidate"):
        run(admin="cand@test.dev")
    assert profile(world, "cand@test.dev")["role"] == "candidate"


def test_the_flag_is_brought_back_in_line_on_an_existing_admin(world):
    world.user("adm-1", "admin", email="super@test.dev", profile={"is_super_admin": False})
    run()
    assert profile(world, "super@test.dev")["is_super_admin"] is True


def test_refuses_a_project_other_than_the_configured_one(world):
    with pytest.raises(seed_script.SeedError, match="does not match SUPABASE_URL"):
        run(project="some-other-project")
    assert world.db.tables.get("profiles", []) == []


def test_refuses_one_address_for_both_roles(world):
    with pytest.raises(seed_script.SeedError, match="different email"):
        run(admin="Same@test.dev", super_admin="same@test.dev")


def test_a_short_chosen_password_is_refused(world, monkeypatch):
    monkeypatch.setenv("SEED_ADMIN_PASSWORD", "short")
    with pytest.raises(seed_script.SeedError, match="SEED_ADMIN_PASSWORD"):
        run()
    assert world.db.tables.get("profiles", []) == []


def test_a_database_without_the_migrations_is_explained_before_anything_is_written(world, monkeypatch):
    def missing(name):
        raise APIError({"message": "relation does not exist", "code": "42P01"})

    monkeypatch.setattr(seed_script.db_client, "table", missing)
    with pytest.raises(seed_script.SeedError, match="admin_permissions_migration.sql"):
        run()
