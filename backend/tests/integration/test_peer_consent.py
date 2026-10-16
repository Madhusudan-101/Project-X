"""PeerMeet Phase 3: guidelines and consent are enforced by the server, per version."""
from datetime import timedelta

import pytest

from app.services.peer_safety import GUIDELINES_VERSION
from peer_support import consent, install_matcher, iso, now

ALICE, BOB = "alice", "bob"


@pytest.fixture
def peer(env):
    install_matcher(env)
    env.h = {
        ALICE: env.user(ALICE, "candidate", profile={"name": "Alice A"}),
        BOB: env.user(BOB, "candidate", profile={"name": "Bob B"}),
    }
    return env


def accept(env, who, **over):
    body = {"version": GUIDELINES_VERSION, "rules": True, "media": True, "ai": True, **over}
    return env.client.post("/candidate/peer-safety/guidelines/accept", json=body, headers=env.h[who])


def entry_points(env, who):
    """Every way into the peer feature, and the status each gives."""
    h = env.h[who]
    meeting = {"scheduled_at": iso(now() + timedelta(minutes=2)), "duration_minutes": 30, "keep_private": False}
    return {
        "match": env.client.post("/candidate/peer-matchmaking/request", json={}, headers=h).status_code,
        "schedule": env.client.post("/candidate/peer-meetings", json=meeting, headers=h).status_code,
        "token": env.client.post("/candidate/peer-session-token", json={"room_id": "some-room-1"}, headers=h).status_code,
    }


def test_nothing_works_until_the_guidelines_are_accepted(peer):
    got = entry_points(peer, ALICE)
    assert got["match"] == got["schedule"] == got["token"] == 428
    r = peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[ALICE])
    assert "guidelines" in r.json()["detail"].lower()
    assert peer.db.rows("peer_matchmaking_tickets") == []  # no ticket was created behind the refusal


def test_joining_a_meeting_needs_it_too(peer):
    consent(peer, BOB)
    body = {"scheduled_at": iso(now() + timedelta(minutes=2)), "duration_minutes": 30, "keep_private": False}
    m = peer.client.post("/candidate/peer-meetings", json=body, headers=peer.h[BOB]).json()
    assert peer.client.post(f"/candidate/peer-meetings/{m['id']}/join", headers=peer.h[ALICE]).status_code == 428


def test_state_endpoint_and_accepting_unlocks_everything(peer):
    st = peer.client.get("/candidate/peer-safety/guidelines", headers=peer.h[ALICE]).json()
    assert st == {"version": GUIDELINES_VERSION, "accepted": False, "accepted_at": None}
    r = accept(peer, ALICE)
    assert r.status_code == 200 and r.json()["accepted"] is True and r.json()["accepted_at"]
    assert entry_points(peer, ALICE)["match"] == 200
    assert entry_points(peer, ALICE)["schedule"] == 201
    # and it only unlocked Alice
    assert entry_points(peer, BOB)["match"] == 428


def test_all_three_statements_are_required(peer):
    for missing in ("rules", "media", "ai"):
        assert accept(peer, ALICE, **{missing: False}).status_code == 422
    assert peer.client.get("/candidate/peer-safety/guidelines", headers=peer.h[ALICE]).json()["accepted"] is False
    assert peer.db.rows("peer_consents") == []


def test_an_old_version_cannot_be_accepted_and_a_new_version_re_prompts(peer):
    assert accept(peer, ALICE, version="2020-01-old").status_code == 409
    accept(peer, ALICE)
    assert entry_points(peer, ALICE)["match"] == 200
    # the guidelines change: the stored acceptance is for an older version, so they must accept again
    peer.db.one("peer_consents", student_id=ALICE)["version"] = "an-older-version"
    assert peer.client.get("/candidate/peer-safety/guidelines", headers=peer.h[ALICE]).json()["accepted"] is False
    peer.db.tables["peer_matchmaking_tickets"].clear()
    assert entry_points(peer, ALICE)["match"] == 428


def test_accepting_twice_keeps_one_record(peer):
    accept(peer, ALICE)
    accept(peer, ALICE)
    assert len(peer.db.rows("peer_consents", student_id=ALICE)) == 1


def test_a_partial_record_does_not_count(peer):
    peer.db.add("peer_consents", id="x", student_id=ALICE, version=GUIDELINES_VERSION,
                accepted_rules=True, accepted_media=False, accepted_ai=True)
    assert entry_points(peer, ALICE)["match"] == 428


def test_reading_state_and_reporting_do_not_need_acceptance(peer):
    """Someone who has not accepted must still be able to report a problem or read their own status."""
    assert peer.client.get("/candidate/peer-safety/status", headers=peer.h[ALICE]).status_code == 200
    assert peer.client.get("/candidate/peer-safety/guidelines", headers=peer.h[ALICE]).status_code == 200
    assert peer.client.get("/candidate/peer-safety/blocks", headers=peer.h[ALICE]).status_code == 200


def test_suspension_still_takes_priority_over_consent(peer):
    consent(peer, ALICE)
    peer.db.add("peer_sanctions", student_id=ALICE, kind="suspension", reason="x", ends_at=iso(now() + timedelta(days=1)), lifted_at=None)
    r = peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[ALICE])
    assert r.status_code == 403 and "paused" in r.json()["detail"]
