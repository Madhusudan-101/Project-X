"""Integration: company profile, legacy roles, jobs, drives, rounds, applicants (tenant isolation included)."""
from datetime import date, datetime, timedelta, timezone

import pytest

TODAY = date.today()


def future(days=14): return (TODAY + timedelta(days=days)).isoformat()
def past(days=3): return (TODAY - timedelta(days=days)).isoformat()
def iso(days=0, hours=0):
    return (datetime.now(timezone.utc) + timedelta(days=days, hours=hours)).isoformat()


WEIGHTS = dict(resume_weight=40, github_weight=20, leetcode_weight=20, interview_weight=10, assessment_weight=10)


def job_body(**over):
    body = dict(title="Backend Engineer", description="Build and run reliable APIs for our platform.",
                domain="tech", experience_level="fresher", location="Pune", openings_count=3,
                deadline=future(), weights=WEIGHTS, skills=["Python", "SQL"])
    body.update(over)
    return body


# ── company profile ─────────────────────────────────────────────────
def test_company_me_get_patch(env):
    h, company = env.company_user()
    assert env.client.get("/company/me", headers=h).json()["name"] == "Acme"
    r = env.client.patch("/company/me", headers=h, json={"website": "https://acme.dev", "hiring_domains": ["tech", "non-tech"]})
    assert r.status_code == 200 and r.json()["website"] == "https://acme.dev"
    assert env.db.one("companies", id=company["id"])["hiring_domains"] == ["tech", "non-tech"]


def test_company_patch_creates_row_on_first_run_only_with_required_fields(env):
    h = env.user("hr-new", "company")
    assert env.client.get("/company/me", headers=h).status_code == 404
    bad = env.client.patch("/company/me", headers=h, json={"website": "https://x.dev"})
    assert bad.status_code in (400, 422)
    ok = env.client.patch("/company/me", headers=h, json={"name": "NewCo", "industry": "FinTech", "size": "1-10"})
    assert ok.status_code == 200 and ok.json()["name"] == "NewCo"
    assert len(env.db.rows("companies", owner_id="hr-new")) == 1


# ── legacy roles ─────────────────────────────────────────────────────
ROLE = dict(title="SDE Intern", description="Learn and ship.", required_skills=["Python"],
            experience_level="fresher", minimum_employability_score=60)


def test_role_lifecycle_and_validation(env):
    h, _ = env.company_user()
    r = env.client.post("/company/roles", headers=h, json={**ROLE, "deadline": future()})
    assert r.status_code == 201 and r.json()["status"] == "draft"
    rid = r.json()["id"]
    assert env.client.patch(f"/company/roles/{rid}", headers=h, json={"title": "SDE Intern II"}).json()["title"] == "SDE Intern II"
    assert env.client.post(f"/company/roles/{rid}/publish", headers=h).json()["status"] == "published"
    assert [x["id"] for x in env.client.get("/company/roles?status=published", headers=h).json()] == [rid]
    assert env.client.get("/company/roles?status=draft", headers=h).json() == []
    assert env.client.post(f"/company/roles/{rid}/archive", headers=h).json()["status"] == "archived"
    assert env.client.get("/company/roles?status=bogus", headers=h).status_code == 400
    assert env.client.delete(f"/company/roles/{rid}", headers=h).status_code == 204
    assert env.client.get(f"/company/roles/{rid}", headers=h).status_code == 404
    assert env.client.delete(f"/company/roles/{rid}", headers=h).status_code == 404


def test_role_cannot_publish_with_past_deadline_or_bad_score(env):
    h, _ = env.company_user()
    rid = env.client.post("/company/roles", headers=h, json={**ROLE, "deadline": past()}).json()["id"]
    r = env.client.post(f"/company/roles/{rid}/publish", headers=h)
    assert r.status_code == 400 and "deadline" in r.json()["detail"]
    assert env.client.post("/company/roles", headers=h, json={**ROLE, "deadline": future(), "minimum_employability_score": 500}).status_code == 422


