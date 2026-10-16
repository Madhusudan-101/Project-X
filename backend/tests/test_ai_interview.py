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

    def is_(self, c, v):
        want = None if v in ("null", None) else v
        self.filters.append(lambda r: r.get(c) == want); return self

    def in_(self, c, vs):
        self.filters.append(lambda r: r.get(c) in vs); return self

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
            made = []
            for item in (self.payload if isinstance(self.payload, list) else [self.payload]):
                r = {"id": str(uuid.uuid4()),
                     "created_at": datetime.now(timezone.utc).isoformat(),
                     "started_at": datetime.now(timezone.utc).isoformat(), **item}
                self.rows.append(r); made.append(r)
            return _Resp(made)
        if self.op == "upsert":
            for r in self.rows:
                if r.get(self.on_conflict) == self.payload.get(self.on_conflict):
                    r.update(self.payload); return _Resp([r])
            r = {"id": str(uuid.uuid4()),
                 "created_at": datetime.now(timezone.utc).isoformat(), **self.payload}
            self.rows.append(r); return _Resp([r])
        if self.op == "delete":
            hit = self._match()
            for r in hit: self.rows.remove(r)
            return _Resp(hit)
        if self.op == "update":
            hit = self._match()
            for r in hit: r.update(self.payload)
            return _Resp(hit)
        raise NotImplementedError(self.op)


class _Table:
    def __init__(self, rows, defaults=None): self.rows, self.defaults = rows, defaults or {}
    def select(self, *_a, count=None, **_k): return _Query(self.rows, "select", count=bool(count))
    def insert(self, p):
        fill = lambda item: {**self.defaults, **item}
        return _Query(self.rows, "insert", [fill(i) for i in p] if isinstance(p, list) else fill(p))
    def upsert(self, p, on_conflict=None): return _Query(self.rows, "upsert", p, on_conflict)
    def update(self, p): return _Query(self.rows, "update", p)
    def delete(self): return _Query(self.rows, "delete")


class _Store:
    # Column defaults the real database applies on insert.
    DEFAULTS = {"ai_voice_interview_sessions": {"status": "started"}}

    def __init__(self): self.tables = {}

    def table(self, name):
        return _Table(self.tables.setdefault(name, []), self.DEFAULTS.get(name, {}))


class _FakeLK:
    created = []
    dispatched = []
    fail = False
    fail_dispatch = False

    def __init__(self, *a):
        self.room = self
        self.agent_dispatch = self

    async def create_dispatch(self, req):
        if _FakeLK.fail_dispatch: raise RuntimeError("dispatch failed")
        _FakeLK.dispatched.append(req)

    async def create_room(self, req):
        if _FakeLK.fail: raise RuntimeError("livekit down")
        _FakeLK.created.append(req)

    async def aclose(self): pass


CONSENT = {"consent": True, "audioConsent": True, "videoConsent": True,
           "consentVersion": cand.CONSENT_VERSION}

STUDENT, OTHER = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"


@pytest.fixture()
def env(monkeypatch):
    store = _Store()
    monkeypatch.setattr(cand, "db_client", store)
    monkeypatch.setattr(hook, "db_client", store)
    from livekit import api
    monkeypatch.setattr(api, "LiveKitAPI", _FakeLK)
    _FakeLK.created, _FakeLK.dispatched, _FakeLK.fail, _FakeLK.fail_dispatch = [], [], False, False
    user = {"id": STUDENT, "email": "ada@example.com"}
    app.dependency_overrides[require_candidate_role] = lambda: user
    yield SimpleNamespace(store=store, client=TestClient(app), user=user)
    app.dependency_overrides.clear()


AUTH = {"Authorization": "Bearer test-ai-secret"}


def test_session_requires_auth():
    app.dependency_overrides.clear()
    assert TestClient(app).post("/candidate/ai-interview/session", json={"domain": "dsa", **CONSENT}).status_code == 401


def test_session_rejects_bad_domain(env):
    assert env.client.post("/candidate/ai-interview/session", json={"domain": "nope", **CONSENT}).status_code == 400


def test_session_creates_room_with_identity_and_records_it(env):
    r = env.client.post("/candidate/ai-interview/session", json={"domain": "dsa", **CONSENT})
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
        assert env.client.post("/candidate/ai-interview/session", json={"domain": "ai_ml", **CONSENT}).status_code == 200
    assert env.client.post("/candidate/ai-interview/session", json={"domain": "ai_ml", **CONSENT}).status_code == 429


def test_session_livekit_failure_is_502_and_not_counted(env):
    _FakeLK.fail = True
    assert env.client.post("/candidate/ai-interview/session", json={"domain": "dsa", **CONSENT}).status_code == 502
    assert env.store.tables.get("ai_voice_interview_sessions", []) == []


