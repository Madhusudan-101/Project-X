"""PeerMeet pre-call: per-session consent, manual and automatic no-shows, onboarding flag, report reasons."""
import hashlib
import hmac
import json
import time
from datetime import timedelta

import pytest

from app.services import peer_notify
from app.services.peer_precall import SESSION_CONSENT_VERSION
from peer_support import consent, install_matcher, iso, now

ALICE, BOB, CAROL = "alice", "bob", "carol"
SECRET = "test-shared-secret"


def signed(body: dict, secret=SECRET):
    raw = json.dumps(body)
    ts = int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.{raw}".encode(), hashlib.sha256).hexdigest()
    return raw, {"Authorization": f"Bearer {secret}", "X-Peer-Timestamp": str(ts), "X-Peer-Signature": sig,
                 "Content-Type": "application/json"}


@pytest.fixture
def peer(env, monkeypatch):
    install_matcher(env)
    env.db.add("colleges", id="col-1", name="Alpha College")
    env.h = {
        ALICE: env.user(ALICE, "candidate", profile={"name": "Alice Archer", "first_name": "Alice", "branch": "CSE", "college_id": "col-1"}),
        BOB: env.user(BOB, "candidate", profile={"name": "Bob Brown", "first_name": "Bob"}),
        CAROL: env.user(CAROL, "candidate", profile={"name": "Carol C", "first_name": "Carol"}),
    }
    consent(env, ALICE, BOB, CAROL)
    monkeypatch.setattr(peer_notify, "send_email", lambda *a, **k: "sent")
    return env


def post(peer, path, body, **kw):
    raw, h = signed(body, **kw)
    return peer.client.post(path, content=raw, headers=h)


def match(peer, a=ALICE, b=BOB):
    peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[a])
    return peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[b]).json()["room_id"]


def answer(peer, room, who, yes, version=SESSION_CONSENT_VERSION):
    return post(peer, "/internal/peer/session-consent", {"room_id": room, "student_id": who, "answer": yes, "version": version})


def check(peer, room, *ids):
    return post(peer, "/internal/peer/session-consent/check", {"room_id": room, "student_ids": list(ids)}).json()


# ── consent ──────────────────────────────────────────────────────────────────
def test_a_yes_is_stored_with_person_session_answer_time_and_wording_version(peer):
    room = match(peer)
    assert answer(peer, room, ALICE, True).status_code == 200
    row = peer.db.one("peer_session_consents", student_id=ALICE, room_id=room)
    assert row["answer"] is True and row["consent_version"] == SESSION_CONSENT_VERSION and row["answered_at"]


def test_a_no_is_stored_and_never_counts_as_yes(peer):
    room = match(peer)
    answer(peer, room, ALICE, True)
    answer(peer, room, BOB, False)
    assert peer.db.one("peer_session_consents", student_id=BOB)["answer"] is False
    assert check(peer, room, ALICE, BOB) == {"all_yes": False, "missing": [BOB]}


def test_recording_is_allowed_only_when_both_have_a_stored_yes(peer):
    room = match(peer)
    assert check(peer, room, ALICE, BOB)["all_yes"] is False       # nobody answered
    answer(peer, room, ALICE, True)
    assert check(peer, room, ALICE, BOB)["all_yes"] is False       # only one
    answer(peer, room, BOB, True)
    assert check(peer, room, ALICE, BOB) == {"all_yes": True, "missing": []}


def test_a_yes_for_old_wording_does_not_count(peer):
    room = match(peer)
    assert answer(peer, room, ALICE, True, version="old").status_code == 409
    answer(peer, room, ALICE, True)
    answer(peer, room, BOB, True)
    peer.db.one("peer_session_consents", student_id=BOB)["consent_version"] = "old"
    assert check(peer, room, ALICE, BOB)["all_yes"] is False


def test_a_yes_in_one_session_does_not_cover_another_session(peer):
    first = match(peer)
    answer(peer, first, ALICE, True)
    answer(peer, first, BOB, True)
    peer.db.tables["peer_matchmaking_tickets"].clear()
    second = match(peer)
    assert second != first and check(peer, second, ALICE, BOB)["all_yes"] is False


def test_only_people_in_the_session_can_have_consent_recorded(peer):
    room = match(peer)
    assert answer(peer, room, CAROL, True).status_code == 403
    assert peer.db.rows("peer_session_consents") == []


def test_consent_endpoints_are_not_open_to_browsers(peer):
    room = match(peer)
    body = {"room_id": room, "student_id": ALICE, "answer": True, "version": SESSION_CONSENT_VERSION}
    assert peer.client.post("/internal/peer/session-consent", json=body).status_code == 401
    assert peer.client.post("/internal/peer/session-consent", json=body, headers=peer.h[ALICE]).status_code == 401
    assert answer_bad_sig(peer, room).status_code == 401
    assert peer.db.rows("peer_session_consents") == []