def test_roles_are_tenant_isolated(env):
    h1, _ = env.company_user("hr-1", "A")
    h2, _ = env.company_user("hr-2", "B")
    rid = env.client.post("/company/roles", headers=h1, json={**ROLE, "deadline": future()}).json()["id"]
    assert env.client.get(f"/company/roles/{rid}", headers=h2).status_code == 404
    assert env.client.patch(f"/company/roles/{rid}", headers=h2, json={"title": "Hacked"}).status_code == 404
    assert env.client.post(f"/company/roles/{rid}/archive", headers=h2).status_code == 404
    assert env.client.delete(f"/company/roles/{rid}", headers=h2).status_code == 404
    assert env.client.get("/company/roles", headers=h2).json() == []
    assert env.db.one("job_roles", id=rid)["title"] == "SDE Intern"


# ── jobs ─────────────────────────────────────────────────────────────
def test_job_create_draft_then_publish_close(env):
    h, _ = env.company_user()
    r = env.client.post("/company/jobs", headers=h, json=job_body())
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["status"] == "draft" and job["skills"] == ["Python", "SQL"] and job["weights"]["resume_weight"] == 40
    jid = job["id"]
    assert env.client.post(f"/company/jobs/{jid}/publish", headers=h).json()["status"] == "live"
    assert env.client.get("/company/jobs?status=live", headers=h).json()[0]["id"] == jid
    assert env.client.post(f"/company/jobs/{jid}/close", headers=h).json()["status"] == "closed"
    assert env.client.get("/company/jobs?status=nope", headers=h).status_code == 400


def test_job_create_with_publish_flag_and_past_deadline(env):
    h, _ = env.company_user()
    assert env.client.post("/company/jobs", headers=h, json=job_body(publish=True)).json()["status"] == "live"
    r = env.client.post("/company/jobs", headers=h, json=job_body(publish=True, deadline=past()))
    assert r.status_code == 400
    # drafting with a past deadline is allowed, publishing it later is not
    jid = env.client.post("/company/jobs", headers=h, json=job_body(deadline=past())).json()["id"]
    assert env.client.post(f"/company/jobs/{jid}/publish", headers=h).status_code == 400


@pytest.mark.parametrize("patch", [
    dict(weights={**WEIGHTS, "resume_weight": 90}),
    dict(title="x"), dict(openings_count=0), dict(domain="other"), dict(ctc_min=50, ctc_max=10), dict(stipend_min=-5),
])
def test_job_create_rejects_invalid_payloads(env, patch):
    h, _ = env.company_user()
    assert env.client.post("/company/jobs", headers=h, json=job_body(**patch)).status_code == 422
    assert env.db.rows("jobs") == []


def test_job_skills_are_reused_case_insensitively_and_customs_added(env):
    h, _ = env.company_user()
    env.db.add("skills", name="Python", is_predefined=True)
    env.client.post("/company/jobs", headers=h, json=job_body(skills=["python", "PYTHON", " Rust "]))
    names = sorted(s["name"] for s in env.db.rows("skills"))
    assert names == ["Python", "Rust"]
    assert env.db.one("skills", name="Rust")["is_predefined"] is False


def test_job_restricted_visibility_rules(env):
    h, _ = env.company_user()
    assert env.client.post("/company/jobs", headers=h, json=job_body(visibility="restricted")).status_code == 422
    env.college("col-1")
    r = env.client.post("/company/jobs", headers=h, json=job_body(visibility="restricted", visible_college_ids=["col-1"]))
    assert r.status_code == 201 and r.json()["visible_college_ids"] == ["col-1"]
    # opening it back up clears the college list
    jid = r.json()["id"]
    r = env.client.patch(f"/company/jobs/{jid}", headers=h, json={"visibility": "all"})
    assert r.json()["visibility"] == "all" and r.json()["visible_college_ids"] == []


