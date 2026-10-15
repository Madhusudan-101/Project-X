import os
import sys
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fakes import FakeAuth, FakeDB  # noqa: E402

from app import deps  # noqa: E402
from app.main import app  # noqa: E402


class Env:
    """Everything a test needs: the HTTP client, the fake DB and fake auth."""

    def __init__(self, db: FakeDB, auth: FakeAuth, client: TestClient):
        self.db, self.auth, self.client = db, auth, client

    # -- seeding helpers -------------------------------------------------
    def user(self, uid: str, role: str, *, email: str | None = None, profile: dict | None = None,
             password: str = "Passw0rd!x", meta: dict | None = None) -> dict:
        """Create an auth user + profile row, return auth headers."""
        email = email or f"{uid}@test.dev"
        token = self.auth.add_user(uid, email, password, {"role": role, **(meta or {})})
        self.db.add("profiles", id=uid, email=email, role=role, **(profile or {}))
        return {"Authorization": f"Bearer {token}"}

    def company_user(self, uid="hr-1", name="Acme"):
        h = self.user(uid, "company")
        company = self.db.add("companies", owner_id=uid, name=name, industry="Software", size="11-50",
                              hiring_domains=["tech"])
        return h, company

    def college(self, cid="col-1", name="Alpha College"):
        return self.db.add("colleges", id=cid, name=name)


@pytest.fixture
def env(monkeypatch):
    db, auth = FakeDB(), FakeAuth()
    monkeypatch.setattr(deps.db_client, "table", db.table)
    monkeypatch.setattr(deps.db_client, "rpc", db.rpc)
    for name in ("get_user", "sign_up", "sign_in_with_password", "refresh_session", "verify_otp",
                 "resend", "reset_password_for_email"):
        monkeypatch.setattr(deps.auth_client.auth, name, getattr(auth, name))
    monkeypatch.setattr(deps.admin_client.auth.admin, "update_user_by_id", auth.update_user_by_id)

    # RLS-bound per-request client used by the college routers: same data, same fake.
    def fake_create_client(*_a, **_k):
        return SimpleNamespace(table=db.table, rpc=db.rpc, postgrest=SimpleNamespace(auth=lambda t: None))

    monkeypatch.setattr(deps, "create_client", fake_create_client)
    import app.routers.shared.auth as auth_router
    monkeypatch.setattr(auth_router.time, "sleep", lambda s: None)

    return Env(db, auth, TestClient(app, raise_server_exceptions=False))
