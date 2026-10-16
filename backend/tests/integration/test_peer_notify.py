"""PeerMeet Phase 4: emails, reminders, no-shows and personal preferences."""
from datetime import datetime, timedelta, timezone

import pytest

from app.services import peer_notify
from peer_support import consent, install_matcher, iso, now

ALICE, BOB, CAROL = "alice", "bob", "carol"
SECRET = "test-shared-secret"
AUTH = {"Authorization": f"Bearer {SECRET}"}


@pytest.fixture
def peer(env, monkeypatch):
    install_matcher(env)
    env.h = {
        ALICE: env.user(ALICE, "candidate", profile={"name": "Alice A", "first_name": "Alice"}),
        BOB: env.user(BOB, "candidate", profile={"name": "Bob B", "first_name": "Bob"}),
        CAROL: env.user(CAROL, "candidate", profile={"name": "Carol C", "first_name": "Carol"}),
    }
    consent(env, ALICE, BOB, CAROL)
    env.mail = []
    env.mail_status = "sent"

    def fake_send(to, subject, body):
        env.mail.append({"to": to, "subject": subject, "body": body})
        return env.mail_status

    monkeypatch.setattr(peer_notify, "send_email", fake_send)
    return env


def book(peer, who=ALICE, minutes_ahead=120, invitee=None, created_hours_ago=0, **over):
    body = {"scheduled_at": iso(now() + timedelta(minutes=minutes_ahead)), "duration_minutes": 30, "keep_private": False, **over}
    if invitee:
        body["invitee_email"] = f"{invitee}@test.dev"
    r = peer.client.post("/candidate/peer-meetings", json=body, headers=peer.h[who])
    assert r.status_code == 201, r.text
    m = r.json()
    if created_hours_ago:
        peer.db.one("peer_scheduled_meetings", id=m["id"])["created_at"] = iso(now() - timedelta(hours=created_hours_ago))
    return m


