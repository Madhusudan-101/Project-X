"""PeerMeet Phase 1: bug fixes. Every test here failed against the code before the fix."""
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from peer_support import install_matcher as _install_matcher, iso as _iso, now as _now

from app.routers.candidate import peer as peer_mod
from app.routers.shared import peer_reports as reports_mod

SECRET = "test-shared-secret"
ALICE, BOB, CAROL = "alice", "bob", "carol"


@pytest.fixture
def peer(env):
    _install_matcher(env)
    h = {
        ALICE: env.user(ALICE, "candidate", profile={"name": "Alice A"}),
        BOB: env.user(BOB, "candidate", profile={"name": "Bob B"}),
        CAROL: env.user(CAROL, "candidate", profile={"name": "Carol C"}),
    }
    env.h = h
    return env


def request_match(env, who, private=False):
    r = env.client.post("/candidate/peer-matchmaking/request", json={"keep_private": private}, headers=env.h[who])
    assert r.status_code == 200, r.text
    return r.json()


def pair(env, a=ALICE, b=BOB, a_private=False, b_private=False):
    request_match(env, a, a_private)
    mb = request_match(env, b, b_private)
    ma = request_match(env, a, a_private)
    return ma, mb


# ── 1. a matched ticket must end, so people can be matched again ─────────────
def test_ending_a_session_lets_both_people_match_again(peer):
    ma, mb = pair(peer)
    assert ma["room_id"] == mb["room_id"]
    r = peer.client.post("/candidate/peer-matchmaking/end", headers=peer.h[ALICE])
    assert r.status_code == 204
    statuses = {t["student_id"]: t["status"] for t in peer.db.rows("peer_matchmaking_tickets")}
    assert statuses == {ALICE: "completed", BOB: "completed"}
    again = request_match(peer, ALICE)
    assert again["status"] == "waiting" and again["room_id"] is None


def test_stale_matched_ticket_does_not_hand_back_the_old_room(peer):
    ma, _ = pair(peer)
    for t in peer.db.rows("peer_matchmaking_tickets"):
        t["matched_at"] = _iso(_now() - timedelta(minutes=31))
    again = request_match(peer, ALICE)
    assert again["status"] == "waiting"
    assert again["room_id"] != ma["room_id"]


def test_ending_requires_being_matched_and_is_idempotent(peer):
    assert peer.client.post("/candidate/peer-matchmaking/end", headers=peer.h[ALICE]).status_code == 204
    pair(peer)
    assert peer.client.post("/candidate/peer-matchmaking/end", headers=peer.h[ALICE]).status_code == 204
    assert peer.client.post("/candidate/peer-matchmaking/end", headers=peer.h[ALICE]).status_code == 204


def test_the_final_report_closes_the_matchmaking_tickets(peer):
    ma, _ = pair(peer)
    r = post_report(peer, ma["room_id"], ALICE, BOB)
    assert r.status_code == 201
    assert {t["status"] for t in peer.db.rows("peer_matchmaking_tickets")} == {"completed"}


# ── 2. privacy ───────────────────────────────────────────────────────────────
def test_private_peer_is_anonymous_to_the_person_who_was_waiting(peer):
    request_match(peer, ALICE)  # Alice waits (public)
    mb = request_match(peer, BOB, private=True)  # Bob claims her (private)
    ma = request_match(peer, ALICE)  # Alice polls and sees she is matched
    assert ma["partner_name"] == "Anonymous Candidate"
    assert mb["partner_name"] == "Alice A"  # Alice is public, Bob may see her


def test_private_waiter_is_anonymous_to_the_person_who_claims_them(peer):
    request_match(peer, ALICE, private=True)
    mb = request_match(peer, BOB)
    assert mb["partner_name"] == "Anonymous Candidate"


def test_email_is_never_used_as_a_display_name(peer):
    uid = "nm"
    peer.h[uid] = peer.user(uid, "candidate", email="private.address@mail.com")
    request_match(peer, ALICE)
    mine = request_match(peer, uid)
    assert "private.address" not in json.dumps(mine)
    claims = jwt.decode(mine["token"], SECRET, algorithms=["HS256"], audience="peermeet")
    assert "@" not in claims["name"]
    # and the partner (Alice) never sees an email either
    ma = request_match(peer, ALICE)
    assert "@" not in (ma["partner_name"] or "")


