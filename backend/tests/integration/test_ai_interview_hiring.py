"""Integration: company AI interviews (templates, rubric, invites, results, decisions) and the
candidate side (assignments, starting from an invite), next to practice interviews.

Runs against the in-memory Supabase fake in this folder, with LiveKit stubbed.
"""
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.routers.candidate import ai_interview as cand
from app.services.notifications import ai_interview_emails

BASE = "/company/ai-interviews"
CAND = "/candidate/ai-interview"
AUTH = {"Authorization": "Bearer test-ai-secret"}


def iso(days=0, hours=0):
    return (datetime.now(timezone.utc) + timedelta(days=days, hours=hours)).isoformat()


# ── LiveKit stub ────────────────────────────────────────────────────
class FakeLK:
    created, dispatched = [], []
    fail_room = fail_dispatch = False

    def __init__(self, *a):
        self.room = self
        self.agent_dispatch = self

    async def create_room(self, req):
        if FakeLK.fail_room:
            raise RuntimeError("livekit down")
        FakeLK.created.append(req)

    async def create_dispatch(self, req):
        if FakeLK.fail_dispatch:
            raise RuntimeError("dispatch failed")
        FakeLK.dispatched.append(req)

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
    FakeLK.created, FakeLK.dispatched = [], []
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


# ═══ access control ═════════════════════════════════════════════════
def test_company_endpoints_need_a_company_account(env):
    assert env.client.get(BASE).status_code == 401
    ch = candidate(env)
    assert env.client.get(BASE, headers=ch).status_code == 403
    assert env.client.post(BASE, headers=ch, json=template_body()).status_code == 403
    assert env.client.get(f"{BASE}/presets", headers=ch).status_code == 403


def test_company_without_a_profile_row_is_told_to_onboard(env):
    h = env.user("hr-new", "company")
    assert env.client.get(BASE, headers=h).status_code == 404


# ═══ presets and templates ══════════════════════════════════════════
def test_presets_cover_the_three_practice_tracks_and_weights_total_100(env, hr):
    r = env.client.get(f"{BASE}/presets", headers=hr[0])
    assert r.status_code == 200
    presets = r.json()
    assert {p["id"] for p in presets} == {"ai_ml", "web_dev", "dsa"}
    for p in presets:
        assert 1 <= len(p["competencies"]) <= 8
        assert sum(c["weight_pct"] for c in p["competencies"]) == 100


def test_create_template_returns_normalised_weights_and_counts(env, hr):
    t = make_template(env, hr[0])
    assert t["status"] == "active" and t["version"] == 1 and t["duration_minutes"] == 25
    assert [c["weight_pct"] for c in t["rubric"]] == [60, 40]
    assert t["counts"] == {"invited": 0, "started": 0, "completed": 0}
    listed = env.client.get(BASE, headers=hr[0]).json()
    assert [x["id"] for x in listed] == [t["id"]]


def test_template_defaults_to_draft(env, hr):
    body = template_body()
    del body["status"]
    r = env.client.post(BASE, headers=hr[0], json=body)
    assert r.status_code == 201 and r.json()["status"] == "draft"


@pytest.mark.parametrize("bad", [
    {"rubric": []},
    {"rubric": [{"name": f"Skill {i}", "weight": 10} for i in range(9)]},
    {"rubric": [{"name": "Same", "weight": 10}, {"name": "same", "weight": 20}]},
    {"rubric": [{"name": "X", "weight": 10}]},                       # name too short
    {"rubric": [{"name": "Valid name", "weight": 0}]},
    {"rubric": [{"name": "Valid name", "weight": 101}]},
    {"rubric": [{"name": "Valid name", "weight": 10, "questions": ["a", "b", "c", "d"]}]},
    {"rubric": [{"name": "Valid name", "weight": 10, "questions": ["x" * 301]}]},
    {"duration_minutes": 9},
    {"duration_minutes": 61},
    {"title": " "},
    {"role_title": "A"},
    {"level": "wizard"},
])
def test_template_validation_rejects_bad_input(env, hr, bad):
    r = env.client.post(BASE, headers=hr[0], json=template_body(**bad))
    assert r.status_code == 422, bad
    assert rows(env, "ai_interview_templates") == []


