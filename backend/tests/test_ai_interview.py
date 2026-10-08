"""
AI voice interview routes: session start (auth/domain/quota), report webhook
(secret/idempotence/attribution) and own-report reads. Uses an in-memory fake
for the Supabase client subset these routes use and stubs LiveKit.

Run with:  pytest tests/test_ai_interview.py
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "svc-role-test")
os.environ.setdefault("SUPABASE_ANON_KEY", "anon-test")
os.environ["LIVEKIT_URL"] = "wss://test.livekit.cloud"
os.environ["LIVEKIT_API_KEY"] = "devkey"
os.environ["LIVEKIT_API_SECRET"] = "s" * 40
os.environ["AI_INTERVIEW_SHARED_SECRET"] = "test-ai-secret"
os.environ["AI_INTERVIEW_DAILY_LIMIT"] = "2"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.deps import require_candidate_role
from app.routers.candidate import ai_interview as cand
from app.routers.shared import ai_interview_reports as hook


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Query:
    def __init__(self, rows, op, payload=None, on_conflict=None, count=False):
        self.rows, self.op, self.payload = rows, op, payload
        self.on_conflict, self.want_count = on_conflict, count
        self.filters, self._limit, self._desc, self._order = [], None, False, None

    def eq(self, c, v):
        self.filters.append(lambda r: r.get(c) == v); return self

    def gte(self, c, v):
        self.filters.append(lambda r: (r.get(c) or "") >= v); return self

    def order(self, c, desc=False):
        self._order, self._desc = c, desc; return self

    def limit(self, n):
        self._limit = n; return self

    def _match(self):
        return [r for r in self.rows if all(f(r) for f in self.filters)]

    def execute(self):
        if self.op == "select":
            out = self._match()
            if self._order:
                out.sort(key=lambda r: r.get(self._order) or "", reverse=self._desc)
            n = len(out)
            if self._limit is not None:
                out = out[: self._limit]
            return _Resp([dict(r) for r in out], count=n if self.want_count else None)
        if self.op == "insert":
            r = {"id": str(uuid.uuid4()),
                 "created_at": datetime.now(timezone.utc).isoformat(),
                 "started_at": datetime.now(timezone.utc).isoformat(), **self.payload}
            self.rows.append(r); return _Resp([r])
        if self.op == "upsert":
            for r in self.rows:
                if r.get(self.on_conflict) == self.payload.get(self.on_conflict):
                    r.update(self.payload); return _Resp([r])
            r = {"id": str(uuid.uuid4()),
                 "created_at": datetime.now(timezone.utc).isoformat(), **self.payload}
            self.rows.append(r); return _Resp([r])
        if self.op == "update":
            hit = self._match()
            for r in hit: r.update(self.payload)
            return _Resp(hit)
        raise NotImplementedError(self.op)


class _Table:
    def __init__(self, rows): self.rows = rows
    def select(self, *_a, count=None, **_k): return _Query(self.rows, "select", count=bool(count))
    def insert(self, p): return _Query(self.rows, "insert", p)
    def upsert(self, p, on_conflict=None): return _Query(self.rows, "upsert", p, on_conflict)
    def update(self, p): return _Query(self.rows, "update", p)


class _Store:
    def __init__(self): self.tables = {}
    def table(self, name): return _Table(self.tables.setdefault(name, []))


class _FakeLK:
    created = []
    fail = False

    def __init__(self, *a): self.room = self

    async def create_room(self, req):
        if _FakeLK.fail: raise RuntimeError("livekit down")
        _FakeLK.created.append(req)

    async def aclose(self): pass


STUDENT, OTHER = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"


@pytest.fixture()
def env(monkeypatch):
    store = _Store()
    monkeypatch.setattr(cand, "db_client", store)
    monkeypatch.setattr(hook, "db_client", store)
    from livekit import api
    monkeypatch.setattr(api, "LiveKitAPI", _FakeLK)
    _FakeLK.created, _FakeLK.fail = [], False
    user = {"id": STUDENT, "email": "ada@example.com"}
    app.dependency_overrides[require_candidate_role] = lambda: user
    yield SimpleNamespace(store=store, client=TestClient(app), user=user)
    app.dependency_overrides.clear()


AUTH = {"Authorization": "Bearer test-ai-secret"}


def test_session_requires_auth():
    app.dependency_overrides.clear()
    assert TestClient(app).post("/candidate/ai-interview/session", json={"domain": "dsa"}).status_code == 401


def test_session_rejects_bad_domain(env):
    assert env.client.post("/candidate/ai-interview/session", json={"domain": "nope"}).status_code == 400


def test_session_creates_room_with_identity_and_records_it(env):
    r = env.client.post("/candidate/ai-interview/session", json={"domain": "dsa"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["serverUrl"] == "wss://test.livekit.cloud" and body["roomName"].startswith("ai-")
    assert body["participantToken"]
    import json
    meta = json.loads(_FakeLK.created[0].metadata)
    assert meta["user_id"] == STUDENT and meta["domain"] == "dsa"
    assert _FakeLK.created[0].max_participants == 2
    assert env.store.tables["ai_voice_interview_sessions"][0]["student_id"] == STUDENT


def test_session_daily_quota(env):
    for _ in range(2):
        assert env.client.post("/candidate/ai-interview/session", json={"domain": "ai_ml"}).status_code == 200
    assert env.client.post("/candidate/ai-interview/session", json={"domain": "ai_ml"}).status_code == 429


def test_session_livekit_failure_is_502_and_not_counted(env):
    _FakeLK.fail = True
    assert env.client.post("/candidate/ai-interview/session", json={"domain": "dsa"}).status_code == 502
    assert env.store.tables.get("ai_voice_interview_sessions", []) == []


def _start(env):
    return env.client.post("/candidate/ai-interview/session", json={"domain": "web_dev"}).json()["roomName"]


def test_webhook_rejects_missing_and_bad_secret(env):
    p = {"room_id": "x"}
    assert env.client.post("/internal/ai-interview-reports", json=p).status_code == 401
    assert env.client.post("/internal/ai-interview-reports", json=p,
                           headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_webhook_unknown_room_is_404(env):
    r = env.client.post("/internal/ai-interview-reports", json={"room_id": "ghost"}, headers=AUTH)
    assert r.status_code == 404


def test_webhook_attributes_student_from_session_and_is_idempotent(env):
    room = _start(env)
    payload = {"room_id": room, "overall_score": 150, "technical_score": 70,
               "strengths": ["clear"], "report_markdown": "# R"}
    assert env.client.post("/internal/ai-interview-reports", json=payload, headers=AUTH).status_code == 201
    payload["technical_score"] = 80
    assert env.client.post("/internal/ai-interview-reports", json=payload, headers=AUTH).status_code == 201
    rows = env.store.tables["ai_voice_interview_reports"]
    assert len(rows) == 1
    assert rows[0]["student_id"] == STUDENT and rows[0]["domain"] == "web_dev"
    assert rows[0]["overall_score"] == 100.0 and rows[0]["technical_score"] == 80
    assert env.store.tables["ai_voice_interview_sessions"][0]["status"] == "completed"


def test_partial_report_marks_session_abandoned(env):
    room = _start(env)
    env.client.post("/internal/ai-interview-reports", json={"room_id": room, "partial": True}, headers=AUTH)
    assert env.store.tables["ai_voice_interview_sessions"][0]["status"] == "abandoned"


def test_reports_are_scoped_to_the_caller(env):
    room = _start(env)
    env.client.post("/internal/ai-interview-reports", json={"room_id": room, "overall_score": 60}, headers=AUTH)
    assert [r["room_id"] for r in env.client.get("/candidate/ai-interview/reports").json()] == [room]
    assert env.client.get(f"/candidate/ai-interview/reports/{room}").status_code == 200
    env.user["id"] = OTHER
    assert env.client.get("/candidate/ai-interview/reports").json() == []
    assert env.client.get(f"/candidate/ai-interview/reports/{room}").status_code == 404
    assert env.client.get("/candidate/ai-interview/reports/bad%20id!").status_code == 400