def test_peer_reports_hide_a_partner_who_chose_privacy(peer):
    ma, _ = pair(peer)
    post_report(peer, ma["room_id"], ALICE, BOB, partner_private=True)
    post_report(peer, ma["room_id"], BOB, ALICE, partner_private=False)
    a = peer.client.get("/candidate/peer-reports", headers=peer.h[ALICE]).json()
    b = peer.client.get("/candidate/peer-reports", headers=peer.h[BOB]).json()
    assert a[0]["partner_display_name"] == "Anonymous Candidate"
    assert b[0]["partner_display_name"] == "Alice A"


def test_reports_with_unknown_partner_privacy_default_to_anonymous(peer):
    ma, _ = pair(peer)
    post_report(peer, ma["room_id"], ALICE, BOB, partner_private=None)
    a = peer.client.get("/candidate/peer-reports", headers=peer.h[ALICE]).json()
    assert a[0]["partner_display_name"] == "Anonymous Candidate"


# ── 3. rooms and tokens ──────────────────────────────────────────────────────
def _meeting(peer, who=ALICE, **over):
    body = {"scheduled_at": _iso(_now() + timedelta(minutes=2)), "duration_minutes": 30, "keep_private": False, **over}
    r = peer.client.post("/candidate/peer-meetings", json=body, headers=peer.h[who])
    assert r.status_code == 201, r.text
    return r.json()


def test_public_upcoming_list_does_not_expose_room_ids(peer):
    m = _meeting(peer)
    rows = peer.client.get("/candidate/peer-meetings/upcoming", headers=peer.h[BOB]).json()
    assert rows and all("room_id" not in r for r in rows)
    assert m["room_id"] not in json.dumps(rows)


def test_session_token_needs_a_room_the_caller_may_enter(peer):
    ma, mb = pair(peer)
    ok = peer.client.post("/candidate/peer-session-token", json={"room_id": ma["room_id"]}, headers=peer.h[ALICE])
    assert ok.status_code == 200
    claims = jwt.decode(ok.json()["token"], SECRET, algorithms=["HS256"], audience="peermeet")
    assert claims["room"] == ma["room_id"] and claims["student_id"] == ALICE and claims["jti"]
    # a stranger holding the room id cannot get a token for it
    no = peer.client.post("/candidate/peer-session-token", json={"room_id": ma["room_id"]}, headers=peer.h[CAROL])
    assert no.status_code == 403
    # and a room id that exists nowhere is refused too
    assert peer.client.post("/candidate/peer-session-token", json={"room_id": "deadbeef0000"},
                            headers=peer.h[ALICE]).status_code == 403
    # no room at all is refused
    assert peer.client.post("/candidate/peer-session-token", headers=peer.h[ALICE]).status_code == 422


def test_session_token_for_invite_only_room_is_limited_to_creator_and_invitee(peer):
    m = _meeting(peer, invitee_email="bob@" + "test.dev")
    assert m["invitee_id"] == BOB
    for who, code in ((ALICE, 200), (BOB, 200), (CAROL, 403)):
        r = peer.client.post("/candidate/peer-session-token", json={"room_id": m["room_id"]}, headers=peer.h[who])
        assert r.status_code == code, (who, r.text)


def test_tokens_from_matchmaking_and_join_are_bound_to_their_room(peer):
    ma, _ = pair(peer)
    claims = jwt.decode(ma["token"], SECRET, algorithms=["HS256"], audience="peermeet")
    assert claims["room"] == ma["room_id"]
    m = _meeting(peer)
    j = peer.client.post(f"/candidate/peer-meetings/{m['id']}/join", headers=peer.h[ALICE]).json()
    jc = jwt.decode(j["token"], SECRET, algorithms=["HS256"], audience="peermeet")
    assert jc["room"] == m["room_id"]