def test_blank_seed_questions_are_dropped_not_rejected(env, hr):
    t = make_template(env, hr[0], rubric=[{"name": "Depth", "weight": 5, "questions": ["  ", "Why?"]}])
    assert t["rubric"][0]["questions"] == ["Why?"]


def test_template_can_link_only_to_the_companys_own_job(env, hr):
    h, company = hr
    mine = env.db.add("jobs", company_id=company["id"], title="Mine")
    other_co = env.db.add("companies", owner_id="x", name="Other", industry="x", size="1-10")
    theirs = env.db.add("jobs", company_id=other_co["id"], title="Theirs")
    assert make_template(env, h, job_id=mine["id"])["job_id"] == mine["id"]
    r = env.client.post(BASE, headers=h, json=template_body(job_id=theirs["id"]))
    assert r.status_code == 400


def test_companies_cannot_see_or_touch_each_others_interviews(env, hr):
    t = make_template(env, hr[0])
    inv_id = None
    invite(env, hr[0], t["id"], "ada@x.dev")
    inv_id = first_invite_id(env, hr[0], t["id"])
    h2, _ = env.company_user("hr-2", "Rival")
    assert env.client.get(BASE, headers=h2).json() == []
    tid = t["id"]
    for method, url, kw in [
        ("get", f"{BASE}/{tid}", {}),
        ("patch", f"{BASE}/{tid}", {"json": {"title": "Hijack"}}),
        ("delete", f"{BASE}/{tid}", {}),
        ("get", f"{BASE}/{tid}/invites", {}),
        ("post", f"{BASE}/{tid}/invites", {"json": {"emails": ["z@x.dev"]}}),
        ("post", f"{BASE}/{tid}/invites/{inv_id}/resend", {}),
        ("delete", f"{BASE}/{tid}/invites/{inv_id}", {}),
        ("get", f"{BASE}/{tid}/results", {}),
        ("get", f"{BASE}/{tid}/results/{inv_id}", {}),
        ("put", f"{BASE}/{tid}/results/{inv_id}/decision", {"json": {"decision": "reject"}}),
    ]:
        assert getattr(env.client, method)(url, headers=h2, **kw).status_code == 404, (method, url)
    assert env.db.one("ai_interview_templates", id=tid)["title"] == "Backend round 1"
    assert env.db.one("ai_interview_invites", id=inv_id)["status"] == "invited"


def test_editing_the_rubric_or_duration_bumps_the_version_but_a_rename_does_not(env, hr):
    h, tid = hr[0], make_template(env, hr[0])["id"]
    assert env.client.patch(f"{BASE}/{tid}", headers=h, json={"title": "Renamed"}).json()["version"] == 1
    assert env.client.patch(f"{BASE}/{tid}", headers=h, json={"duration_minutes": 25}).json()["version"] == 1
    assert env.client.patch(f"{BASE}/{tid}", headers=h, json={"duration_minutes": 30}).json()["version"] == 2
    r = env.client.patch(f"{BASE}/{tid}", headers=h, json={"rubric": [{"name": "Only one", "weight": 5}]})
    assert r.json()["version"] == 3 and [c["weight_pct"] for c in r.json()["rubric"]] == [100]


def test_patch_validates_and_leaves_the_template_untouched_on_error(env, hr):
    h, tid = hr[0], make_template(env, hr[0])["id"]
    assert env.client.patch(f"{BASE}/{tid}", headers=h, json={"rubric": []}).status_code == 422
    assert env.client.patch(f"{BASE}/{tid}", headers=h, json={"duration_minutes": 5}).status_code == 422
    assert len(env.db.one("ai_interview_templates", id=tid)["rubric"]) == 2


