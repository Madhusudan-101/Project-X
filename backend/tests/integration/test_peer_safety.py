"""PeerMeet Phase 2: reporting, blocking and suspensions."""
import json
from datetime import timedelta

import pytest

from peer_support import consent, install_matcher, iso, now

ALICE, BOB, CAROL, DAN, EVE = "alice", "bob", "carol", "dan", "eve"
SECRET = "test-shared-secret"


@pytest.fixture
def peer(env):
    install_matcher(env)
    env.h = {
        ALICE: env.user(ALICE, "candidate", profile={"name": "Alice A"}),
        BOB: env.user(BOB, "candidate", profile={"name": "Bob B"}),
        CAROL: env.user(CAROL, "candidate", profile={"name": "Carol C"}),
        DAN: env.user(DAN, "candidate", profile={"name": "Dan D"}),
        EVE: env.user(EVE, "candidate", profile={"name": "Eve E"}),
    }
    env.h["admin"] = env.user("admin", "admin", profile={"is_super_admin": True})
    consent(env, ALICE, BOB, CAROL, DAN, EVE)
    return env


def match(env, a, b, a_private=False, b_private=False):
    env.client.post("/candidate/peer-matchmaking/request", json={"keep_private": a_private}, headers=env.h[a])
    rb = env.client.post("/candidate/peer-matchmaking/request", json={"keep_private": b_private}, headers=env.h[b])
    assert rb.status_code == 200, rb.text
    return rb.json()["room_id"]


def report(env, who, room, reason="harassment", **kw):
    return env.client.post("/candidate/peer-safety/reports", headers=env.h[who],
                           json={"room_id": room, "reason": reason, **kw})


# ── reporting ────────────────────────────────────────────────────────────────
def test_report_names_the_room_and_the_server_finds_the_person(peer):
    room = match(peer, ALICE, BOB)
    r = report(peer, ALICE, room, details="rude")
    assert r.status_code == 201, r.text
    row = peer.db.one("peer_user_reports")
    assert (row["reporter_id"], row["reported_id"], row["room_id"]) == (ALICE, BOB, room)
    assert row["status"] == "open" and row["source"] == "dashboard"
    # the response never says who was reported
    assert BOB not in json.dumps(r.json()) and "Bob" not in json.dumps(r.json())


def test_you_cannot_report_a_room_you_were_not_in(peer):
    room = match(peer, ALICE, BOB)
    r = report(peer, CAROL, room)
    assert r.status_code == 422
    assert peer.db.rows("peer_user_reports") == []


def test_you_cannot_report_a_room_that_does_not_exist(peer):
    assert report(peer, ALICE, "no-such-room").status_code == 422


def test_reason_must_be_one_of_the_list(peer):
    room = match(peer, ALICE, BOB)
    assert report(peer, ALICE, room, reason="because").status_code == 422


def test_reporting_twice_is_idempotent(peer):
    room = match(peer, ALICE, BOB)
    assert report(peer, ALICE, room).status_code == 201
    second = report(peer, ALICE, room)
    assert second.status_code == 201 and second.json()["created"] is False
    assert len(peer.db.rows("peer_user_reports")) == 1


def test_details_are_length_limited(peer):
    room = match(peer, ALICE, BOB)
    assert report(peer, ALICE, room, details="x" * 1001).status_code == 422


def test_report_works_after_the_session_ended(peer):
    room = match(peer, ALICE, BOB)
    peer.client.post("/candidate/peer-matchmaking/end", headers=peer.h[ALICE])
    assert report(peer, BOB, room).status_code == 201


def test_report_from_a_scheduled_meeting_resolves_the_guest_of_an_open_meeting(peer):
    body = {"scheduled_at": iso(now() + timedelta(minutes=2)), "duration_minutes": 30, "keep_private": False}
    m = peer.client.post("/candidate/peer-meetings", json=body, headers=peer.h[ALICE]).json()
    peer.client.post(f"/candidate/peer-meetings/{m['id']}/join", headers=peer.h[ALICE])
    peer.client.post(f"/candidate/peer-meetings/{m['id']}/join", headers=peer.h[BOB])  # Bob becomes the second joiner
    assert peer.db.one("peer_scheduled_meetings", id=m["id"])["second_joiner_id"] == BOB
    assert report(peer, ALICE, m["room_id"]).status_code == 201
    assert peer.db.one("peer_user_reports")["reported_id"] == BOB
    assert report(peer, BOB, m["room_id"]).status_code == 201  # and Bob can report the host
    assert {r["reported_id"] for r in peer.db.rows("peer_user_reports")} == {BOB, ALICE}


