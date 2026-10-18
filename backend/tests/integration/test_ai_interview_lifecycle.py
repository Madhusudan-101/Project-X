"""Integration: the parts that keep an AI interview from getting stuck, and keep both sides informed.

Cancel when the interviewer never joined, rejoin after a dropped connection, accommodations, retakes,
extensions, picking applicants, integrity review, outcome emails, invite limits, rubric drafting,
scheduled maintenance, and the emails sent when an interview finishes.
"""
import jwt
import pytest

from ai_interview_support import (  # noqa: F401  (fixtures are used by name)
    AUTH, BASE, CAND, FakeLK, active, candidate, cand, consents, emails, first_invite_id, hr, invite,
    iso, livekit, make_template, report, room_of, rows, start, template_body,
)
from app.services.ai_interview import maintenance, rubric_draft

MAINT = "/internal/ai-interview/maintenance"


def practice(env, ch, domain="web_dev"):
    return env.client.post(f"{CAND}/session", headers=ch, json={"domain": domain, **consents()})


def session_row(env, room):
    return env.db.one("ai_voice_interview_sessions", room_id=room)


def age_session(env, room, minutes):
    session_row(env, room)["started_at"] = iso(minutes=-minutes)


def finish(env, active_fixture, **over):
    h, t, inv_id = active_fixture
    ch = candidate(env)
    start(env, ch, inv_id)
    room = room_of(env, inv_id)
    assert report(env, room, **over).status_code == 201
    return h, t, inv_id, ch, room