def test_archiving_hides_the_template_and_stops_new_invites(env, hr):
    h, tid = hr[0], make_template(env, hr[0])["id"]
    assert env.client.delete(f"{BASE}/{tid}", headers=h).status_code == 204
    assert env.client.get(BASE, headers=h).json() == []
    assert [t["id"] for t in env.client.get(f"{BASE}?include_archived=true", headers=h).json()] == [tid]
    r = env.client.post(f"{BASE}/{tid}/invites", headers=h, json={"emails": ["a@x.dev"]})
    assert r.status_code == 409


def test_a_draft_cannot_invite_until_it_is_activated(env, hr):
    h = hr[0]
    tid = make_template(env, h, status="draft")["id"]
    assert env.client.post(f"{BASE}/{tid}/invites", headers=h, json={"emails": ["a@x.dev"]}).status_code == 409
    env.client.patch(f"{BASE}/{tid}", headers=h, json={"status": "active"})
    assert env.client.post(f"{BASE}/{tid}/invites", headers=h, json={"emails": ["a@x.dev"]}).status_code == 200


# ═══ invites ════════════════════════════════════════════════════════
def test_invite_normalises_dedupes_reports_invalid_and_links_existing_accounts(env, hr, emails):
    h = hr[0]
    candidate(env, "stu-1", "ada@x.dev")
    tid = make_template(env, h)["id"]
    r = invite(env, h, tid, " Ada@X.dev ", "ada@x.dev", "new@x.dev", "not-an-email", "a b@x.dev")
    assert r["invited"] == 2 and r["invalid"] == ["not-an-email", "a b@x.dev"]
    rows = {i["email"]: i for i in env.client.get(f"{BASE}/{tid}/invites", headers=h).json()}
    assert set(rows) == {"ada@x.dev", "new@x.dev"}
    assert rows["ada@x.dev"]["has_account"] is True and rows["new@x.dev"]["has_account"] is False
    assert env.db.one("ai_interview_invites", email="ada@x.dev")["student_id"] == "stu-1"
    assert len(emails) == 2


def test_company_users_are_not_linked_as_candidates(env, hr):
    h = hr[0]
    env.user("hr-9", "company", email="boss@x.dev")
    tid = make_template(env, h)["id"]
    invite(env, h, tid, "boss@x.dev")
    assert env.db.one("ai_interview_invites", email="boss@x.dev")["student_id"] is None


def test_inviting_again_is_idempotent_and_does_not_resend(env, hr, emails):
    h = hr[0]
    tid = make_template(env, h)["id"]
    invite(env, h, tid, "ada@x.dev")
    again = invite(env, h, tid, "ada@x.dev")
    assert again["already_invited"] == 1 and again["invited"] == 0
    assert len(rows(env, "ai_interview_invites")) == 1 and len(emails) == 1


def test_invite_email_names_the_company_role_duration_and_links_the_invite(env, hr, emails):
    h = hr[0]
    tid = make_template(env, h)["id"]
    invite(env, h, tid, "ada@x.dev")
    inv = env.db.one("ai_interview_invites", email="ada@x.dev")
    to, subject, body = emails[0]
    assert to == "ada@x.dev" and "Acme" in subject
    assert "Backend Engineer" in body and "25 minutes" in body and "Be on time." in body
    assert inv["id"] in body
    assert inv["email_status"] == "sent" and inv["last_emailed_at"]


def test_missing_email_config_is_reported_but_never_blocks_the_invite(env, hr, monkeypatch):
    monkeypatch.setattr(ai_interview_emails, "send_email", lambda *a: "skipped")
    h = hr[0]
    tid = make_template(env, h)["id"]
    r = invite(env, h, tid, "ada@x.dev")
    assert r["invited"] == 1 and r["emails_skipped"] == 1 and r["emails_sent"] == 0


def test_invite_validation(env, hr):
    h = hr[0]
    tid = make_template(env, h)["id"]
    url = f"{BASE}/{tid}/invites"
    assert env.client.post(url, headers=h, json={}).status_code == 422
    assert env.client.post(url, headers=h, json={"emails": []}).status_code == 422
    assert env.client.post(url, headers=h, json={"emails": [f"a{i}@x.dev" for i in range(101)]}).status_code == 422
    assert env.client.post(url, headers=h, json={"emails": ["a@x.dev"], "expires_in_days": 0}).status_code == 422
    assert env.client.post(url, headers=h, json={"emails": ["a@x.dev"], "expires_in_days": 31}).status_code == 422
    assert rows(env, "ai_interview_invites") == []