def maintain(peer):
    r = peer.client.post("/internal/peer/maintenance", headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()


# ── invitations and cancellations ────────────────────────────────────────────
def test_the_invitee_is_emailed_when_a_meeting_is_booked_for_them(peer):
    m = book(peer, invitee=BOB)
    assert [x["to"] for x in peer.mail] == ["bob@test.dev"]
    assert "invited" in peer.mail[0]["subject"].lower()
    assert "Alice" in peer.mail[0]["body"] and "30 minutes" in peer.mail[0]["body"]
    assert peer.db.one("peer_scheduled_meetings", id=m["id"])["invited_emailed_at"]


def test_a_private_host_is_never_named_in_the_invitation(peer):
    book(peer, invitee=BOB, keep_private=True)
    assert "Alice" not in peer.mail[0]["body"] and "Mirracle candidate" in peer.mail[0]["body"]


def test_open_meetings_have_nobody_to_email(peer):
    book(peer)
    assert peer.mail == []


def test_the_time_is_shown_in_the_invitees_own_timezone(peer):
    peer.client.put("/candidate/peer-preferences", headers=peer.h[BOB], json={"timezone": "Asia/Kolkata"})
    book(peer, invitee=BOB)
    assert "Asia/Kolkata" in peer.mail[0]["body"]


def test_someone_who_turned_invitations_off_is_not_emailed(peer):
    peer.client.put("/candidate/peer-preferences", headers=peer.h[BOB], json={"email_invites": False})
    m = book(peer, invitee=BOB)
    assert peer.mail == []
    assert peer.db.one("peer_scheduled_meetings", id=m["id"]).get("invited_emailed_at") is None


def test_a_failing_email_provider_never_breaks_booking(peer):
    peer.mail_status = "failed"
    m = book(peer, invitee=BOB)
    assert m["invitee_id"] == BOB
    assert peer.db.one("peer_scheduled_meetings", id=m["id"]).get("invited_emailed_at") is None


def test_cancelling_tells_the_invitee_but_not_when_nobody_was_invited(peer):
    m = book(peer, invitee=BOB)
    peer.mail.clear()
    assert peer.client.delete(f"/candidate/peer-meetings/{m['id']}", headers=peer.h[ALICE]).status_code == 204
    assert [x["to"] for x in peer.mail] == ["bob@test.dev"] and "cancelled" in peer.mail[0]["subject"].lower()
    open_m = book(peer)
    peer.mail.clear()
    peer.client.delete(f"/candidate/peer-meetings/{open_m['id']}", headers=peer.h[ALICE])
    assert peer.mail == []


# ── reminders ────────────────────────────────────────────────────────────────
def test_the_fifteen_minute_reminder_goes_to_both_people_once(peer):
    book(peer, invitee=BOB, minutes_ahead=10)
    peer.mail.clear()
    first = maintain(peer)
    assert sorted(x["to"] for x in peer.mail) == ["alice@test.dev", "bob@test.dev"] and first["reminders_sent"] == 2
    assert all("soon" in x["subject"].lower() for x in peer.mail)
    peer.mail.clear()
    assert maintain(peer)["reminders_sent"] == 0 and peer.mail == []  # never twice


def test_no_reminder_before_the_window(peer):
    book(peer, invitee=BOB, minutes_ahead=60)
    peer.mail.clear()
    assert maintain(peer)["reminders_sent"] == 0 and peer.mail == []


def test_the_day_before_reminder_only_for_meetings_booked_well_ahead(peer):
    far = book(peer, invitee=BOB, minutes_ahead=20 * 60, created_hours_ago=72)   # booked 3 days ago, 20h to go
    short = book(peer, who=CAROL, invitee=ALICE, minutes_ahead=20 * 60)           # booked just now, 20h to go
    peer.mail.clear()
    assert maintain(peer)["reminders_sent"] == 2
    assert sorted(x["to"] for x in peer.mail) == ["alice@test.dev", "bob@test.dev"]
    assert peer.db.one("peer_scheduled_meetings", id=far["id"])["reminded_day_at"]
    assert peer.db.one("peer_scheduled_meetings", id=short["id"]).get("reminded_day_at") is None
    peer.mail.clear()
    assert maintain(peer)["reminders_sent"] == 0


def test_a_person_can_turn_reminders_off_without_affecting_the_other(peer):
    peer.client.put("/candidate/peer-preferences", headers=peer.h[BOB], json={"email_reminders": False})
    book(peer, invitee=BOB, minutes_ahead=10)
    peer.mail.clear()
    maintain(peer)
    assert [x["to"] for x in peer.mail] == ["alice@test.dev"]


def test_cancelled_meetings_get_no_reminders(peer):
    m = book(peer, invitee=BOB, minutes_ahead=10)
    peer.client.delete(f"/candidate/peer-meetings/{m['id']}", headers=peer.h[ALICE])
    peer.mail.clear()
    assert maintain(peer)["reminders_sent"] == 0 and peer.mail == []


# ── no-shows ─────────────────────────────────────────────────────────────────
def _waiting_meeting(peer, started_minutes_ago):
    m = book(peer, invitee=BOB, minutes_ahead=2)
    row = peer.db.one("peer_scheduled_meetings", id=m["id"])
    row.update(status="waiting", first_joiner_id=ALICE, scheduled_at=iso(now() - timedelta(minutes=started_minutes_ago)))
    peer.mail.clear()
    return m


def test_someone_who_waited_for_a_partner_who_never_came_is_told_it_is_not_their_fault(peer):
    m = _waiting_meeting(peer, started_minutes_ago=12)
    out = maintain(peer)
    assert out["no_shows"] == 1
    row = peer.db.one("peer_scheduled_meetings", id=m["id"])
    assert row["status"] == "no_show" and row["no_show_at"]
    assert [x["to"] for x in peer.mail] == ["alice@test.dev"] and "not your fault" in peer.mail[0]["body"]


def test_ten_minutes_of_patience_before_a_no_show(peer):
    m = _waiting_meeting(peer, started_minutes_ago=8)
    assert maintain(peer)["no_shows"] == 0
    assert peer.db.one("peer_scheduled_meetings", id=m["id"])["status"] == "waiting"


def test_a_live_meeting_is_never_a_no_show(peer):
    m = _waiting_meeting(peer, started_minutes_ago=12)
    peer.db.one("peer_scheduled_meetings", id=m["id"])["status"] = "live"
    assert maintain(peer)["no_shows"] == 0


def test_a_no_show_meeting_cannot_be_joined_and_leaves_the_list(peer):
    m = _waiting_meeting(peer, started_minutes_ago=12)
    maintain(peer)
    assert peer.client.post(f"/candidate/peer-meetings/{m['id']}/join", headers=peer.h[BOB]).status_code == 410
    assert peer.client.get("/candidate/peer-meetings", headers=peer.h[ALICE]).json() == []


# ── preferences ──────────────────────────────────────────────────────────────
def test_preferences_default_to_private_with_emails_on(peer):
    p = peer.client.get("/candidate/peer-preferences", headers=peer.h[ALICE]).json()
    assert p == {"default_private": True, "timezone": None, "email_invites": True, "email_reminders": True}


def test_preferences_are_saved_per_person_and_validated(peer):
    r = peer.client.put("/candidate/peer-preferences", headers=peer.h[ALICE],
                        json={"default_private": False, "timezone": "Europe/London", "email_invites": False, "email_reminders": True})
    assert r.status_code == 200 and r.json()["timezone"] == "Europe/London" and r.json()["default_private"] is False
    assert peer.client.get("/candidate/peer-preferences", headers=peer.h[BOB]).json()["default_private"] is True
    assert peer.client.put("/candidate/peer-preferences", headers=peer.h[ALICE], json={"timezone": "Mars/Olympus"}).status_code == 422
    assert peer.client.put("/candidate/peer-preferences", headers=peer.h[ALICE], json={"timezone": ""}).json()["timezone"] is None
    assert len(peer.db.rows("peer_preferences", student_id=ALICE)) == 1


def test_preferences_work_for_someone_who_has_not_accepted_the_guidelines(peer):
    peer.h["new"] = peer.user("new", "candidate")
    assert peer.client.get("/candidate/peer-preferences", headers=peer.h["new"]).status_code == 200
    assert peer.client.put("/candidate/peer-preferences", headers=peer.h["new"], json={}).status_code == 200


# ── formatting ───────────────────────────────────────────────────────────────
def test_times_name_their_timezone():
    when = datetime(2030, 3, 4, 12, 0, tzinfo=timezone.utc)
    assert peer_notify.format_time(when, "Asia/Kolkata") == "Mon 04 Mar 2030, 17:30 (Asia/Kolkata)"
    assert peer_notify.format_time(when, None) == "Mon 04 Mar 2030, 12:00 (UTC)"
    assert peer_notify.format_time(when, "Nowhere/Land") == "Mon 04 Mar 2030, 12:00 (UTC)"
    assert peer_notify.valid_timezone("Europe/Paris") and not peer_notify.valid_timezone("nope") and not peer_notify.valid_timezone(None)


# ── rescheduling ─────────────────────────────────────────────────────────────
def _move(peer, who, m, minutes_ahead):
    return peer.client.patch(f"/candidate/peer-meetings/{m['id']}", headers=peer.h[who],
                             json={"scheduled_at": iso(now() + timedelta(minutes=minutes_ahead))})


def test_the_host_can_move_a_meeting_and_the_invitee_is_told(peer):
    m = book(peer, invitee=BOB, minutes_ahead=120)
    peer.mail.clear()
    r = _move(peer, ALICE, m, 600)
    assert r.status_code == 200
    new = datetime.fromisoformat(r.json()["scheduled_at"].replace("Z", "+00:00"))
    assert abs((new - (now() + timedelta(minutes=600))).total_seconds()) < 5
    assert [x["to"] for x in peer.mail] == ["bob@test.dev"] and "moved" in peer.mail[0]["subject"].lower()


def test_moving_restarts_the_reminders(peer):
    m = book(peer, invitee=BOB, minutes_ahead=10)
    maintain(peer)
    assert peer.db.one("peer_scheduled_meetings", id=m["id"])["reminded_soon_at"]
    _move(peer, ALICE, m, 12)
    row = peer.db.one("peer_scheduled_meetings", id=m["id"])
    assert row["reminded_soon_at"] is None and row["reminded_day_at"] is None


def test_only_the_host_can_move_it_and_only_before_anyone_joined(peer):
    m = book(peer, invitee=BOB)
    assert _move(peer, BOB, m, 300).status_code == 403
    assert _move(peer, CAROL, m, 300).status_code == 403
    peer.db.one("peer_scheduled_meetings", id=m["id"])["status"] = "waiting"
    assert _move(peer, ALICE, m, 300).status_code == 409
    assert peer.client.patch("/candidate/peer-meetings/no-such-meeting", headers=peer.h[ALICE],
                             json={"scheduled_at": iso(now() + timedelta(hours=1))}).status_code == 404


def test_a_meeting_cannot_be_moved_into_the_past(peer):
    m = book(peer)
    assert _move(peer, ALICE, m, -30).status_code == 422


# ── history ──────────────────────────────────────────────────────────────────
def _history(peer, who):
    r = peer.client.get("/candidate/peer-history", headers=peer.h[who])
    assert r.status_code == 200, r.text
    return r.json()


def test_history_lists_matched_and_scheduled_sessions_newest_first(peer):
    peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[ALICE])
    room = peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[BOB]).json()["room_id"]
    peer.client.post("/candidate/peer-matchmaking/end", headers=peer.h[BOB])
    m = book(peer, invitee=BOB, minutes_ahead=600)
    h = _history(peer, BOB)
    assert [x["kind"] for x in h] == ["scheduled", "matched"]
    assert h[0]["room_id"] == m["room_id"] and h[1]["room_id"] == room
    assert h[1]["status"] == "completed" and h[1]["partner_label"] == "Alice A"
    assert all(x["can_report_or_rate"] for x in h)