def test_session_explicitly_dispatches_the_agent_to_the_room(env):
    room = env.client.post("/candidate/ai-interview/session", json={"domain": "dsa", **CONSENT}).json()["roomName"]
    assert len(_FakeLK.dispatched) == 1
    assert _FakeLK.dispatched[0].room == room
    assert _FakeLK.dispatched[0].agent_name == "mirracle-interviewer"


def test_token_carries_no_room_config(env):
    import jwt
    tok = env.client.post("/candidate/ai-interview/session", json={"domain": "dsa", **CONSENT}).json()["participantToken"]
    claims = jwt.decode(tok, options={"verify_signature": False})
    assert "roomConfig" not in claims
    assert claims["sub"] == STUDENT


def test_dispatch_failure_is_502_and_does_not_consume_quota(env):
    _FakeLK.fail_dispatch = True
    assert env.client.post("/candidate/ai-interview/session", json={"domain": "dsa", **CONSENT}).status_code == 502
    assert env.store.tables.get("ai_voice_interview_sessions", []) == []
    _FakeLK.fail_dispatch = False
    for _ in range(2):  # daily limit is 2: both must still be available
        assert env.client.post("/candidate/ai-interview/session", json={"domain": "dsa", **CONSENT}).status_code == 200


def _start(env):
    return env.client.post("/candidate/ai-interview/session", json={"domain": "web_dev", **CONSENT}).json()["roomName"]


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


# ─── Config, consent, integrity events ────────────────────────────────────────

URL = "/candidate/ai-interview"


def test_config_reports_real_limits_and_attempts_left(env):
    c = env.client.get(f"{URL}/config").json()
    assert c == {"maxMinutes": 20, "dailyLimit": 2, "usedToday": 0, "remainingToday": 2,
                 "consentVersion": cand.CONSENT_VERSION}
    _start(env)
    c = env.client.get(f"{URL}/config").json()
    assert c["usedToday"] == 1 and c["remainingToday"] == 1
    _start(env)
    assert env.client.get(f"{URL}/config").json()["remainingToday"] == 0


def test_config_requires_auth():
    app.dependency_overrides.clear()
    assert TestClient(app).get(f"{URL}/config").status_code == 401


def test_session_requires_explicit_consent(env):
    r = env.client.post(f"{URL}/session", json={"domain": "dsa", "consent": False, "audioConsent": True, "videoConsent": True,
                                                "consentVersion": cand.CONSENT_VERSION})
    assert r.status_code == 400 and "accept" in r.json()["detail"].lower()
    assert env.client.post(f"{URL}/session", json={"domain": "dsa"}).status_code == 422
    assert env.store.tables.get("ai_voice_interview_sessions", []) == []
    assert _FakeLK.created == []


def test_session_rejects_stale_rules_version(env):
    r = env.client.post(f"{URL}/session", json={"domain": "dsa", "consent": True, "audioConsent": True,
                                                "videoConsent": True, "consentVersion": "old"})
    assert r.status_code == 409
    assert env.store.tables.get("ai_voice_interview_sessions", []) == []


def test_session_stores_consent_record(env):
    _start(env)
    row = env.store.tables["ai_voice_interview_sessions"][0]
    assert row["consent_version"] == cand.CONSENT_VERSION and row["consent_at"]


def _events(env, room, *kinds, **kw):
    return env.client.post(f"{URL}/session/{room}/integrity-events",
                           json={"events": [{"kind": k, "offsetSeconds": kw.get("at", 5)} for k in kinds]})


def test_integrity_events_are_saved_for_own_live_session(env):
    room = _start(env)
    r = _events(env, room, "tab_hidden", "camera_lost", at=42)
    assert r.status_code == 200 and r.json() == {"accepted": 2}
    rows = env.store.tables["ai_voice_interview_integrity_events"]
    assert [(x["kind"], x["offset_seconds"], x["student_id"]) for x in rows] == [
        ("tab_hidden", 42, STUDENT), ("camera_lost", 42, STUDENT)]


def test_integrity_events_validate_input(env):
    room = _start(env)
    assert _events(env, room, "teleported").status_code == 400
    assert env.client.post(f"{URL}/session/{room}/integrity-events", json={"events": []}).status_code == 422
    too_many = {"events": [{"kind": "tab_hidden", "offsetSeconds": 1}] * 21}
    assert env.client.post(f"{URL}/session/{room}/integrity-events", json=too_many).status_code == 422
    neg = {"events": [{"kind": "tab_hidden", "offsetSeconds": -1}]}
    assert env.client.post(f"{URL}/session/{room}/integrity-events", json=neg).status_code == 422
    assert env.client.post(f"{URL}/session/bad%20id!/integrity-events",
                           json={"events": [{"kind": "tab_hidden", "offsetSeconds": 1}]}).status_code == 400
    assert env.store.tables.get("ai_voice_interview_integrity_events", []) == []