def test_invite_from_a_jobs_applicants(env, hr, emails):
    h, company = hr
    job = env.db.add("jobs", company_id=company["id"], title="Backend")
    env.user("stu-7", "candidate", email="Priya@X.dev")
    app = env.db.add("applications", student_id="stu-7", job_id=job["id"], company_id=company["id"])
    tid = make_template(env, h, job_id=job["id"])["id"]
    r = invite(env, h, tid, application_ids=[app["id"]])
    assert r["invited"] == 1
    row = env.db.one("ai_interview_invites", email="priya@x.dev")
    assert row["application_id"] == app["id"] and row["student_id"] == "stu-7"


def test_applicant_invites_reject_other_jobs_and_unlinked_templates(env, hr):
    h, company = hr
    job = env.db.add("jobs", company_id=company["id"], title="Backend")
    other = env.db.add("jobs", company_id=company["id"], title="Frontend")
    env.user("stu-7", "candidate", email="p@x.dev")
    app = env.db.add("applications", student_id="stu-7", job_id=other["id"], company_id=company["id"])
    linked = make_template(env, h, job_id=job["id"])["id"]
    assert env.client.post(f"{BASE}/{linked}/invites", headers=h,
                           json={"application_ids": [app["id"]]}).status_code == 400
    unlinked = make_template(env, h)["id"]
    assert env.client.post(f"{BASE}/{unlinked}/invites", headers=h,
                           json={"application_ids": [app["id"]]}).status_code == 400
    assert rows(env, "ai_interview_invites") == []


def test_an_expired_invitation_shows_as_expired_and_can_be_reissued(env, hr, emails):
    h, tid, inv_id = hr[0], None, None
    t = make_template(env, h)
    tid = t["id"]
    invite(env, h, tid, "ada@x.dev")
    inv_id = first_invite_id(env, h, tid)
    env.db.one("ai_interview_invites", id=inv_id)["expires_at"] = iso(days=-1)
    listed = env.client.get(f"{BASE}/{tid}/invites", headers=h).json()
    assert listed[0]["status"] == "expired"
    assert env.client.get(f"{BASE}/{tid}", headers=h).json()["counts"]["invited"] == 0
    assert env.client.post(f"{BASE}/{tid}/invites/{inv_id}/resend", headers=h).status_code == 409
    again = invite(env, h, tid, "ada@x.dev")
    assert again["reinvited"] == 1
    assert env.client.get(f"{BASE}/{tid}/invites", headers=h).json()[0]["status"] == "invited"


def test_resend_sends_a_reminder_for_open_invites_only(env, active, emails):
    h, t, inv_id = active
    emails.clear()
    assert env.client.post(f"{BASE}/{t['id']}/invites/{inv_id}/resend", headers=h).json() == {"email": "sent"}
    assert emails[0][1].startswith("Reminder")
    env.client.delete(f"{BASE}/{t['id']}/invites/{inv_id}", headers=h)
    assert env.client.post(f"{BASE}/{t['id']}/invites/{inv_id}/resend", headers=h).status_code == 409


def test_revoke_works_before_the_candidate_starts_and_can_be_reissued(env, active):
    h, t, inv_id = active
    assert env.client.delete(f"{BASE}/{t['id']}/invites/{inv_id}", headers=h).status_code == 204
    assert env.client.get(f"{BASE}/{t['id']}/invites", headers=h).json()[0]["status"] == "revoked"
    assert invite(env, h, t["id"], "ada@x.dev")["reinvited"] == 1