def test_history_hides_the_name_of_a_partner_who_was_anonymous(peer):
    peer.client.post("/candidate/peer-matchmaking/request", json={"keep_private": True}, headers=peer.h[ALICE])
    peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[BOB])
    assert _history(peer, BOB)[0]["partner_label"] == "Anonymous Candidate"
    assert "Alice" not in str(_history(peer, BOB))


def test_history_shows_what_i_already_did_with_each_session(peer):
    peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[ALICE])
    room = peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[BOB]).json()["room_id"]
    assert _history(peer, BOB)[0]["rated"] is False and _history(peer, BOB)[0]["has_report"] is False
    peer.client.post("/candidate/peer-safety/feedback", headers=peer.h[BOB], json={"room_id": room, "rating": 5})
    peer.client.post("/candidate/peer-safety/blocks", headers=peer.h[BOB], json={"room_id": room})
    peer.db.add("peer_interview_reports", student_id=BOB, room_id=room, role="candidate", phase=1)
    row = _history(peer, BOB)[0]
    assert row["rated"] is True and row["blocked"] is True and row["has_report"] is True and row["report_id"]


def test_history_is_only_my_own_and_never_leaks_other_peoples_sessions(peer):
    book(peer, invitee=BOB)
    peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[ALICE])
    peer.client.post("/candidate/peer-matchmaking/request", json={}, headers=peer.h[BOB])
    assert _history(peer, CAROL) == []


def test_history_works_for_someone_who_has_not_accepted_the_guidelines_and_for_open_meetings_nobody_joined(peer):
    peer.h["new"] = peer.user("new", "candidate")
    assert _history(peer, "new") == []
    book(peer)  # an open meeting nobody has joined: no partner to report or rate
    row = _history(peer, ALICE)[0]
    assert row["partner_label"] is None and row["can_report_or_rate"] is False