def answer_bad_sig(peer, room):
    raw, h = signed({"room_id": room, "student_id": ALICE, "answer": True, "version": SESSION_CONSENT_VERSION})
    h["X-Peer-Signature"] = "0" * 64
    return peer.client.post("/internal/peer/session-consent", content=raw, headers=h)


# ── onboarding flag ──────────────────────────────────────────────────────────
def test_the_interviewer_message_is_shown_until_it_is_dismissed_and_then_never_again(peer):
    status = lambda who: post(peer, "/internal/peer/onboarding/status", {"student_id": who}).json()["seen"]
    assert status(ALICE) is False
    assert post(peer, "/internal/peer/onboarding/seen", {"student_id": ALICE}).status_code == 200
    assert status(ALICE) is True          # persisted in the database, so any device or session sees it
    assert status(BOB) is False           # per person
    first = peer.db.one("peer_user_flags", student_id=ALICE)["interviewer_onboarding_seen_at"]
    post(peer, "/internal/peer/onboarding/seen", {"student_id": ALICE})
    assert peer.db.one("peer_user_flags", student_id=ALICE)["interviewer_onboarding_seen_at"] == first
    assert len(peer.db.rows("peer_user_flags", student_id=ALICE)) == 1


def test_onboarding_flag_does_not_erase_the_no_show_count(peer):
    peer.db.add("peer_user_flags", student_id=ALICE, no_show_count=2)
    post(peer, "/internal/peer/onboarding/seen", {"student_id": ALICE})
    assert peer.db.one("peer_user_flags", student_id=ALICE)["no_show_count"] == 2


# ── no-show ──────────────────────────────────────────────────────────────────
def waiting_meeting(peer, started_minutes_ago, invitee=BOB, waiting=ALICE):
    body = {"scheduled_at": iso(now() + timedelta(minutes=2)), "duration_minutes": 30, "keep_private": False}
    if invitee:
        body["invitee_email"] = f"{invitee}@test.dev"
    m = peer.client.post("/candidate/peer-meetings", json=body, headers=peer.h[ALICE]).json()
    row = peer.db.one("peer_scheduled_meetings", id=m["id"])
    row.update(status="waiting", first_joiner_id=waiting, scheduled_at=iso(now() - timedelta(minutes=started_minutes_ago)))
    return row


def mark(peer, row, who=ALICE):
    return post(peer, "/internal/peer/no-show", {"room_id": row["room_id"], "reporter_student_id": who})


def test_the_waiting_person_can_mark_no_show_after_the_grace_window(peer):
    row = waiting_meeting(peer, started_minutes_ago=11)
    assert mark(peer, row).status_code == 200
    assert row["status"] == "no_show" and row["absent_id"] == BOB and row["no_show_at"]


def test_it_cannot_be_marked_before_the_grace_window_ends(peer):
    row = waiting_meeting(peer, started_minutes_ago=3)
    r = mark(peer, row)
    assert r.status_code == 409 and "wait" in r.json()["detail"].lower()
    assert row["status"] == "waiting" and row.get("absent_id") is None


def test_the_absent_persons_record_counts_one_and_only_one(peer):
    row = waiting_meeting(peer, started_minutes_ago=11)
    mark(peer, row)
    assert mark(peer, row).status_code == 200   # a second click is harmless
    assert peer.db.one("peer_user_flags", student_id=BOB)["no_show_count"] == 1
    assert peer.db.rows("peer_user_flags", student_id=ALICE) == []   # the waiting person is never marked


def test_a_second_no_show_adds_to_the_count_with_no_punishment(peer):
    peer.db.add("peer_user_flags", student_id=BOB, no_show_count=1)
    mark(peer, waiting_meeting(peer, started_minutes_ago=11))
    assert peer.db.one("peer_user_flags", student_id=BOB)["no_show_count"] == 2
    assert peer.db.rows("peer_sanctions") == []


def test_only_the_person_who_waited_can_mark_it(peer):
    row = waiting_meeting(peer, started_minutes_ago=11)
    assert mark(peer, row, who=BOB).status_code == 403
    assert mark(peer, row, who=CAROL).status_code == 403
    assert row["status"] == "waiting"


def test_a_meeting_the_partner_joined_cannot_be_called_a_no_show(peer):
    row = waiting_meeting(peer, started_minutes_ago=11)
    row["status"] = "live"
    assert mark(peer, row).status_code == 409
    assert peer.db.rows("peer_user_flags") == []


def test_an_open_meeting_records_no_one_as_absent(peer):
    row = waiting_meeting(peer, started_minutes_ago=11, invitee=None)
    assert mark(peer, row).status_code == 200
    assert row["status"] == "no_show" and row["absent_id"] is None
    assert peer.db.rows("peer_user_flags") == []


def test_a_no_show_makes_no_score_and_accepts_no_feedback_report(peer):
    row = waiting_meeting(peer, started_minutes_ago=11)
    mark(peer, row)
    report = {"room_id": row["room_id"], "student_id": ALICE, "partner_student_id": BOB, "role": "candidate",
              "report": {"overall_score": 70}, "phase": 1, "final": True}
    assert post(peer, "/internal/peer-reports", report).status_code == 409
    assert peer.db.rows("peer_interview_reports") == []