def test_a_started_interview_cannot_be_revoked_or_reinvited(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    assert start(env, ch, inv_id).status_code == 200
    assert env.client.delete(f"{BASE}/{t['id']}/invites/{inv_id}", headers=h).status_code == 409
    again = invite(env, h, t["id"], "ada@x.dev")
    assert again["already_taken"] == 1 and again["reinvited"] == 0


# ═══ candidate: assignments ═════════════════════════════════════════
def test_assignments_match_by_email_attach_to_the_account_and_hide_the_rubric(env, active):
    ch = candidate(env, "stu-1", "ADA@x.dev")  # different case on purpose
    r = env.client.get(f"{CAND}/assignments", headers=ch)
    assert r.status_code == 200
    (a,) = r.json()
    assert a["company_name"] == "Acme" and a["role_title"] == "Backend Engineer"
    assert a["duration_minutes"] == 25 and a["status"] == "invited" and a["instructions"] == "Be on time."
    assert "rubric" not in a and "expected_concepts" not in json.dumps(a)
    assert env.db.one("ai_interview_invites", email="ada@x.dev")["student_id"] == "stu-1"


def test_assignments_are_private_to_the_invited_candidate(env, active):
    other = candidate(env, "stu-2", "bob@x.dev")
    assert env.client.get(f"{CAND}/assignments", headers=other).json() == []


def test_assignments_skip_revoked_and_archived_and_flag_expired(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    assert len(env.client.get(f"{CAND}/assignments", headers=ch).json()) == 1
    env.db.one("ai_interview_invites", id=inv_id)["expires_at"] = iso(days=-2)
    assert env.client.get(f"{CAND}/assignments", headers=ch).json()[0]["status"] == "expired"
    env.client.delete(f"{BASE}/{t['id']}", headers=h)  # archive
    assert env.client.get(f"{CAND}/assignments", headers=ch).json() == []


def test_revoked_assignments_disappear(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    env.client.delete(f"{BASE}/{t['id']}/invites/{inv_id}", headers=h)
    assert env.client.get(f"{CAND}/assignments", headers=ch).json() == []


# ═══ candidate: starting a company interview ════════════════════════
def test_starting_from_an_invite_freezes_the_rubric_into_the_room_and_session(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    r = start(env, ch, inv_id)
    assert r.status_code == 200, r.text
    assert r.json()["maxMinutes"] == 25  # the template's duration, not the practice default
    meta = json.loads(FakeLK.created[0].metadata)
    assert meta["domain"] == "custom" and meta["role_title"] == "Backend Engineer"
    assert meta["company_name"] == "Acme" and meta["invite_id"] == inv_id and meta["max_minutes"] == 25
    assert meta["audio_consent"] is True and meta["video_consent"] is True
    assert [c["name"] for c in meta["rubric"]] == ["System design", "Communication"]
    sess = env.db.one("ai_voice_interview_sessions", room_id=r.json()["roomName"])
    assert sess["invite_id"] == inv_id and sess["domain"] == "custom" and sess["rubric_snapshot"] == meta["rubric"]
    inv = env.db.one("ai_interview_invites", id=inv_id)
    assert inv["status"] == "started" and inv["room_id"] == r.json()["roomName"] and inv["student_id"] == "stu-1"
    assert len(FakeLK.dispatched) == 1


def test_an_invite_can_only_be_used_once_and_by_its_owner(env, active):
    h, t, inv_id = active
    stranger = candidate(env, "stu-2", "bob@x.dev")
    assert start(env, stranger, inv_id).status_code == 404
    assert env.db.one("ai_interview_invites", id=inv_id)["status"] == "invited"
    ch = candidate(env)
    assert start(env, ch, inv_id).status_code == 200
    assert start(env, ch, inv_id).status_code == 409           # one attempt
    assert len(FakeLK.created) == 1


@pytest.mark.parametrize("make_unusable, code", [
    (lambda env, t, i, h: env.client.delete(f"{BASE}/{t['id']}/invites/{i}", headers=h), 409),
    (lambda env, t, i, h: env.db.one("ai_interview_invites", id=i).update(expires_at=iso(days=-1)), 410),
    (lambda env, t, i, h: env.client.delete(f"{BASE}/{t['id']}", headers=h), 409),
    (lambda env, t, i, h: env.db.one("ai_interview_invites", id=i).update(status="completed"), 409),
])
def test_unusable_invitations_are_refused_and_start_nothing(env, active, make_unusable, code):
    h, t, inv_id = active
    make_unusable(env, t, inv_id, h)
    assert start(env, candidate(env), inv_id).status_code == code
    assert FakeLK.created == [] and rows(env, "ai_voice_interview_sessions") == []


def test_consents_are_still_required_and_a_refusal_does_not_use_the_attempt(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    for missing in ("consent", "audioConsent", "videoConsent"):
        assert start(env, ch, inv_id, **{missing: False}).status_code == 400, missing
    assert start(env, ch, inv_id, consentVersion="old").status_code == 409
    assert env.db.one("ai_interview_invites", id=inv_id)["status"] == "invited"
    assert start(env, ch, inv_id).status_code == 200


def test_a_livekit_failure_gives_the_attempt_back(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    FakeLK.fail_room = True
    assert start(env, ch, inv_id).status_code == 502
    inv = env.db.one("ai_interview_invites", id=inv_id)
    assert inv["status"] == "invited" and inv["room_id"] is None
    FakeLK.fail_room = False
    assert start(env, ch, inv_id).status_code == 200


def test_a_dispatch_failure_gives_the_attempt_back_and_removes_the_session(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    FakeLK.fail_dispatch = True
    assert start(env, ch, inv_id).status_code == 502
    assert env.db.one("ai_interview_invites", id=inv_id)["status"] == "invited"
    assert rows(env, "ai_voice_interview_sessions") == []
    FakeLK.fail_dispatch = False
    assert start(env, ch, inv_id).status_code == 200


def test_session_request_needs_exactly_one_of_domain_or_invite(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    both = {"domain": "dsa", "inviteId": inv_id, **consents()}
    neither = consents()
    assert env.client.post(f"{CAND}/session", headers=ch, json=both).status_code == 422
    assert env.client.post(f"{CAND}/session", headers=ch, json=neither).status_code == 422
    assert start(env, ch, "not-a-uuid").status_code == 404


def test_company_interviews_do_not_use_up_practice_attempts(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    assert start(env, ch, inv_id).status_code == 200
    cfg = env.client.get(f"{CAND}/config", headers=ch).json()
    assert cfg["usedToday"] == 0 and cfg["remainingToday"] == cfg["dailyLimit"]
    for _ in range(cfg["dailyLimit"]):
        r = env.client.post(f"{CAND}/session", headers=ch, json={"domain": "dsa", **consents()})
        assert r.status_code == 200


def test_practice_is_unchanged_and_keeps_the_candidates_report(env, hr):
    ch = candidate(env)
    r = env.client.post(f"{CAND}/session", headers=ch, json={"domain": "web_dev", **consents()})
    assert r.status_code == 200
    meta = json.loads(FakeLK.created[0].metadata)
    assert meta["domain"] == "web_dev" and "rubric" not in meta and "invite_id" not in meta
    room = r.json()["roomName"]
    assert report(env, room).status_code == 201
    mine = env.client.get(f"{CAND}/reports", headers=ch).json()
    assert [x["room_id"] for x in mine] == [room]
    assert env.client.get(f"{CAND}/reports/{room}", headers=ch).status_code == 200


# ═══ report webhook, candidate privacy ══════════════════════════════
def finished(env, active, **over):
    h, t, inv_id = active
    ch = candidate(env)
    start(env, ch, inv_id)
    room = room_of(env, inv_id)
    assert report(env, room, **over).status_code == 201
    return h, t, inv_id, ch, room


def test_finishing_marks_the_invite_completed_and_keeps_the_report_from_the_candidate(env, active):
    h, t, inv_id, ch, room = finished(env, active)
    inv = env.db.one("ai_interview_invites", id=inv_id)
    assert inv["status"] == "completed" and inv["completed_at"]
    row = env.db.one("ai_voice_interview_reports", room_id=room)
    assert row["candidate_visible"] is False and row["domain"] == "custom"
    assert env.client.get(f"{CAND}/reports", headers=ch).json() == []
    assert env.client.get(f"{CAND}/reports/{room}", headers=ch).status_code == 404
    # ...but they still see that it is done.
    assert env.client.get(f"{CAND}/assignments", headers=ch).json()[0]["status"] == "completed"


def test_competency_scores_are_stored_and_clamped(env, active):
    h, t, inv_id, ch, room = finished(env, active, competency_scores=[
        {"name": "System design", "score": 140, "weight": 60, "evidence": "x"},
        {"name": "Communication", "score": None, "weight": 40}])
    stored = env.db.one("ai_voice_interview_reports", room_id=room)["competency_scores"]
    assert stored[0]["score"] == 100.0 and stored[1]["score"] is None


# ═══ results ════════════════════════════════════════════════════════
def test_results_scoreboard_only_lists_candidates_who_took_it(env, hr):
    h = hr[0]
    t = make_template(env, h)
    invite(env, h, t["id"], "ada@x.dev", "bob@x.dev", "cy@x.dev")
    ada = next(i for i in env.client.get(f"{BASE}/{t['id']}/invites", headers=h).json() if i["email"] == "ada@x.dev")
    ch = candidate(env, "stu-1", "ada@x.dev")
    assert start(env, ch, ada["id"]).status_code == 200
    res = env.client.get(f"{BASE}/{t['id']}/results", headers=h).json()
    assert [r["email"] for r in res["rows"]] == ["ada@x.dev"]
    assert res["rows"][0]["status"] == "started" and res["rows"][0]["overall_score"] is None
    assert res["summary"] == {"taken": 1, "reported": 0, "average_score": None, "flagged": 0}


def test_results_show_scores_competencies_recommendation_and_integrity(env, active):
    h, t, inv_id, ch, room = finished(env, active)
    env.client.post(f"{CAND}/session/{room}/integrity-events", headers=ch, json={"events": []})  # 422, ignored
    env.db.add("ai_voice_interview_integrity_events", room_id=room, student_id="stu-1", kind="tab_hidden",
               offset_seconds=40, source="browser", created_at=iso())
    env.db.add("ai_voice_interview_integrity_events", room_id=room, student_id="stu-1", kind="multiple_faces",
               offset_seconds=90, source="agent", created_at=iso(hours=1))
    res = env.client.get(f"{BASE}/{t['id']}/results", headers=h).json()
    (row,) = res["rows"]
    assert row["overall_score"] == 71 and row["recommendation"] == "Hire" and row["status"] == "completed"
    assert [(c["name"], c["score"]) for c in row["competencies"]] == [("System design", 68), ("Communication", 77)]
    assert row["integrity"] == {"tab_switches": 1, "camera_lost": 0, "mic_lost": 0, "video_flags": 1, "total": 2}
    assert res["summary"] == {"taken": 1, "reported": 1, "average_score": 71.0, "flagged": 1}


def test_candidate_detail_has_the_full_report_consent_record_and_integrity_timeline(env, active):
    h, t, inv_id, ch, room = finished(env, active)
    env.db.add("ai_voice_interview_integrity_events", room_id=room, student_id="stu-1", kind="mic_lost",
               offset_seconds=120, source="browser", created_at=iso())
    d = env.client.get(f"{BASE}/{t['id']}/results/{inv_id}", headers=h).json()
    assert d["candidate"]["email"] == "ada@x.dev" and d["candidate"]["status"] == "completed"
    assert d["report"]["recommendation"] == "Hire" and d["report"]["transcript"] == "Q1 A1"
    assert d["report"]["strengths"] == ["clear"] and d["report"]["report_markdown"] == "# Report"
    assert d["consent"]["audio"] is True and d["consent"]["video"] is True
    assert d["consent"]["accepted_at"] and d["consent"]["version"] == cand.CONSENT_VERSION
    assert d["integrity"]["mic_lost"] == 1
    assert d["integrity_events"] == [{"kind": "mic_lost", "offset_seconds": 120, "source": "browser"}]
    assert d["decision"] == {"decision": None, "note": "", "decided_at": None}


def test_the_report_is_scored_against_the_rubric_the_candidate_actually_saw(env, active):
    h, t, inv_id, ch, room = finished(env, active)
    env.client.patch(f"{BASE}/{t['id']}", headers=h, json={"rubric": [{"name": "Totally different", "weight": 9}]})
    d = env.client.get(f"{BASE}/{t['id']}/results/{inv_id}", headers=h).json()
    assert [c["name"] for c in d["rubric"]] == ["System design", "Communication"]
    assert [c["weight_pct"] for c in d["rubric"]] == [60, 40]


def test_detail_before_a_report_exists_and_for_candidates_who_have_not_started(env, active):
    h, t, inv_id = active
    assert env.client.get(f"{BASE}/{t['id']}/results/{inv_id}", headers=h).status_code == 404
    start(env, candidate(env), inv_id)
    d = env.client.get(f"{BASE}/{t['id']}/results/{inv_id}", headers=h).json()
    assert d["report"] is None and d["candidate"]["status"] == "started"


def test_browser_integrity_events_reach_the_hiring_team_end_to_end(env, active):
    h, t, inv_id = active
    ch = candidate(env)
    room = start(env, ch, inv_id).json()["roomName"]
    posted = env.client.post(f"{CAND}/session/{room}/integrity-events", headers=ch,
                             json={"events": [{"kind": "tab_hidden", "offsetSeconds": 33}]})
    assert posted.json() == {"accepted": 1}
    video = env.client.post("/internal/ai-interview-integrity", headers=AUTH, json={
        "room_id": room, "events": [{"kind": "no_face", "offset_seconds": 60}]})
    assert video.status_code == 201
    report(env, room)
    d = env.client.get(f"{BASE}/{t['id']}/results/{inv_id}", headers=h).json()
    assert [(e["kind"], e["source"]) for e in d["integrity_events"]] == [
        ("tab_hidden", "browser"), ("no_face", "agent")]
    assert d["integrity"]["total"] == 2


# ═══ decisions ══════════════════════════════════════════════════════
def test_the_hiring_team_records_and_clears_its_own_decision(env, active):
    h, t, inv_id, ch, room = finished(env, active)
    url = f"{BASE}/{t['id']}/results/{inv_id}/decision"
    r = env.client.put(url, headers=h, json={"decision": "advance", "note": "  Strong on design.  "})
    assert r.json() == {"decision": "advance", "note": "Strong on design."}
    inv = env.db.one("ai_interview_invites", id=inv_id)
    assert inv["decision"] == "advance" and inv["decided_by"] == "hr-1" and inv["decided_at"]
    listed = env.client.get(f"{BASE}/{t['id']}/invites", headers=h).json()[0]
    assert listed["decision"] == "advance"
    assert env.client.get(f"{BASE}/{t['id']}/results/{inv_id}", headers=h).json()["decision"]["note"] == "Strong on design."
    env.client.put(url, headers=h, json={"decision": None})
    inv = env.db.one("ai_interview_invites", id=inv_id)
    assert inv["decision"] is None and inv["decided_by"] is None and inv["decision_note"] is None


def test_decisions_are_validated_and_need_a_candidate_who_took_the_interview(env, active):
    h, t, inv_id = active
    url = f"{BASE}/{t['id']}/results/{inv_id}/decision"
    assert env.client.put(url, headers=h, json={"decision": "advance"}).status_code == 409  # not started
    start(env, candidate(env), inv_id)
    assert env.client.put(url, headers=h, json={"decision": "maybe"}).status_code == 422
    assert env.client.put(url, headers=h, json={"decision": "hold", "note": "x" * 1001}).status_code == 422
    assert env.db.one("ai_interview_invites", id=inv_id).get("decision") is None


def test_candidates_cannot_read_results_or_set_decisions(env, active):
    h, t, inv_id, ch, room = finished(env, active)
    assert env.client.get(f"{BASE}/{t['id']}/results/{inv_id}", headers=ch).status_code == 403
    assert env.client.put(f"{BASE}/{t['id']}/results/{inv_id}/decision", headers=ch,
                          json={"decision": "advance"}).status_code == 403