def test_token_secret_can_differ_from_the_webhook_secret(peer, monkeypatch):
    monkeypatch.setenv("PEERMEET_TOKEN_SECRET", "token-only-secret")
    ma, _ = pair(peer)
    jwt.decode(ma["token"], "token-only-secret", algorithms=["HS256"], audience="peermeet")
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(ma["token"], SECRET, algorithms=["HS256"], audience="peermeet")


# ── 4. unregistered invitee email must not silently create an open meeting ───
def test_unknown_invitee_email_is_refused(peer):
    r = peer.client.post("/candidate/peer-meetings", headers=peer.h[ALICE], json={
        "scheduled_at": _iso(_now() + timedelta(minutes=5)), "duration_minutes": 30,
        "keep_private": False, "invitee_email": "nobody@nowhere.dev"})
    assert r.status_code == 422
    assert "account" in r.json()["detail"].lower()
    assert peer.db.rows("peer_scheduled_meetings") == []


def test_blank_invitee_still_creates_an_open_meeting(peer):
    m = _meeting(peer)
    assert m["invitee_id"] is None


# ── 5. webhook: idempotent, validated, phase-aware, signed ───────────────────
def post_report(env, room, student, partner, *, role="candidate", phase=1, final=True, unavailable=False,
                partner_private=True, headers=None, raw=None):
    body = {
        "room_id": room, "student_id": student, "partner_student_id": partner, "role": role,
        "phase": phase, "final": final, "unavailable": unavailable, "partner_private": partner_private,
        "report": {"overall_score": 71, "strengths": ["clear"], "topics_covered": ["sql"]},
    }
    data = raw if raw is not None else json.dumps(body)
    h = headers if headers is not None else {"Authorization": f"Bearer {SECRET}"}
    return env.client.post("/internal/peer-reports", content=data, headers={"Content-Type": "application/json", **h})


def test_a_retried_report_does_not_create_a_duplicate(peer):
    ma, _ = pair(peer)
    assert post_report(peer, ma["room_id"], ALICE, BOB).status_code == 201
    assert post_report(peer, ma["room_id"], ALICE, BOB).status_code == 201
    assert len(peer.db.rows("peer_interview_reports", student_id=ALICE)) == 1


def test_a_second_phase_is_a_separate_report(peer):
    ma, _ = pair(peer)
    post_report(peer, ma["room_id"], ALICE, BOB, phase=1, final=False)
    post_report(peer, ma["room_id"], ALICE, BOB, phase=2, final=True)
    assert len(peer.db.rows("peer_interview_reports", student_id=ALICE)) == 2


def test_unknown_students_are_refused_not_500(peer):
    r = post_report(peer, "room", "ghost-student", None)
    assert r.status_code == 422
    r2 = post_report(peer, "room", ALICE, "ghost-partner")
    assert r2.status_code == 422


def test_role_switch_report_does_not_complete_the_meeting_but_the_final_one_does(peer):
    m = _meeting(peer, invitee_email="bob@test.dev")
    peer.db.tables["peer_scheduled_meetings"][0]["status"] = "live"
    post_report(peer, m["room_id"], ALICE, BOB, phase=1, final=False)
    assert peer.db.one("peer_scheduled_meetings", id=m["id"])["status"] == "live"
    post_report(peer, m["room_id"], BOB, ALICE, phase=2, final=True)
    assert peer.db.one("peer_scheduled_meetings", id=m["id"])["status"] == "completed"