def test_the_scheduler_records_absent_and_count_too_and_only_once(peer):
    row = waiting_meeting(peer, started_minutes_ago=12)
    out = peer.client.post("/internal/peer/maintenance", headers={"Authorization": f"Bearer {SECRET}"}).json()
    assert out["no_shows"] == 1 and row["absent_id"] == BOB
    peer.client.post("/internal/peer/maintenance", headers={"Authorization": f"Bearer {SECRET}"})
    assert peer.db.one("peer_user_flags", student_id=BOB)["no_show_count"] == 1


def test_a_manual_mark_then_the_scheduler_does_not_double_count(peer):
    row = waiting_meeting(peer, started_minutes_ago=12)
    mark(peer, row)
    peer.client.post("/internal/peer/maintenance", headers={"Authorization": f"Bearer {SECRET}"})
    assert peer.db.one("peer_user_flags", student_id=BOB)["no_show_count"] == 1


def test_no_show_is_not_available_for_instant_matches(peer):
    room = match(peer)
    r = post(peer, "/internal/peer/no-show", {"room_id": room, "reporter_student_id": ALICE})
    assert r.status_code == 404


def test_the_absent_person_cannot_join_afterwards(peer):
    row = waiting_meeting(peer, started_minutes_ago=11)
    mark(peer, row)
    assert peer.client.post(f"/candidate/peer-meetings/{row['id']}/join", headers=peer.h[BOB]).status_code == 410


# ── report reasons and authorization ─────────────────────────────────────────
def report(peer, who, room, reason, **kw):
    return peer.client.post("/candidate/peer-safety/reports", headers=peer.h[who],
                            json={"room_id": room, "reason": reason, **kw})


@pytest.mark.parametrize("reason", ["inappropriate_content", "rude", "not_genuine_effort"])
def test_the_requested_reasons_are_accepted_and_stored_with_who_what_when(peer, reason):
    room = match(peer)
    r = report(peer, ALICE, room, reason, details="they kept interrupting")
    assert r.status_code == 201, r.text
    row = peer.db.one("peer_user_reports", room_id=room)
    assert (row["reporter_id"], row["reported_id"], row["reason"], row["details"]) == (ALICE, BOB, reason, "they kept interrupting")
    assert row["created_at"]


def test_other_is_accepted_with_free_text(peer):
    room = match(peer)
    assert report(peer, ALICE, room, "other", details="something else happened").status_code == 201


def test_other_without_text_is_refused(peer):
    room = match(peer)
    for details in ("", "   "):
        r = report(peer, ALICE, room, "other", details=details)
        assert r.status_code == 422 and "describe" in r.json()["detail"].lower()
    assert peer.db.rows("peer_user_reports") == []


def test_an_unknown_reason_is_refused(peer):
    assert report(peer, ALICE, match(peer), "dislike").status_code == 422


def test_you_cannot_report_a_session_you_were_not_in(peer):
    room = match(peer)
    assert report(peer, CAROL, room, "rude").status_code == 422
    assert peer.db.rows("peer_user_reports") == []


def test_reporting_does_not_end_the_session(peer):
    room = match(peer)
    report(peer, ALICE, room, "rude")
    tickets = peer.db.rows("peer_matchmaking_tickets", room_id=room)
    assert tickets and all(t["status"] == "matched" for t in tickets)   # the call is still open for both


# ── the Ready screen: what the partner is shown ──────────────────────────────
def test_the_partner_card_is_first_name_and_college_branch_only(peer):
    from app.services import peer_precall
    card = peer_precall.card_fields(ALICE)
    assert card == {"first_name": "Alice", "college_branch": "Alpha College, CSE"}
    assert peer_precall.card_fields(BOB) == {"first_name": "Bob", "college_branch": None}


def test_the_room_token_carries_the_card_but_no_surname_or_email(peer):
    import jwt
    room = match(peer)
    tok = peer.client.post("/candidate/peer-session-token", json={"room_id": room}, headers=peer.h[ALICE]).json()["token"]
    claims = jwt.decode(tok, SECRET, algorithms=["HS256"], audience="peermeet")
    assert claims["first_name"] == "Alice" and claims["college_branch"] == "Alpha College, CSE"
    assert "Archer" not in json.dumps({k: v for k, v in claims.items() if k != "name"})
    assert "@" not in json.dumps({k: v for k, v in claims.items() if k != "name"})


# ── answers too short to judge ───────────────────────────────────────────────
def test_an_insufficient_report_is_stored_as_such_without_scores(peer):
    room = match(peer)
    body = {"room_id": room, "student_id": ALICE, "partner_student_id": BOB, "role": "candidate",
            "report": {"suggestions": ["Your answer was too short to judge."]}, "phase": 1, "final": True, "insufficient": True}
    assert post(peer, "/internal/peer-reports", body).status_code == 201
    row = peer.db.one("peer_interview_reports", room_id=room)
    assert row["insufficient"] is True and row["overall_score"] is None
