"""Shared scaffolding for the AI interview integration tests: a LiveKit stub, an email capture,
seeded companies and candidates, and small request helpers."""
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.routers.candidate import ai_interview as cand
from app.services.notifications import ai_interview_emails

BASE = "/company/ai-interviews"
CAND = "/candidate/ai-interview"
AUTH = {"Authorization": "Bearer test-ai-secret"}


def iso(days=0, hours=0, minutes=0):
    return (datetime.now(timezone.utc) + timedelta(days=days, hours=hours, minutes=minutes)).isoformat()


# ── LiveKit stub ────────────────────────────────────────────────────
class FakeLK:
    """Stands in for LiveKitAPI. `rooms` maps a room name to the identities currently in it, so a
    test can put the AI interviewer into a room (or leave it empty) and see how the API reacts."""
    created, dispatched, deleted = [], [], []
    rooms: dict = {}
    fail_room = fail_dispatch = False

    def __init__(self, *a):
        self.room = self
        self.agent_dispatch = self

    async def create_room(self, req):
        if FakeLK.fail_room:
            raise RuntimeError("livekit down")
        FakeLK.created.append(req)
        FakeLK.rooms[req.name] = []

    async def create_dispatch(self, req):
        if FakeLK.fail_dispatch:
            raise RuntimeError("dispatch failed")
        FakeLK.dispatched.append(req)

    async def list_participants(self, req):
        if req.room not in FakeLK.rooms:
            raise RuntimeError("room not found")
        return SimpleNamespace(participants=[SimpleNamespace(identity=i) for i in FakeLK.rooms[req.room]])

    async def delete_room(self, req):
        FakeLK.deleted.append(req.room)
        FakeLK.rooms.pop(req.room, None)

    async def list_rooms(self, req):
        return SimpleNamespace(rooms=[SimpleNamespace(name=n) for n in req.names if n in FakeLK.rooms])

    async def aclose(self):
        pass


@pytest.fixture(autouse=True)
def livekit(monkeypatch):
    from livekit import api
    monkeypatch.setenv("LIVEKIT_URL", "wss://test.livekit.cloud")
    monkeypatch.setenv("LIVEKIT_API_KEY", "devkey")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "s" * 40)
    monkeypatch.setenv("AI_INTERVIEW_SHARED_SECRET", "test-ai-secret")
    monkeypatch.setattr(api, "LiveKitAPI", FakeLK)
    FakeLK.created, FakeLK.dispatched, FakeLK.deleted, FakeLK.rooms = [], [], [], {}
    FakeLK.fail_room = FakeLK.fail_dispatch = False


@pytest.fixture(autouse=True)
def emails(monkeypatch):
    sent = []
    monkeypatch.setattr(ai_interview_emails, "send_email",
                        lambda to, subject, html: sent.append((to, subject, html)) or "sent")
    return sent


# ── helpers ─────────────────────────────────────────────────────────
def rubric():
    return [
        {"name": "System design", "description": "Designs for scale.", "weight": 60,
         "questions": ["How would you design a URL shortener?"], "expected_concepts": "Sharding; caching."},
        {"name": "Communication", "weight": 40},
    ]


def template_body(**over):
    body = dict(title="Backend round 1", role_title="Backend Engineer", level="mid",
                duration_minutes=25, instructions="Be on time.", rubric=rubric(), status="active")
    body.update(over)
    return body


def make_template(env, h, **over):
    r = env.client.post(BASE, headers=h, json=template_body(**over))
    assert r.status_code == 201, r.text
    return r.json()


def rows(env, table):
    return env.db.tables.get(table, [])


def consents(**over):
    return {"consent": True, "audioConsent": True, "videoConsent": True,
            "consentVersion": cand.CONSENT_VERSION, **over}


def invite(env, h, tid, *emails, **over):
    r = env.client.post(f"{BASE}/{tid}/invites", headers=h, json={"emails": list(emails), **over})
    assert r.status_code == 200, r.text
    return r.json()


def first_invite_id(env, h, tid):
    return env.client.get(f"{BASE}/{tid}/invites", headers=h).json()[0]["id"]


@pytest.fixture
def hr(env):
    h, company = env.company_user("hr-1", "Acme")
    return h, company


@pytest.fixture
def active(env, hr):
    """An active template with one candidate invited by email (no account yet)."""
    h, _ = hr
    t = make_template(env, h)
    invite(env, h, t["id"], "ada@x.dev")
    return h, t, first_invite_id(env, h, t["id"])


def candidate(env, uid="stu-1", email="ada@x.dev"):
    return env.user(uid, "candidate", email=email)


def start(env, ch, inv_id, **over):
    return env.client.post(f"{CAND}/session", headers=ch, json={"inviteId": inv_id, **consents(**over)})


def room_of(env, inv_id):
    return env.db.one("ai_interview_invites", id=inv_id)["room_id"]


def report(env, room, **over):
    body = {"room_id": room, "overall_score": 71, "technical_score": 70, "communication_score": 75,
            "strengths": ["clear"], "weaknesses": ["depth"], "final_recommendation": "Hire",
            "report_markdown": "# Report", "transcript": "Q1 A1",
            "competency_scores": [
                {"name": "System design", "score": 68, "weight": 60, "evidence": "Sharded by hash."},
                {"name": "Communication", "score": 77, "weight": 40, "evidence": "Clear."}]}
    body.update(over)
    return env.client.post("/internal/ai-interview-reports", json=body, headers=AUTH)