def test_job_cannot_become_restricted_with_no_colleges(env):
    h, _ = env.company_user()
    jid = env.client.post("/company/jobs", headers=h, json=job_body()).json()["id"]
    r = env.client.patch(f"/company/jobs/{jid}", headers=h, json={"visibility": "restricted"})
    assert r.status_code == 400
    assert env.db.one("jobs", id=jid)["visibility"] == "all"


def test_job_patch_updates_only_given_fields_and_weights_skills(env):
    h, _ = env.company_user()
    jid = env.client.post("/company/jobs", headers=h, json=job_body()).json()["id"]
    r = env.client.patch(f"/company/jobs/{jid}", headers=h, json={
        "location": "Remote", "skills": ["Go"],
        "weights": dict(resume_weight=10, github_weight=10, leetcode_weight=10, interview_weight=10, assessment_weight=60)})
    j = r.json()
    assert j["location"] == "Remote" and j["title"] == "Backend Engineer"
    assert j["skills"] == ["Go"] and j["weights"]["assessment_weight"] == 60
    assert env.client.patch(f"/company/jobs/{jid}", headers=h, json={"weights": {**WEIGHTS, "resume_weight": 99}}).status_code == 422


def test_job_screening_questions_roundtrip(env):
    h, _ = env.company_user()
    qs = [{"question_text": "Why us?", "required": True, "position": 0}, {"question_text": "Notice period?", "required": False, "position": 1}]
    j = env.client.post("/company/jobs", headers=h, json=job_body(screening_questions=qs)).json()
    assert [q["question_text"] for q in j["screening_questions"]] == ["Why us?", "Notice period?"]
    j = env.client.patch(f"/company/jobs/{j['id']}", headers=h, json={"screening_questions": []}).json()
    assert j["screening_questions"] == []


def test_jobs_are_tenant_isolated(env):
    h1, _ = env.company_user("hr-1", "A")
    h2, _ = env.company_user("hr-2", "B")
    jid = env.client.post("/company/jobs", headers=h1, json=job_body()).json()["id"]
    for method, path, kw in [
        ("get", f"/company/jobs/{jid}", {}), ("patch", f"/company/jobs/{jid}", {"json": {"title": "Hijack"}}),
        ("post", f"/company/jobs/{jid}/publish", {}), ("post", f"/company/jobs/{jid}/close", {}),
        ("get", f"/company/jobs/{jid}/applicants", {}), ("get", f"/company/jobs/{jid}/drives", {}),
        ("post", f"/company/jobs/{jid}/drives", {"json": {"college_id": "c", "apply_deadline": iso(5)}}),
    ]:
        assert getattr(env.client, method)(path, headers=h2, **kw).status_code == 404, (method, path)
    assert env.client.get("/company/jobs", headers=h2).json() == []
    assert env.db.one("jobs", id=jid)["title"] == "Backend Engineer"


def test_jobs_require_a_company_row(env):
    h = env.user("hr-bare", "company")
    assert env.client.get("/company/jobs", headers=h).status_code == 404


def test_draft_description_surfaces_missing_ai_key_as_503(env, monkeypatch):
    h, _ = env.company_user()
    import app.routers.company.jobs as jobs_router

    async def boom(**kw): raise RuntimeError("GEMINI_API_KEY is not set")
    monkeypatch.setattr(jobs_router, "draft_job_description", boom)
    r = env.client.post("/company/jobs/draft-description", headers=h, json={"brief": "senior backend role for payments"})
    assert r.status_code == 503


# ── drives & rounds ──────────────────────────────────────────────────
def make_job(env, h, **over):
    return env.client.post("/company/jobs", headers=h, json=job_body(**over)).json()["id"]