# ═══ cancel when the interviewer never joined ═══════════════════════
def test_cancelling_a_company_interview_gives_the_attempt_back(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    room = start(env, ch, inv_id).json()["roomName"]
    FakeLK.rooms[room] = ["stu-1"]  # only the candidate is in the room
    r = env.client.post(f"{CAND}/session/{room}/abort", headers=ch, json={"reason": "interviewer_missing"})
    assert r.status_code == 200 and r.json() == {"released": True, "kind": "company"}
    inv = env.db.one("ai_interview_invites", id=inv_id)
    assert inv["status"] == "invited" and inv["room_id"] is None and inv["started_at"] is None
    sess = session_row(env, room)
    assert sess["status"] == "abandoned" and sess["ended_reason"] == "interviewer_unavailable"
    assert room in FakeLK.deleted
    assert start(env, ch, inv_id).status_code == 200  # they can try again


def test_cancelling_practice_removes_the_session_so_it_does_not_count_today(env, hr):
    ch = candidate(env)
    room = practice(env, ch).json()["roomName"]
    assert env.client.get(f"{CAND}/config", headers=ch).json()["usedToday"] == 1
    r = env.client.post(f"{CAND}/session/{room}/abort", headers=ch, json={"reason": "interviewer_missing"})
    assert r.json() == {"released": True, "kind": "practice"}
    assert env.client.get(f"{CAND}/config", headers=ch).json()["usedToday"] == 0
    assert rows(env, "ai_voice_interview_sessions") == []


def test_it_cannot_be_used_to_see_the_questions_and_retry(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    room = start(env, ch, inv_id).json()["roomName"]
    FakeLK.rooms[room] = ["stu-1", "agent-1"]  # the interviewer IS there
    r = env.client.post(f"{CAND}/session/{room}/abort", headers=ch, json={"reason": "interviewer_missing"})
    assert r.status_code == 409 and "interviewer is in the room" in r.json()["detail"]
    assert env.db.one("ai_interview_invites", id=inv_id)["status"] == "started"
    assert room not in FakeLK.deleted and session_row(env, room)["status"] == "started"


def test_it_is_only_possible_in_the_first_minutes(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    room = start(env, ch, inv_id).json()["roomName"]
    age_session(env, room, 6)
    r = env.client.post(f"{CAND}/session/{room}/abort", headers=ch, json={"reason": "interviewer_missing"})
    assert r.status_code == 409 and "too late" in r.json()["detail"]
    assert env.db.one("ai_interview_invites", id=inv_id)["status"] == "started"


def test_a_room_that_has_already_closed_still_releases_the_attempt(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    room = start(env, ch, inv_id).json()["roomName"]
    FakeLK.rooms.pop(room)  # LiveKit already closed it
    assert env.client.post(f"{CAND}/session/{room}/abort", headers=ch, json={"reason": "interviewer_missing"}).status_code == 200
    assert env.db.one("ai_interview_invites", id=inv_id)["status"] == "invited"


def test_cancel_is_refused_for_finished_foreign_and_malformed_requests(env, active):
    h, t, inv_id, ch, room = finish(env, active)
    body = {"reason": "interviewer_missing"}
    assert env.client.post(f"{CAND}/session/{room}/abort", headers=ch, json=body).status_code == 409  # has a report
    other = candidate(env, "stu-2", "bob@x.dev")
    assert env.client.post(f"{CAND}/session/{room}/abort", headers=other, json=body).status_code == 404
    assert env.client.post(f"{CAND}/session/{room}/abort", headers=ch, json={"reason": "i changed my mind"}).status_code == 422
    assert env.client.post(f"{CAND}/session/bad%20id!/abort", headers=ch, json=body).status_code == 400
    assert env.db.one("ai_interview_invites", id=inv_id)["status"] == "completed"


# ═══ rejoin after a dropped connection ══════════════════════════════
def test_rejoin_gives_a_fresh_token_for_the_same_live_room(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    room = start(env, ch, inv_id).json()["roomName"]
    r = env.client.post(f"{CAND}/session/{room}/rejoin", headers=ch)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["roomName"] == room and body["serverUrl"] == "wss://test.livekit.cloud"
    claims = jwt.decode(body["participantToken"], options={"verify_signature": False})
    assert claims["sub"] == "stu-1" and claims["video"]["room"] == room
    assert 1 <= body["maxMinutes"] <= 25
    assert len(FakeLK.created) == 1 and len(FakeLK.dispatched) == 1  # no second room, no second agent


def test_rejoin_reports_only_the_time_that_is_left(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    room = start(env, ch, inv_id).json()["roomName"]  # the company's interview is 25 minutes
    age_session(env, room, 20)
    assert env.client.post(f"{CAND}/session/{room}/rejoin", headers=ch).json()["maxMinutes"] == 5
    age_session(env, room, 24.5)
    assert env.client.post(f"{CAND}/session/{room}/rejoin", headers=ch).json()["maxMinutes"] == 1


def test_rejoin_uses_the_practice_limit_for_practice(env, hr):
    ch = candidate(env)
    room = practice(env, ch).json()["roomName"]
    age_session(env, room, 15)
    assert env.client.post(f"{CAND}/session/{room}/rejoin", headers=ch).json()["maxMinutes"] == 5


def test_rejoin_is_refused_when_the_time_is_over_the_room_is_gone_or_it_finished(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    room = start(env, ch, inv_id).json()["roomName"]
    age_session(env, room, 28)  # 25 minutes + 2 minutes of grace
    assert env.client.post(f"{CAND}/session/{room}/rejoin", headers=ch).status_code == 410
    age_session(env, room, 5)
    FakeLK.rooms.pop(room)
    assert env.client.post(f"{CAND}/session/{room}/rejoin", headers=ch).status_code == 410
    FakeLK.rooms[room] = []
    report(env, room)
    assert env.client.post(f"{CAND}/session/{room}/rejoin", headers=ch).status_code == 409


def test_nobody_can_rejoin_someone_elses_interview(env, active):
    h, t, inv_id = active
    room = start(env, candidate(env), inv_id).json()["roomName"]
    other = candidate(env, "stu-2", "bob@x.dev")
    assert env.client.post(f"{CAND}/session/{room}/rejoin", headers=other).status_code == 404
    assert env.client.post(f"{CAND}/session/{room}/rejoin").status_code == 401


# ═══ accommodations ═════════════════════════════════════════════════
def test_a_candidate_can_ask_for_an_accommodation_and_the_company_is_told(env, active, emails):
    h, t, inv_id = active
    ch = candidate(env)
    emails.clear()
    r = env.client.post(f"{CAND}/assignments/{inv_id}/accommodation", headers=ch,
                        json={"message": "  I need extra time because of a visual impairment.  "})
    assert r.status_code == 200 and r.json() == {"ok": True, "company_emailed": True}
    inv = env.db.one("ai_interview_invites", id=inv_id)
    assert inv["accommodation_request"] == "I need extra time because of a visual impairment." and inv["accommodation_at"]
    to, subject, body = emails[0]
    assert to == "hr-1@test.dev" and "Accommodation request" in subject
    assert "ada@x.dev" in body and "visual impairment" in body
    assert env.client.get(f"{CAND}/assignments", headers=ch).json()[0]["accommodation_requested"] is True
    listed = env.client.get(f"{BASE}/{t['id']}/invites", headers=h).json()[0]
    assert listed["accommodation_request"].startswith("I need extra time")


def test_accommodation_requests_are_validated_and_private(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    url = f"{CAND}/assignments/{inv_id}/accommodation"
    assert env.client.post(url, headers=ch, json={"message": "no"}).status_code == 422
    assert env.client.post(url, headers=ch, json={"message": "x" * 1001}).status_code == 422
    other = candidate(env, "stu-2", "bob@x.dev")
    assert env.client.post(url, headers=other, json={"message": "Please give me more time."}).status_code == 404
    start(env, ch, inv_id)
    assert env.client.post(url, headers=ch, json={"message": "Too late to ask now."}).status_code == 409
    assert env.db.one("ai_interview_invites", id=inv_id).get("accommodation_request") is None


# ═══ retake ═════════════════════════════════════════════════════════
def test_allowing_a_retake_resets_the_invitation_and_keeps_the_earlier_attempt(env, active, emails):
    h, t, inv_id, ch, room1 = finish(env, active)
    env.client.put(f"{BASE}/{t['id']}/results/{inv_id}/decision", headers=h, json={"decision": "reject"})
    emails.clear()
    r = env.client.post(f"{BASE}/{t['id']}/invites/{inv_id}/retake", headers=h, json={"expires_in_days": 10})
    assert r.status_code == 200 and r.json() == {"email": "sent", "retakes": 1}
    inv = env.db.one("ai_interview_invites", id=inv_id)
    assert inv["status"] == "invited" and inv["room_id"] is None and inv["retakes"] == 1
    assert inv["decision"] is None and inv["completed_at"] is None
    assert "another go" in emails[0][1] and emails[0][0] == "ada@x.dev"
    # The candidate takes it again, and the hiring team still sees the first attempt.
    assert start(env, ch, inv_id).status_code == 200
    room2 = room_of(env, inv_id)
    assert room2 != room1 and report(env, room2, overall_score=88).status_code == 201
    d = env.client.get(f"{BASE}/{t['id']}/results/{inv_id}", headers=h).json()
    assert d["report"]["overall_score"] == 88
    assert [(a["overall_score"], a["has_report"]) for a in d["previous_attempts"]] == [(71, True)]
    assert env.client.get(f"{BASE}/{t['id']}/invites", headers=h).json()[0]["retakes"] == 1


def test_a_retake_closes_a_session_that_never_finished(env, active):
    h, t, inv_id = active
    room = start(env, candidate(env), inv_id).json()["roomName"]
    assert env.client.post(f"{BASE}/{t['id']}/invites/{inv_id}/retake", headers=h).status_code == 200
    sess = session_row(env, room)
    assert sess["status"] == "abandoned" and sess["ended_reason"] == "retake"
    d_attempts = [s for s in rows(env, "ai_voice_interview_sessions") if s["invite_id"] == inv_id]
    assert len(d_attempts) == 1


def test_retake_is_only_for_candidates_who_started_on_an_active_interview(env, active):
    h, t, inv_id = active
    url = f"{BASE}/{t['id']}/invites/{inv_id}/retake"
    assert env.client.post(url, headers=h).status_code == 409  # still unused
    start(env, candidate(env), inv_id)
    env.client.delete(f"{BASE}/{t['id']}", headers=h)  # archive
    assert env.client.post(url, headers=h).status_code == 409
    h2, _ = env.company_user("hr-2", "Rival")
    assert env.client.post(url, headers=h2).status_code == 404
    assert env.client.post(url, headers=h, json={"expires_in_days": 0}).status_code == 422


# ═══ extend ═════════════════════════════════════════════════════════
def test_extending_gives_an_expired_invitation_a_new_deadline_and_tells_the_candidate(env, active, emails):
    h, t, inv_id = active
    env.db.one("ai_interview_invites", id=inv_id)["expires_at"] = iso(days=-1)
    assert env.client.get(f"{BASE}/{t['id']}/invites", headers=h).json()[0]["status"] == "expired"
    emails.clear()
    r = env.client.post(f"{BASE}/{t['id']}/invites/{inv_id}/extend", headers=h, json={"days": 5})
    assert r.status_code == 200 and r.json()["email"] == "sent"
    assert env.client.get(f"{BASE}/{t['id']}/invites", headers=h).json()[0]["status"] == "invited"
    assert emails[0][1].startswith("Reminder")


def test_extend_is_refused_once_the_candidate_started_or_it_was_withdrawn(env, active):
    h, t, inv_id = active
    url = f"{BASE}/{t['id']}/invites/{inv_id}/extend"
    assert env.client.post(url, headers=h, json={"days": 0}).status_code == 422
    env.client.delete(f"{BASE}/{t['id']}/invites/{inv_id}", headers=h)
    assert env.client.post(url, headers=h).status_code == 409
    invite(env, h, t["id"], "ada@x.dev")  # reissue
    start(env, candidate(env), inv_id)
    assert env.client.post(url, headers=h).status_code == 409


# ═══ pick applicants ════════════════════════════════════════════════
def linked(env, h, company, n=2):
    job = env.db.add("jobs", company_id=company["id"], title="Backend")
    apps = []
    for i in range(n):
        env.user(f"app-{i}", "candidate", email=f"Person{i}@X.dev", profile={"first_name": f"P{i}", "last_name": "Q"})
        apps.append(env.db.add("applications", student_id=f"app-{i}", job_id=job["id"],
                               company_id=company["id"], status="applied"))
    return job, apps, make_template(env, h, job_id=job["id"])


def test_the_hiring_team_can_see_a_jobs_applicants_and_who_is_already_invited(env, hr):
    h, company = hr
    job, apps, t = linked(env, h, company)
    got = env.client.get(f"{BASE}/{t['id']}/applicants", headers=h).json()
    assert [(a["email"], a["name"], a["already_invited"]) for a in got] == [
        ("person0@x.dev", "P0 Q", False), ("person1@x.dev", "P1 Q", False)]
    invite(env, h, t["id"], application_ids=[apps[0]["id"]])
    got = env.client.get(f"{BASE}/{t['id']}/applicants", headers=h).json()
    assert [a["already_invited"] for a in got] == [True, False]


def test_applicants_need_a_linked_job_and_belong_to_one_company(env, hr):
    h, company = hr
    plain = make_template(env, h)
    assert env.client.get(f"{BASE}/{plain['id']}/applicants", headers=h).status_code == 400
    _, _, t = linked(env, h, company, n=1)
    h2, _ = env.company_user("hr-2", "Rival")
    assert env.client.get(f"{BASE}/{t['id']}/applicants", headers=h2).status_code == 404


# ═══ integrity review ═══════════════════════════════════════════════
def test_the_hiring_team_can_dismiss_or_confirm_integrity_flags(env, active):
    h, t, inv_id, ch, room = finish(env, active)
    env.db.add("ai_voice_interview_integrity_events", room_id=room, student_id="stu-1", kind="tab_hidden",
               offset_seconds=5, source="browser", created_at=iso())
    url = f"{BASE}/{t['id']}/results/{inv_id}/integrity-review"
    assert env.client.get(f"{BASE}/{t['id']}/results", headers=h).json()["summary"]["flagged"] == 1
    r = env.client.put(url, headers=h, json={"review": "dismissed", "note": " Checked the dictionary app. "})
    assert r.json() == {"review": "dismissed", "note": "Checked the dictionary app."}
    d = env.client.get(f"{BASE}/{t['id']}/results/{inv_id}", headers=h).json()
    assert d["integrity_review"] == {"review": "dismissed", "note": "Checked the dictionary app."}
    summary = env.client.get(f"{BASE}/{t['id']}/results", headers=h).json()
    assert summary["summary"]["flagged"] == 0  # a dismissed flag no longer counts
    assert summary["rows"][0]["integrity_review"] == "dismissed" and summary["rows"][0]["integrity"]["total"] == 1
    env.client.put(url, headers=h, json={"review": "confirmed"})
    assert env.client.get(f"{BASE}/{t['id']}/results", headers=h).json()["summary"]["flagged"] == 1
    env.client.put(url, headers=h, json={"review": None})
    assert env.db.one("ai_interview_invites", id=inv_id)["integrity_review"] is None


def test_integrity_review_is_validated_and_scoped(env, active):
    h, t, inv_id = active
    url = f"{BASE}/{t['id']}/results/{inv_id}/integrity-review"
    assert env.client.put(url, headers=h, json={"review": "dismissed"}).status_code == 409  # not taken yet
    start(env, candidate(env), inv_id)
    assert env.client.put(url, headers=h, json={"review": "maybe"}).status_code == 422
    assert env.client.put(url, headers=h, json={"review": "confirmed", "note": "x" * 1001}).status_code == 422
    h2, _ = env.company_user("hr-2", "Rival")
    assert env.client.put(url, headers=h2, json={"review": "dismissed"}).status_code == 404
    assert env.client.put(url, headers=candidate(env, "stu-9", "z@x.dev"), json={"review": "dismissed"}).status_code == 403


# ═══ decisions: application status and the candidate's outcome email ═
def decided(env, h, t, inv_id, **body):
    return env.client.put(f"{BASE}/{t['id']}/results/{inv_id}/decision", headers=h, json=body)


def taken_via_application(env, h, company, status="applied"):
    job, apps, t = linked(env, h, company, n=1)
    env.db.rows("applications")[0]["status"] = status
    invite(env, h, t["id"], application_ids=[apps[0]["id"]])
    inv_id = first_invite_id(env, h, t["id"])
    ch = env.user("app-0-login", "candidate", email="person0@x.dev")  # signs in with the invited address
    assert start(env, ch, inv_id).status_code == 200
    return t, apps[0], inv_id


def test_advance_shortlists_the_application_and_reject_declines_it(env, hr):
    h, company = hr
    t, app, inv_id = taken_via_application(env, h, company)
    r = decided(env, h, t, inv_id, decision="advance")
    assert r.json()["application_status"] == "shortlisted"
    assert env.db.one("applications", id=app["id"])["status"] == "shortlisted"
    r = decided(env, h, t, inv_id, decision="reject")
    assert r.json()["application_status"] == "rejected"
    assert env.db.one("applications", id=app["id"])["status"] == "rejected"


@pytest.mark.parametrize("current, decision", [
    ("hired", "advance"), ("hired", "reject"), ("rejected", "advance"), ("in_interview", "advance"),
])
def test_a_decision_never_moves_an_application_backwards(env, hr, current, decision):
    h, company = hr
    t, app, inv_id = taken_via_application(env, h, company, status=current)
    assert decided(env, h, t, inv_id, decision=decision).json()["application_status"] is None
    assert env.db.one("applications", id=app["id"])["status"] == current


def test_hold_and_clearing_leave_the_application_alone(env, hr):
    h, company = hr
    t, app, inv_id = taken_via_application(env, h, company)
    assert decided(env, h, t, inv_id, decision="hold").json()["application_status"] is None
    assert decided(env, h, t, inv_id, decision=None).json()["application_status"] is None
    assert env.db.one("applications", id=app["id"])["status"] == "applied"


def test_another_companys_application_is_never_touched(env, hr):
    h, company = hr
    t, app, inv_id = taken_via_application(env, h, company)
    other = env.db.add("companies", owner_id="x", name="Other", industry="x", size="1-10")
    env.db.one("applications", id=app["id"])["company_id"] = other["id"]
    assert decided(env, h, t, inv_id, decision="advance").json()["application_status"] is None
    assert env.db.one("applications", id=app["id"])["status"] == "applied"


def test_the_candidate_is_emailed_the_outcome_only_when_the_company_chooses(env, active, emails):
    h, t, inv_id, ch, room = finish(env, active)
    emails.clear()
    assert decided(env, h, t, inv_id, decision="advance", note="internal only").json()["candidate_email"] is None
    assert emails == []  # nothing is sent unless asked
    r = decided(env, h, t, inv_id, decision="advance", notify_candidate=True, candidate_message="We will call you Monday.")
    assert r.json()["candidate_email"] == "sent"
    to, subject, body = emails[0]
    assert to == "ada@x.dev" and "Update on your Backend Engineer application" in subject
    assert "move you forward" in body and "We will call you Monday." in body
    assert "internal only" not in body  # the internal note never leaves the hiring team
    assert env.db.one("ai_interview_invites", id=inv_id)["candidate_notified_at"]


def test_reject_emails_are_polite_and_hold_never_emails(env, active, emails):
    h, t, inv_id, ch, room = finish(env, active)
    emails.clear()
    assert decided(env, h, t, inv_id, decision="hold", notify_candidate=True).json()["candidate_email"] is None
    assert emails == []
    assert decided(env, h, t, inv_id, decision="reject", notify_candidate=True).json()["candidate_email"] == "sent"
    assert "decided not to move forward" in emails[0][2]


def test_the_same_outcome_is_not_emailed_twice_but_a_changed_one_is(env, active, emails):
    h, t, inv_id, ch, room = finish(env, active)
    decided(env, h, t, inv_id, decision="advance", notify_candidate=True)
    emails.clear()
    assert decided(env, h, t, inv_id, decision="advance", notify_candidate=True).json()["candidate_email"] == "already_sent"
    assert emails == []
    assert decided(env, h, t, inv_id, decision="reject", notify_candidate=True).json()["candidate_email"] == "sent"
    assert len(emails) == 1


def test_an_unsent_outcome_email_is_reported_honestly(env, active, monkeypatch):
    from app.services.notifications import ai_interview_emails as mod
    monkeypatch.setattr(mod, "send_email", lambda *a: "skipped")
    h, t, inv_id, ch, room = finish(env, active)
    assert decided(env, h, t, inv_id, decision="advance", notify_candidate=True).json()["candidate_email"] == "skipped"
    assert env.db.one("ai_interview_invites", id=inv_id).get("candidate_notified_at") is None


# ═══ invitation limit ═══════════════════════════════════════════════
def test_a_company_cannot_exceed_its_daily_invitation_limit(env, hr, monkeypatch):
    monkeypatch.setenv("AI_INTERVIEW_COMPANY_DAILY_INVITES", "2")
    h, _ = hr
    tid = make_template(env, h)["id"]
    url = f"{BASE}/{tid}/invites"
    too_many = env.client.post(url, headers=h, json={"emails": ["a@x.dev", "b@x.dev", "c@x.dev"]})
    assert too_many.status_code == 429 and "2 invitations a day" in too_many.json()["detail"]
    assert rows(env, "ai_interview_invites") == []  # nothing was half-sent
    assert env.client.post(url, headers=h, json={"emails": ["a@x.dev", "b@x.dev"]}).status_code == 200
    assert env.client.post(url, headers=h, json={"emails": ["c@x.dev"]}).status_code == 429


def test_the_limit_is_per_company(env, hr, monkeypatch):
    monkeypatch.setenv("AI_INTERVIEW_COMPANY_DAILY_INVITES", "1")
    h, _ = hr
    invite(env, h, make_template(env, h)["id"], "a@x.dev")
    h2, _ = env.company_user("hr-2", "Rival")
    invite(env, h2, make_template(env, h2)["id"], "b@x.dev")


# ═══ rubric drafting ════════════════════════════════════════════════
DRAFT = [{"name": "Reasoning", "description": "d", "weight": 60, "questions": ["q"], "expected_concepts": "c"},
         {"name": "Communication", "description": "", "weight": 40, "questions": [], "expected_concepts": ""}]


def test_a_rubric_can_be_drafted_from_a_role_and_description(env, hr, monkeypatch):
    seen = {}

    async def fake(role, level, description, **kw):
        seen.update(role=role, level=level, description=description)
        return DRAFT

    monkeypatch.setattr(rubric_draft, "draft_rubric", fake)
    r = env.client.post(f"{BASE}/draft-rubric", headers=hr[0],
                        json={"role_title": " Backend Engineer ", "level": "senior", "description": "Own our API."})
    assert r.status_code == 200
    assert [(c["name"], c["weight_pct"]) for c in r.json()["competencies"]] == [("Reasoning", 60), ("Communication", 40)]
    assert seen == {"role": "Backend Engineer", "level": "senior", "description": "Own our API."}
    assert rows(env, "ai_interview_templates") == []  # a draft is not saved


def test_drafting_uses_the_linked_jobs_description_when_none_is_given(env, hr, monkeypatch):
    h, company = hr
    job = env.db.add("jobs", company_id=company["id"], title="Backend", description="Build reliable payment APIs.")
    seen = {}

    async def fake(role, level, description, **kw):
        seen["description"] = description
        return DRAFT

    monkeypatch.setattr(rubric_draft, "draft_rubric", fake)
    assert env.client.post(f"{BASE}/draft-rubric", headers=h,
                           json={"role_title": "Backend", "job_id": job["id"]}).status_code == 200
    assert seen["description"] == "Build reliable payment APIs."
    other = env.db.add("companies", owner_id="x", name="Other", industry="x", size="1-10")
    theirs = env.db.add("jobs", company_id=other["id"], title="Theirs", description="secret")
    assert env.client.post(f"{BASE}/draft-rubric", headers=h,
                           json={"role_title": "Backend", "job_id": theirs["id"]}).status_code == 400


@pytest.mark.parametrize("error, code", [(RuntimeError("no key"), 503), (ValueError("junk"), 502)])
def test_drafting_failures_are_explained_not_crashed(env, hr, monkeypatch, error, code):
    async def boom(*a, **k):
        raise error

    monkeypatch.setattr(rubric_draft, "draft_rubric", boom)
    r = env.client.post(f"{BASE}/draft-rubric", headers=hr[0], json={"role_title": "Backend"})
    assert r.status_code == code and r.json()["detail"]


def test_drafting_is_validated_and_company_only(env, hr):
    assert env.client.post(f"{BASE}/draft-rubric", headers=hr[0], json={"role_title": "A"}).status_code == 422
    assert env.client.post(f"{BASE}/draft-rubric", headers=hr[0],
                           json={"role_title": "Backend", "level": "wizard"}).status_code == 422
    assert env.client.post(f"{BASE}/draft-rubric", headers=candidate(env), json={"role_title": "Backend"}).status_code == 403


# ═══ maintenance ════════════════════════════════════════════════════
def run(env):
    r = env.client.post(MAINT, headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()


def test_maintenance_needs_the_shared_secret(env, monkeypatch):
    assert env.client.post(MAINT).status_code == 401
    assert env.client.post(MAINT, headers={"Authorization": "Bearer nope"}).status_code == 401
    monkeypatch.delenv("AI_INTERVIEW_SHARED_SECRET")
    assert env.client.post(MAINT, headers=AUTH).status_code == 503


def test_an_invitation_about_to_expire_gets_one_reminder(env, active, emails):
    h, t, inv_id = active
    env.db.one("ai_interview_invites", id=inv_id)["expires_at"] = iso(hours=12)
    emails.clear()
    assert run(env)["reminders_sent"] == 1
    assert emails[0][0] == "ada@x.dev" and emails[0][1].startswith("Reminder")
    assert env.db.one("ai_interview_invites", id=inv_id)["reminded_at"]
    assert run(env)["reminders_sent"] == 0  # only once
    assert len(emails) == 1


def test_reminders_skip_far_off_expired_used_and_archived_invitations(env, active, emails):
    h, t, inv_id = active
    inv = env.db.one("ai_interview_invites", id=inv_id)
    emails.clear()
    inv["expires_at"] = iso(days=5)
    assert run(env)["reminders_sent"] == 0  # plenty of time
    inv["expires_at"] = iso(hours=-2)
    assert run(env)["reminders_sent"] == 0  # already expired
    inv["expires_at"] = iso(hours=5)
    inv["status"] = "started"
    assert run(env)["reminders_sent"] == 0  # already being taken
    inv["status"] = "invited"
    env.client.delete(f"{BASE}/{t['id']}", headers=h)  # archived
    assert run(env)["reminders_sent"] == 0
    assert emails == []


def test_an_unsent_reminder_is_tried_again_next_time(env, active, monkeypatch):
    from app.services.notifications import ai_interview_emails as mod
    h, t, inv_id = active
    env.db.one("ai_interview_invites", id=inv_id)["expires_at"] = iso(hours=3)
    monkeypatch.setattr(mod, "send_email", lambda *a: "skipped")
    assert run(env)["reminders_sent"] == 0
    assert env.db.one("ai_interview_invites", id=inv_id).get("reminded_at") is None
    monkeypatch.setattr(mod, "send_email", lambda *a: "sent")
    assert run(env)["reminders_sent"] == 1


def test_a_stuck_company_interview_is_closed_as_incomplete_so_it_can_be_retaken(env, active):
    h, t, inv_id = active
    room = start(env, candidate(env), inv_id).json()["roomName"]
    age_session(env, room, 60)  # the agent crashed; no report will ever come
    assert run(env)["swept"] == 1
    sess = session_row(env, room)
    assert sess["status"] == "abandoned" and sess["ended_reason"] == "swept"
    assert env.db.one("ai_interview_invites", id=inv_id)["status"] == "completed"
    res = env.client.get(f"{BASE}/{t['id']}/results", headers=h).json()
    assert res["rows"][0]["incomplete"] is True and res["summary"]["incomplete"] == 1
    assert env.client.post(f"{BASE}/{t['id']}/invites/{inv_id}/retake", headers=h).status_code == 200


def test_the_sweep_respects_each_interviews_own_time_limit(env, hr):
    h, _ = hr
    short = make_template(env, h, duration_minutes=10)
    invite(env, h, short["id"], "ada@x.dev")
    inv_id = first_invite_id(env, h, short["id"])
    room = start(env, candidate(env), inv_id).json()["roomName"]
    age_session(env, room, 15)   # 10 minutes + 10 of grace = 20
    assert run(env)["swept"] == 0
    age_session(env, room, 25)
    assert run(env)["swept"] == 1


def test_the_sweep_leaves_finished_and_recent_interviews_alone(env, active):
    h, t, inv_id, ch, room = finish(env, active)
    session_row(env, room)["status"] = "started"  # as if the status update had been missed
    age_session(env, room, 90)
    assert run(env)["swept"] == 0  # it has a report
    assert env.db.one("ai_interview_invites", id=inv_id)["status"] == "completed"
    ch2 = candidate(env, "stu-2", "bob@x.dev")
    practice(env, ch2)
    assert run(env)["swept"] == 0  # a minute old


def test_a_stuck_practice_interview_is_closed_too(env, hr):
    ch = candidate(env)
    room = practice(env, ch).json()["roomName"]
    age_session(env, room, 90)
    assert run(env)["swept"] == 1
    assert session_row(env, room)["status"] == "abandoned"


def test_transcripts_are_blanked_after_the_retention_period_but_scores_stay(env, active, monkeypatch):
    h, t, inv_id, ch, room = finish(env, active)
    env.db.one("ai_voice_interview_reports", room_id=room)["created_at"] = iso(days=-40)
    assert run(env)["redacted"] == 0  # off unless configured
    monkeypatch.setenv("AI_INTERVIEW_TRANSCRIPT_RETENTION_DAYS", "30")
    assert run(env)["redacted"] == 1
    row = env.db.one("ai_voice_interview_reports", room_id=room)
    assert row["transcript"] is None and row["report_markdown"] is None
    assert row["overall_score"] == 71 and row["competency_scores"]
    assert run(env)["redacted"] == 0  # idempotent


def test_recent_reports_keep_their_transcripts(env, active, monkeypatch):
    monkeypatch.setenv("AI_INTERVIEW_TRANSCRIPT_RETENTION_DAYS", "30")
    h, t, inv_id, ch, room = finish(env, active)
    assert run(env)["redacted"] == 0
    assert env.db.one("ai_voice_interview_reports", room_id=room)["transcript"] == "Q1 A1"


def test_one_failing_step_does_not_stop_the_others(env, active, monkeypatch):
    h, t, inv_id = active
    env.db.one("ai_interview_invites", id=inv_id)["expires_at"] = iso(hours=3)

    def boom(now):
        raise RuntimeError("db hiccup")

    monkeypatch.setattr(maintenance, "sweep_stale_sessions", boom)
    out = run(env)
    assert out["swept"] is None and out["reminders_sent"] == 1 and out["redacted"] == 0


# ═══ emails when an interview finishes ══════════════════════════════
def test_finishing_tells_the_hiring_team_and_confirms_to_the_candidate(env, active, emails):
    h, t, inv_id = active
    ch = env.user("stu-1", "candidate", email="ada@x.dev", profile={"first_name": "Ada", "last_name": "Lovelace"})
    start(env, ch, inv_id)
    emails.clear()
    assert report(env, room_of(env, inv_id)).status_code == 201
    by_to = {to: (subject, body) for to, subject, body in emails}
    assert set(by_to) == {"hr-1@test.dev", "ada@x.dev"}
    assert by_to["hr-1@test.dev"][0] == "Ada Lovelace finished the Backend Engineer interview"
    assert "Read the report" in by_to["hr-1@test.dev"][1]
    assert by_to["ada@x.dev"][0] == "We received your Acme interview"
    assert "will not see a report" in by_to["ada@x.dev"][1] and "person there makes the decision" in by_to["ada@x.dev"][1]


def test_a_retried_report_does_not_email_anyone_twice(env, active, emails):
    h, t, inv_id = active
    start(env, candidate(env), inv_id)
    room = room_of(env, inv_id)
    report(env, room)
    emails.clear()
    assert report(env, room).status_code == 201
    assert emails == []


def test_a_candidate_who_left_early_is_flagged_in_the_hiring_teams_email(env, active, emails):
    h, t, inv_id = active
    start(env, candidate(env), inv_id)
    emails.clear()
    report(env, room_of(env, inv_id), partial=True)
    hr_mail = next(b for to, s, b in emails if to == "hr-1@test.dev")
    assert "left before the end" in hr_mail


def test_practice_interviews_send_no_notifications(env, hr, emails):
    ch = candidate(env)
    room = practice(env, ch).json()["roomName"]
    emails.clear()
    assert report(env, room).status_code == 201
    assert emails == []