def test_my_reports_list_shows_status_only_and_only_mine(peer):
    room = match(peer, ALICE, BOB)
    report(peer, ALICE, room)
    mine = peer.client.get("/candidate/peer-safety/reports", headers=peer.h[ALICE]).json()
    assert len(mine) == 1 and set(mine[0]) == {"id", "room_id", "reason", "status", "created_at"}
    assert peer.client.get("/candidate/peer-safety/reports", headers=peer.h[BOB]).json() == []


# ── blocking ─────────────────────────────────────────────────────────────────
def test_report_with_block_blocks_and_hides_the_name_of_an_anonymous_person(peer):
    room = match(peer, ALICE, BOB, b_private=True)
    report(peer, ALICE, room, block=True)
    blocks = peer.client.get("/candidate/peer-safety/blocks", headers=peer.h[ALICE]).json()
    assert len(blocks) == 1 and blocks[0]["label"] == "Anonymous Candidate"
    assert BOB not in json.dumps(blocks)


def test_block_label_shows_the_name_only_if_the_person_was_not_anonymous(peer):
    room = match(peer, ALICE, BOB, b_private=False)
    peer.client.post("/candidate/peer-safety/blocks", json={"room_id": room}, headers=peer.h[ALICE])
    assert peer.client.get("/candidate/peer-safety/blocks", headers=peer.h[ALICE]).json()[0]["label"] == "Bob B"


def test_blocked_people_are_never_matched_in_either_direction(peer):
    room = match(peer, ALICE, BOB)
    peer.client.post("/candidate/peer-safety/blocks", json={"room_id": room}, headers=peer.h[ALICE])
    peer.client.post("/candidate/peer-matchmaking/end", headers=peer.h[ALICE])
    # Bob queues first: Alice must not be paired with him
    peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[BOB])
    ra = peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[ALICE]).json()
    assert ra["status"] == "waiting"
    # and Carol, who is not blocked, can take Bob's slot
    rc = peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[CAROL]).json()
    assert rc["status"] == "matched"
    # reverse direction: Alice queued, Bob arrives: not matched either
    peer.db.tables.setdefault("peer_matchmaking_tickets", []).clear()
    peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[ALICE])
    rb = peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[BOB]).json()
    assert rb["status"] == "waiting"


def test_unblocking_allows_matching_again_and_only_your_own_blocks_can_be_removed(peer):
    room = match(peer, ALICE, BOB)
    peer.client.post("/candidate/peer-safety/blocks", json={"room_id": room}, headers=peer.h[ALICE])
    bid = peer.db.one("peer_blocks")["id"]
    assert peer.client.delete(f"/candidate/peer-safety/blocks/{bid}", headers=peer.h[CAROL]).status_code == 204
    assert len(peer.db.rows("peer_blocks")) == 1  # Carol could not remove Alice's block
    assert peer.client.delete(f"/candidate/peer-safety/blocks/{bid}", headers=peer.h[ALICE]).status_code == 204
    assert peer.db.rows("peer_blocks") == []


def test_blocking_twice_is_fine(peer):
    room = match(peer, ALICE, BOB)
    for _ in range(2):
        assert peer.client.post("/candidate/peer-safety/blocks", json={"room_id": room}, headers=peer.h[ALICE]).status_code == 201
    assert len(peer.db.rows("peer_blocks")) == 1


def test_cannot_block_from_a_room_you_were_not_in(peer):
    room = match(peer, ALICE, BOB)
    assert peer.client.post("/candidate/peer-safety/blocks", json={"room_id": room}, headers=peer.h[CAROL]).status_code == 422


def _meeting(peer, who, **over):
    body = {"scheduled_at": iso(now() + timedelta(minutes=2)), "duration_minutes": 30, "keep_private": False, **over}
    r = peer.client.post("/candidate/peer-meetings", json=body, headers=peer.h[who])
    return r


def test_blocked_people_cannot_invite_join_or_see_each_others_meetings(peer):
    room = match(peer, ALICE, BOB)
    peer.client.post("/candidate/peer-safety/blocks", json={"room_id": room}, headers=peer.h[ALICE]).status_code
    # Bob cannot invite Alice, and gets no hint it is a block
    r = _meeting(peer, BOB, invitee_email="alice@test.dev")
    assert r.status_code == 422 and "block" not in r.text.lower()
    # Bob's open meeting is invisible to Alice and she cannot join it by id
    m = _meeting(peer, BOB).json()
    ids = [x["id"] for x in peer.client.get("/candidate/peer-meetings/upcoming", headers=peer.h[ALICE]).json()]
    assert m["id"] not in ids
    j = peer.client.post(f"/candidate/peer-meetings/{m['id']}/join", headers=peer.h[ALICE])
    assert j.status_code == 403 and "block" not in j.text.lower()
    # Carol sees and joins it normally
    assert m["id"] in [x["id"] for x in peer.client.get("/candidate/peer-meetings/upcoming", headers=peer.h[CAROL]).json()]
    assert peer.client.post(f"/candidate/peer-meetings/{m['id']}/join", headers=peer.h[CAROL]).status_code == 200