def test_drive_lifecycle_with_rounds(env):
    h, _ = env.company_user()
    env.college("col-1")
    jid = make_job(env, h)
    body = {"college_id": "col-1", "apply_deadline": iso(7), "min_cgpa": 7.5, "eligible_branches": ["CSE"],
            "rounds": [{"round_number": 1, "round_type": "tech", "mode": "ai"},
                       {"round_number": 2, "round_type": "hr", "mode": "live"}]}
    r = env.client.post(f"/company/jobs/{jid}/drives", headers=h, json=body)
    assert r.status_code == 201, r.text
    did = r.json()["id"]
    assert r.json()["status"] == "draft" and len(env.db.rows("job_drive_rounds", drive_id=did)) == 2
    # cannot publish until each round has a window
    pub = env.client.post(f"/company/jobs/{jid}/drives/{did}/publish", headers=h)
    assert pub.status_code == 400 and "[1, 2]" in pub.json()["detail"]
    for rd in env.db.rows("job_drive_rounds", drive_id=did):
        env.db.one("job_drive_rounds", id=rd["id"]).update(window_start=iso(8), window_end=iso(9))
    assert env.client.post(f"/company/jobs/{jid}/drives/{did}/publish", headers=h).json()["status"] == "live"
    assert env.client.post(f"/company/jobs/{jid}/drives/{did}/close", headers=h).json()["status"] == "closed"
    # a second drive for the same college is a conflict
    assert env.client.post(f"/company/jobs/{jid}/drives", headers=h, json=body).status_code == 409


def test_drive_validation(env):
    h, _ = env.company_user()
    jid = make_job(env, h)
    base = {"college_id": "c", "apply_deadline": iso(3)}
    assert env.client.post(f"/company/jobs/{jid}/drives", headers=h, json={**base, "min_cgpa": 11}).status_code == 422
    assert env.client.post(f"/company/jobs/{jid}/drives", headers=h,
                           json={**base, "oa_window_start": iso(5), "oa_window_end": iso(4)}).status_code == 422
    assert env.client.post(f"/company/jobs/{jid}/drives", headers=h,
                           json={**base, "rounds": [{"round_number": 2, "round_type": "tech", "mode": "ai"}]}).status_code == 422
    assert env.client.post(f"/company/jobs/{jid}/drives", headers=h,
                           json={**base, "rounds": [{"round_number": 1, "round_type": "bogus", "mode": "ai"}]}).status_code == 422


def test_drive_windows_compared_as_instants_not_strings(env):
    """10:00+05:30 is 04:30Z, i.e. BEFORE 09:00Z even though it sorts after as text."""
    h, _ = env.company_user()
    jid = make_job(env, h)
    r = env.client.post(f"/company/jobs/{jid}/drives", headers=h, json={
        "college_id": "c", "apply_deadline": iso(3),
        "oa_window_start": "2030-01-01T09:00:00+00:00", "oa_window_end": "2030-01-01T10:00:00+05:30"})
    assert r.status_code == 422
    r = env.client.post(f"/company/jobs/{jid}/drives", headers=h, json={
        "college_id": "c", "apply_deadline": iso(3),
        "oa_window_start": "2030-01-01T10:00:00+05:30", "oa_window_end": "2030-01-01T09:00:00+00:00"})
    assert r.status_code == 201, r.text


def test_round_numbers_must_be_gap_free(env):
    h, _ = env.company_user()
    jid = make_job(env, h)
    did = env.client.post(f"/company/jobs/{jid}/drives", headers=h, json={"college_id": "c", "apply_deadline": iso(3)}).json()["id"]
    rd = lambda n: env.client.post(f"/company/jobs/{jid}/drives/{did}/rounds", headers=h,
                                   json={"round_number": n, "round_type": "tech", "mode": "ai"})
    assert rd(2).status_code == 400
    assert rd(1).status_code == 201
    assert rd(1).status_code == 400
    assert rd(2).status_code == 201


def test_drive_belonging_to_another_job_is_not_reachable(env):
    h, _ = env.company_user()
    j1, j2 = make_job(env, h), make_job(env, h, title="Frontend Engineer")
    did = env.client.post(f"/company/jobs/{j1}/drives", headers=h, json={"college_id": "c", "apply_deadline": iso(3)}).json()["id"]
    assert env.client.get(f"/company/jobs/{j2}/drives/{did}", headers=h).status_code == 404
    assert env.client.post(f"/company/jobs/{j2}/drives/{did}/close", headers=h).status_code == 404