def test_integrity_events_cannot_target_another_students_room(env):
    room = _start(env)
    env.user["id"] = OTHER
    assert _events(env, room, "tab_hidden").status_code == 404
    assert env.store.tables.get("ai_voice_interview_integrity_events", []) == []


def test_integrity_events_refused_after_interview_finishes(env):
    room = _start(env)
    env.client.post("/internal/ai-interview-reports", json={"room_id": room}, headers=AUTH)
    assert _events(env, room, "tab_hidden").status_code == 409


def test_integrity_events_refused_for_stale_session(env):
    room = _start(env)
    env.store.tables["ai_voice_interview_sessions"][0]["started_at"] = "2020-01-01T00:00:00+00:00"
    assert _events(env, room, "tab_hidden").status_code == 409


def test_integrity_events_capped_per_session(env, monkeypatch):
    monkeypatch.setattr(cand, "MAX_EVENTS_PER_SESSION", 3)
    room = _start(env)
    assert _events(env, room, "tab_hidden", "tab_hidden").json() == {"accepted": 2}
    assert _events(env, room, "tab_hidden", "tab_hidden").json() == {"accepted": 1}
    assert _events(env, room, "tab_hidden").json() == {"accepted": 0}
    assert len(env.store.tables["ai_voice_interview_integrity_events"]) == 3


def test_integrity_events_require_auth():
    app.dependency_overrides.clear()
    r = TestClient(app).post(f"{URL}/session/abc/integrity-events",
                             json={"events": [{"kind": "tab_hidden", "offsetSeconds": 1}]})
    assert r.status_code == 401


def test_reports_include_integrity_summary_and_timeline(env):
    room = _start(env)
    _events(env, room, "tab_hidden", at=10)
    _events(env, room, "window_blur", at=20)
    _events(env, room, "camera_lost", at=30)
    _events(env, room, "camera_restored", at=35)
    env.client.post("/internal/ai-interview-reports", json={"room_id": room, "overall_score": 70}, headers=AUTH)

    detail = env.client.get(f"{URL}/reports/{room}").json()
    assert detail["integrity"] == {"tab_switches": 2, "camera_lost": 1, "mic_lost": 0, "video_flags": 0, "total": 3}
    assert [(e["kind"], e["offset_seconds"]) for e in detail["integrity_events"]] == [
        ("tab_hidden", 10), ("window_blur", 20), ("camera_lost", 30), ("camera_restored", 35)]

    listed = env.client.get(f"{URL}/reports").json()
    assert listed[0]["integrity"] == {"tab_switches": 2, "camera_lost": 1, "mic_lost": 0, "video_flags": 0, "total": 3}


def test_report_without_events_has_clean_summary(env):
    room = _start(env)
    env.client.post("/internal/ai-interview-reports", json={"room_id": room}, headers=AUTH)
    d = env.client.get(f"{URL}/reports/{room}").json()
    assert d["integrity"] == {"tab_switches": 0, "camera_lost": 0, "mic_lost": 0, "video_flags": 0, "total": 0}
    assert d["integrity_events"] == []


# ─── Video consent + agent video observations ─────────────────────────────────

def test_session_requires_explicit_video_consent(env):
    r = env.client.post(f"{URL}/session", json={"domain": "dsa", "consent": True,
                                                "audioConsent": True, "videoConsent": False,
                                                "consentVersion": cand.CONSENT_VERSION})
    assert r.status_code == 400 and "camera" in r.json()["detail"].lower()
    r = env.client.post(f"{URL}/session", json={"domain": "dsa", "consent": True,
                                                "audioConsent": True,
                                                "consentVersion": cand.CONSENT_VERSION})
    assert r.status_code == 422  # videoConsent missing entirely
    assert env.store.tables.get("ai_voice_interview_sessions", []) == []
    assert _FakeLK.created == [] and _FakeLK.dispatched == []


def test_video_consent_is_recorded_and_told_to_the_agent(env):
    import json
    _start(env)
    assert env.store.tables["ai_voice_interview_sessions"][0]["video_consent"] is True
    assert json.loads(_FakeLK.created[0].metadata)["video_consent"] is True


def _agent_events(env, room, *kinds, at=30, headers=AUTH):
    return env.client.post("/internal/ai-interview-integrity", headers=headers, json={
        "room_id": room, "events": [{"kind": k, "offset_seconds": at} for k in kinds]})