def _sign(body: str, ts: int, secret=SECRET):
    return hmac.new(secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()


def test_signed_webhook_is_accepted_and_tampering_or_replay_is_not(peer):
    ma, _ = pair(peer)
    body = json.dumps({"room_id": ma["room_id"], "student_id": ALICE, "partner_student_id": BOB,
                       "role": "candidate", "report": {"overall_score": 50}})
    ts = int(time.time())
    good = {"Authorization": f"Bearer {SECRET}", "X-Peer-Timestamp": str(ts), "X-Peer-Signature": _sign(body, ts)}
    assert post_report(peer, "x", "x", None, headers=good, raw=body).status_code == 201
    bad = {**good, "X-Peer-Signature": _sign(body + " ", ts)}
    assert post_report(peer, "x", "x", None, headers=bad, raw=body).status_code == 401
    old = int(time.time()) - 3600
    stale = {"Authorization": f"Bearer {SECRET}", "X-Peer-Timestamp": str(old), "X-Peer-Signature": _sign(body, old)}
    assert post_report(peer, "x", "x", None, headers=stale, raw=body).status_code == 401


def test_signature_can_be_made_mandatory(peer, monkeypatch):
    monkeypatch.setenv("PEERMEET_REQUIRE_SIGNATURE", "1")
    ma, _ = pair(peer)
    assert post_report(peer, ma["room_id"], ALICE, BOB).status_code == 401


def test_webhook_secret_can_differ_from_the_token_secret(peer, monkeypatch):
    monkeypatch.setenv("PEERMEET_WEBHOOK_SECRET", "hook-only")
    ma, _ = pair(peer)
    assert post_report(peer, ma["room_id"], ALICE, BOB).status_code == 401  # old shared secret no longer works
    ok = post_report(peer, ma["room_id"], ALICE, BOB, headers={"Authorization": "Bearer hook-only"})
    assert ok.status_code == 201


# ── 7. heartbeat ─────────────────────────────────────────────────────────────
def test_a_waiting_ticket_from_a_closed_tab_is_not_matchable(peer):
    request_match(peer, ALICE)
    peer.db.tables["peer_matchmaking_tickets"][0]["last_seen_at"] = _iso(_now() - timedelta(minutes=2))
    mb = request_match(peer, BOB)
    assert mb["status"] == "waiting"  # Alice's ghost ticket was not used


def test_polling_refreshes_the_heartbeat(peer):
    request_match(peer, ALICE)
    t = peer.db.tables["peer_matchmaking_tickets"][0]
    t["last_seen_at"] = _iso(_now() - timedelta(seconds=25))
    request_match(peer, ALICE)
    assert datetime.fromisoformat(t["last_seen_at"]) > _now() - timedelta(seconds=5)
    assert request_match(peer, BOB)["status"] == "matched"


# ── 8. maintenance and cancel semantics ──────────────────────────────────────
def test_maintenance_expires_old_meetings_and_stale_tickets_and_needs_the_secret(peer):
    m = _meeting(peer)
    peer.db.tables["peer_scheduled_meetings"][0]["scheduled_at"] = _iso(_now() - timedelta(hours=5))
    live = _meeting(peer)
    peer.db.tables["peer_scheduled_meetings"][1]["scheduled_at"] = _iso(_now() - timedelta(minutes=5))
    pair(peer)
    for t in peer.db.rows("peer_matchmaking_tickets"):
        t["matched_at"] = _iso(_now() - timedelta(minutes=45))
    assert peer.client.post("/internal/peer/maintenance").status_code == 401
    r = peer.client.post("/internal/peer/maintenance", headers={"Authorization": f"Bearer {SECRET}"})
    assert r.status_code == 200
    assert peer.db.one("peer_scheduled_meetings", id=m["id"])["status"] == "expired"
    assert peer.db.one("peer_scheduled_meetings", id=live["id"])["status"] == "scheduled"  # still inside its window
    assert {t["status"] for t in peer.db.rows("peer_matchmaking_tickets")} == {"expired"}
    assert r.json()["meetings_expired"] == 1 and r.json()["tickets_expired"] == 2


def test_cancelling_after_someone_joined_is_refused_not_silent(peer):
    m = _meeting(peer)
    peer.db.tables["peer_scheduled_meetings"][0]["status"] = "waiting"
    r = peer.client.delete(f"/candidate/peer-meetings/{m['id']}", headers=peer.h[ALICE])
    assert r.status_code == 409
    assert peer.db.one("peer_scheduled_meetings", id=m["id"])["status"] == "waiting"


def test_cancelling_a_scheduled_meeting_still_works(peer):
    m = _meeting(peer)
    assert peer.client.delete(f"/candidate/peer-meetings/{m['id']}", headers=peer.h[ALICE]).status_code == 204
    assert peer.db.one("peer_scheduled_meetings", id=m["id"])["status"] == "cancelled"