def test_company_dashboard_funnel_counts_are_integers(env):
    h, _ = env.company_user()
    r = env.client.get("/company/dashboard/funnel", headers=h)
    assert r.status_code == 200
    assert all(isinstance(v, int) for v in r.json().values())


# ── applicants (needs applications) ──────────────────────────────────
def seed_application(env, company, job_id, sid, status="scored", prob=None, composite=None):
    env.db.add("profiles", id=sid, email=f"{sid}@t.dev", role="candidate", name=f"Student {sid}")
    app = env.db.add("applications", student_id=sid, job_id=job_id, company_id=company["id"], status=status, applied_at=iso())
    if prob is not None:
        env.db.add("application_analyses", application_id=app["id"], student_id=sid, job_id=job_id, company_id=company["id"],
                   analysis_json={}, placement_probability=prob, weighted_composite=composite, weights_snapshot=WEIGHTS,
                   generated_at=iso())
    return app


def test_applicants_ranked_by_probability_with_unscored_last(env):
    h, company = env.company_user()
    jid = make_job(env, h)
    seed_application(env, company, jid, "s1", prob=40, composite=55)
    seed_application(env, company, jid, "s2", prob=90, composite=70)
    seed_application(env, company, jid, "s3", status="scoring")
    rows = env.client.get(f"/company/jobs/{jid}/applicants", headers=h).json()
    assert [r["student_id"] for r in rows] == ["s2", "s1", "s3"]
    assert rows[2]["has_analysis"] is False and rows[2]["placement_probability"] is None
    by_comp = env.client.get(f"/company/jobs/{jid}/applicants?sort_by=weighted_composite", headers=h).json()
    assert [r["student_id"] for r in by_comp][:2] == ["s2", "s1"]
    assert env.client.get(f"/company/jobs/{jid}/applicants?sort_by=name", headers=h).status_code == 400


def test_applicant_detail_and_status_update(env):
    h, company = env.company_user()
    jid = make_job(env, h)
    app = seed_application(env, company, jid, "s1", prob=70, composite=60)
    d = env.client.get(f"/company/jobs/{jid}/applicants/{app['id']}", headers=h)
    assert d.status_code == 200 and d.json()["placement_probability"] == 70
    r = env.client.patch(f"/company/jobs/{jid}/applicants/{app['id']}/status", headers=h, json={"status": "shortlisted"})
    assert r.status_code == 200 and r.json()["status"] == "shortlisted"
    for bad in ("scoring", "scored", "banana", ""):
        assert env.client.patch(f"/company/jobs/{jid}/applicants/{app['id']}/status", headers=h, json={"status": bad}).status_code == 422
    assert env.db.one("applications", id=app["id"])["status"] == "shortlisted"


def test_unscored_applicant_detail_is_409(env):
    h, company = env.company_user()
    jid = make_job(env, h)
    app = seed_application(env, company, jid, "s1", status="scoring")
    assert env.client.get(f"/company/jobs/{jid}/applicants/{app['id']}", headers=h).status_code == 409


def test_company_cannot_touch_other_companies_applications(env):
    h1, c1 = env.company_user("hr-1", "A")
    h2, c2 = env.company_user("hr-2", "B")
    j1 = make_job(env, h1)
    j2 = make_job(env, h2)
    app = seed_application(env, c1, j1, "s1", prob=50, composite=50)
    # via the other company's own job id
    assert env.client.get(f"/company/jobs/{j2}/applicants/{app['id']}", headers=h2).status_code == 404
    assert env.client.patch(f"/company/jobs/{j2}/applicants/{app['id']}/status", headers=h2, json={"status": "hired"}).status_code == 404
    # via the victim's job id
    assert env.client.get(f"/company/jobs/{j1}/applicants/{app['id']}", headers=h2).status_code == 404
    assert env.client.patch(f"/company/jobs/{j1}/applicants/{app['id']}/status", headers=h2, json={"status": "hired"}).status_code == 404
    assert env.db.one("applications", id=app["id"])["status"] == "scored"