def test_agent_video_events_require_the_shared_secret(env):
    room = _start(env)
    assert _agent_events(env, room, "no_face", headers={}).status_code == 401
    assert _agent_events(env, room, "no_face", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert env.store.tables.get("ai_voice_interview_integrity_events", []) == []


def test_agent_video_events_are_saved_with_source_and_student_from_session(env):
    room = _start(env)
    r = _agent_events(env, room, "no_face", "multiple_faces", at=95)
    assert r.status_code == 201 and r.json() == {"accepted": 2}
    rows = env.store.tables["ai_voice_interview_integrity_events"]
    assert [(x["kind"], x["source"], x["student_id"], x["offset_seconds"]) for x in rows] == [
        ("no_face", "agent", STUDENT, 95), ("multiple_faces", "agent", STUDENT, 95)]


def test_agent_cannot_store_browser_kinds_and_browser_cannot_store_video_kinds(env):
    room = _start(env)
    assert _agent_events(env, room, "tab_hidden").status_code == 400
    assert _events(env, room, "no_face").status_code == 400
    assert env.store.tables.get("ai_voice_interview_integrity_events", []) == []


def test_agent_video_events_refused_without_video_consent(env):
    room = _start(env)
    env.store.tables["ai_voice_interview_sessions"][0]["video_consent"] = False
    r = _agent_events(env, room, "no_face")
    assert r.status_code == 403
    assert env.store.tables.get("ai_voice_interview_integrity_events", []) == []


def test_agent_video_events_refused_for_unknown_or_finished_interviews(env):
    assert _agent_events(env, "ghost", "no_face").status_code == 404
    room = _start(env)
    env.client.post("/internal/ai-interview-reports", json={"room_id": room}, headers=AUTH)
    assert _agent_events(env, room, "no_face").status_code == 409


def test_agent_video_events_share_the_per_session_cap(env, monkeypatch):
    from app.routers.shared import ai_interview_reports as hookmod
    monkeypatch.setattr(hookmod, "MAX_EVENTS_PER_SESSION", 2)
    room = _start(env)
    assert _agent_events(env, room, "no_face", "no_face", "no_face").json() == {"accepted": 2}
    assert _agent_events(env, room, "no_face").json() == {"accepted": 0}


def test_reports_count_video_flags_and_label_the_source(env):
    room = _start(env)
    _events(env, room, "tab_hidden", at=10)
    _agent_events(env, room, "multiple_faces", "camera_blocked", at=50)
    env.client.post("/internal/ai-interview-reports", json={"room_id": room}, headers=AUTH)
    d = env.client.get(f"{URL}/reports/{room}").json()
    assert d["integrity"] == {"tab_switches": 1, "camera_lost": 0, "mic_lost": 0, "video_flags": 2, "total": 3}
    assert [(e["kind"], e["source"]) for e in d["integrity_events"]] == [
        ("tab_hidden", "browser"), ("multiple_faces", "agent"), ("camera_blocked", "agent")]


# ─── Audio consent + microphone events ────────────────────────────────────────

def test_session_requires_explicit_audio_consent(env):
    body = {"domain": "dsa", "consent": True, "videoConsent": True,
            "consentVersion": cand.CONSENT_VERSION}
    r = env.client.post(f"{URL}/session", json={**body, "audioConsent": False})
    assert r.status_code == 400 and "microphone" in r.json()["detail"].lower()
    assert env.client.post(f"{URL}/session", json=body).status_code == 422  # field missing
    assert env.store.tables.get("ai_voice_interview_sessions", []) == []
    assert _FakeLK.created == [] and _FakeLK.dispatched == []


def test_audio_consent_is_recorded_and_told_to_the_agent(env):
    import json
    _start(env)
    assert env.store.tables["ai_voice_interview_sessions"][0]["audio_consent"] is True
    assert json.loads(_FakeLK.created[0].metadata)["audio_consent"] is True


def test_every_consent_is_needed_independently(env):
    full = {"domain": "dsa", "consent": True, "audioConsent": True, "videoConsent": True,
            "consentVersion": cand.CONSENT_VERSION}
    for missing in ("consent", "audioConsent", "videoConsent"):
        r = env.client.post(f"{URL}/session", json={**full, missing: False})
        assert r.status_code == 400, missing
    assert env.store.tables.get("ai_voice_interview_sessions", []) == []
    assert env.client.post(f"{URL}/session", json=full).status_code == 200


def test_microphone_dropouts_are_saved_and_counted(env):
    room = _start(env)
    assert _events(env, room, "mic_lost", at=70).json() == {"accepted": 1}
    assert _events(env, room, "mic_restored", at=80).json() == {"accepted": 1}
    env.client.post("/internal/ai-interview-reports", json={"room_id": room}, headers=AUTH)
    d = env.client.get(f"{URL}/reports/{room}").json()
    assert d["integrity"] == {"tab_switches": 0, "camera_lost": 0, "mic_lost": 1,
                              "video_flags": 0, "total": 1}
    assert [(e["kind"], e["offset_seconds"]) for e in d["integrity_events"]] == [
        ("mic_lost", 70), ("mic_restored", 80)]