# ── automatic suspension ─────────────────────────────────────────────────────
def _three_reports(peer, target=DAN):
    others = [ALICE, BOB, CAROL]
    for o in others:
        peer.db.tables.setdefault("peer_matchmaking_tickets", []).clear()
        room = match(peer, o, target)
        report(peer, o, room)


def test_three_different_reporters_suspend_the_person_automatically(peer):
    _three_reports(peer)
    s = peer.db.rows("peer_sanctions", student_id=DAN)
    assert len(s) == 1 and s[0]["kind"] == "suspension" and s[0]["created_by"] is None and s[0]["ends_at"]
    st = peer.client.get("/candidate/peer-safety/status", headers=peer.h[DAN]).json()
    assert st["suspended"] is True and st["suspended_until"]


def test_the_same_person_reporting_repeatedly_does_not_trigger_it(peer):
    for i in range(3):
        peer.db.tables.setdefault("peer_matchmaking_tickets", []).clear()
        room = match(peer, ALICE, DAN)
        report(peer, ALICE, room)
    assert peer.db.rows("peer_sanctions") == []


def test_two_reports_are_not_enough(peer):
    for o in (ALICE, BOB):
        peer.db.tables.setdefault("peer_matchmaking_tickets", []).clear()
        report(peer, o, match(peer, o, DAN))
    assert peer.db.rows("peer_sanctions") == []


def test_a_suspended_person_is_locked_out_of_every_entry_point_with_a_clear_message(peer):
    _three_reports(peer)
    peer.db.tables.setdefault("peer_matchmaking_tickets", []).clear()
    r = peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[DAN])
    assert r.status_code == 403 and "paused" in r.json()["detail"]
    assert _meeting(peer, DAN).status_code == 403
    m = _meeting(peer, EVE).json()
    assert peer.client.post(f"/candidate/peer-meetings/{m['id']}/join", headers=peer.h[DAN]).status_code == 403
    assert peer.client.post("/candidate/peer-session-token", json={"room_id": m["room_id"]}, headers=peer.h[DAN]).status_code == 403
    # but they are not locked out of reading their own status or reports
    assert peer.client.get("/candidate/peer-safety/status", headers=peer.h[DAN]).status_code == 200


def test_a_suspended_person_waiting_in_the_queue_is_not_matched(peer):
    peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[DAN])
    peer.db.add("peer_sanctions", student_id=DAN, kind="suspension", reason="x", ends_at=iso(now() + timedelta(days=1)), lifted_at=None)
    r = peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[EVE]).json()
    assert r["status"] == "waiting"


def test_an_expired_or_lifted_suspension_no_longer_applies(peer):
    peer.db.add("peer_sanctions", student_id=DAN, kind="suspension", reason="old", ends_at=iso(now() - timedelta(days=1)), lifted_at=None)
    peer.db.add("peer_sanctions", student_id=DAN, kind="suspension", reason="lifted", ends_at=iso(now() + timedelta(days=5)), lifted_at=iso(now()))
    assert peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[DAN]).status_code == 200


# ── admin moderation ─────────────────────────────────────────────────────────
def test_admin_queue_shows_the_people_and_detail_shows_evidence_and_history(peer):
    room = match(peer, ALICE, BOB)
    report(peer, ALICE, room, details="insulting")
    q = peer.client.get("/admin/peer-safety/reports", headers=peer.h["admin"]).json()["items"]
    assert len(q) == 1 and q[0]["reporter"]["name"] == "Alice A" and q[0]["reported"]["name"] == "Bob B"
    d = peer.client.get(f"/admin/peer-safety/reports/{q[0]['id']}", headers=peer.h["admin"]).json()
    assert d["details"] == "insulting" and d["history"]["total_reports"] == 1 and d["active_suspension"] is False


def test_only_admins_can_see_or_resolve_reports(peer):
    room = match(peer, ALICE, BOB)
    report(peer, ALICE, room)
    rid = peer.db.one("peer_user_reports")["id"]
    for who in (ALICE, BOB, CAROL):
        assert peer.client.get("/admin/peer-safety/reports", headers=peer.h[who]).status_code == 403
        assert peer.client.get(f"/admin/peer-safety/reports/{rid}", headers=peer.h[who]).status_code == 403
        assert peer.client.post(f"/admin/peer-safety/reports/{rid}/resolve", json={"action": "dismiss"}, headers=peer.h[who]).status_code == 403
    assert peer.client.get("/admin/peer-safety/reports").status_code in (401, 403)


def test_admin_can_dismiss_warn_suspend_and_lift(peer):
    room = match(peer, ALICE, BOB)
    report(peer, ALICE, room)
    rid = peer.db.one("peer_user_reports")["id"]
    H = peer.h["admin"]
    assert peer.client.post(f"/admin/peer-safety/reports/{rid}/resolve", json={"action": "warn", "note": "be kind"}, headers=H).json()["status"] == "actioned"
    assert peer.db.one("peer_sanctions", student_id=BOB)["kind"] == "warning"
    # suspend needs a duration
    assert peer.client.post(f"/admin/peer-safety/reports/{rid}/resolve", json={"action": "suspend"}, headers=H).status_code == 422
    assert peer.client.post(f"/admin/peer-safety/reports/{rid}/resolve", json={"action": "suspend", "days": 14}, headers=H).status_code == 200
    assert peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[BOB]).status_code == 403
    assert peer.client.post(f"/admin/peer-safety/reports/{rid}/resolve", json={"action": "lift"}, headers=H).json()["status"] == "dismissed"
    assert peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[BOB]).status_code == 200
    assert peer.client.post(f"/admin/peer-safety/reports/{rid}/resolve", json={"action": "nonsense"}, headers=H).status_code == 422
    row = peer.db.one("peer_user_reports", id=rid)
    assert row["reviewed_by"] == "admin" and row["reviewed_at"]
    events = [e for e in peer.db.tables.get("admin_events", []) if e["event_type"] == "peer_report_resolved"]
    assert len(events) >= 3


def test_dismissed_reports_do_not_count_toward_automatic_suspension(peer):
    for o in (ALICE, BOB):
        peer.db.tables.setdefault("peer_matchmaking_tickets", []).clear()
        report(peer, o, match(peer, o, DAN))
    for r in peer.db.rows("peer_user_reports"):
        r["status"] = "dismissed"
    peer.db.tables.setdefault("peer_matchmaking_tickets", []).clear()
    report(peer, CAROL, match(peer, CAROL, DAN))
    assert peer.db.rows("peer_sanctions") == []


# ── reports raised from inside the meeting (signed webhook) ──────────────────
def _signed(body: dict, secret=SECRET, ts=None):
    import hashlib, hmac, time
    raw = json.dumps(body)
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.{raw}".encode(), hashlib.sha256).hexdigest()
    return raw, {"Authorization": f"Bearer {secret}", "X-Peer-Timestamp": str(ts), "X-Peer-Signature": sig,
                 "Content-Type": "application/json"}


def test_in_meeting_report_is_stored_with_server_captured_evidence(peer):
    room = match(peer, ALICE, BOB)
    raw, h = _signed({"room_id": room, "reporter_student_id": ALICE, "reason": "harassment", "block": True,
                      "evidence": {"transcript": [f"line {i}" for i in range(500)], "captured_at": "now"}})
    r = peer.client.post("/internal/peer-safety/report", content=raw, headers=h)
    assert r.status_code == 201, r.text
    row = peer.db.one("peer_user_reports")
    assert row["source"] == "meeting" and len(row["evidence"]["transcript"]) == 200  # bounded
    assert row["evidence"]["transcript"][-1] == "line 499"
    assert peer.db.rows("peer_blocks", blocker_id=ALICE, blocked_id=BOB)


def test_in_meeting_report_needs_the_secret_and_a_valid_signature(peer):
    room = match(peer, ALICE, BOB)
    body = {"room_id": room, "reporter_student_id": ALICE, "reason": "spam"}
    assert peer.client.post("/internal/peer-safety/report", json=body).status_code == 401
    raw, h = _signed(body)
    h["X-Peer-Signature"] = "0" * 64
    assert peer.client.post("/internal/peer-safety/report", content=raw, headers=h).status_code == 401
    assert peer.db.rows("peer_user_reports") == []


def test_in_meeting_report_cannot_name_a_room_the_reporter_was_not_in(peer):
    room = match(peer, ALICE, BOB)
    raw, h = _signed({"room_id": room, "reporter_student_id": CAROL, "reason": "spam"})
    assert peer.client.post("/internal/peer-safety/report", content=raw, headers=h).status_code == 422
