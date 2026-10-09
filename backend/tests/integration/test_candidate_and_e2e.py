"""Integration: candidate job board / apply / tracker, and the full cross-portal journey
(company -> drive -> college roster -> candidate apply -> scoring -> company review -> candidate sees result)."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

WEIGHTS = dict(resume_weight=40, github_weight=20, leetcode_weight=20, interview_weight=10, assessment_weight=10)


def iso(days=0, hours=0):
    return (datetime.now(timezone.utc) + timedelta(days=days, hours=hours)).isoformat()


class Score:
    """Stands in for the Gemini scoring call (the only non-DB external dependency of the apply flow)."""

    def __init__(self, resume=80, github=60, leetcode=50, interview=None, assessment=None, probability=72):
        d = lambda v: SimpleNamespace(score=v)
        self.dimensions = SimpleNamespace(resume=d(resume), github=d(github), leetcode=d(leetcode), interview=d(interview),
                                          assessment=d(assessment))
        self.placement_probability = probability

    def model_dump(self, mode="json"):
        return {"placement_probability": self.placement_probability, "summary": "ok"}


@pytest.fixture
def scoring(monkeypatch):
    import app.services.candidate.application_scoring_service as svc
    import app.routers.candidate.jobs as cand_jobs
    state = SimpleNamespace(result=Score(), calls=0, fail=False, has_resume=True)

    async def fake_score(**kw):
        state.calls += 1
        if state.fail:
            raise ValueError("model exploded")
        return state.result

    prev = SimpleNamespace(resume_text="Python dev", portfolio={}, result={})
    monkeypatch.setattr(svc, "score_application", fake_score)
    monkeypatch.setattr(svc, "load_previous_analysis", lambda sid: prev if state.has_resume else None)
    monkeypatch.setattr(cand_jobs, "student_has_scoring_inputs", lambda sid: state.has_resume)
    return state


@pytest.fixture
def world(env):
    """A company with a live job + a live drive at col-1, a TPO, and a candidate studying at col-1."""
    env.college("col-1", "Alpha College")
    env.college("col-2", "Beta College")
    hr, company = env.company_user()
    job = env.db.add("jobs", company_id=company["id"], title="Backend Engineer", description="Build APIs " * 5, domain="tech",
                     experience_level="fresher", location="Pune", openings_count=2, deadline="2099-01-01", visibility="all",
                     status="live", employment_type="full-time")
    env.db.add("job_weights", job_id=job["id"], **WEIGHTS)
    drive = env.db.add("job_drives", job_id=job["id"], college_id="col-1", status="live", is_on_campus=True,
                       apply_deadline=iso(days=7), min_cgpa=7.0, eligible_branches=["CSE"], eligible_batch_years=[2026])
    cand = env.user("cand-1", "candidate", profile={"college_id": "col-1", "domain": "tech", "cgpa": 8.5, "branch": "Computer Science",
                                                   "graduation_year": 2026, "name": "Cara Cand"})
    return SimpleNamespace(hr=hr, company=company, job=job, drive=drive, cand=cand)


def board(env, w): return env.client.get("/candidate/jobs", headers=w.cand)


def test_board_shows_live_drive_with_eligibility_flag(env, world):
    cards = board(env, world).json()
    assert [c["id"] for c in cards] == [world.job["id"]]
    c = cards[0]
    assert c["company_name"] == "Acme" and c["eligible"] is True and c["already_applied"] is False


@pytest.mark.parametrize("profile,reason", [
    (dict(cgpa=6.0), "CGPA"), (dict(cgpa=None), "CGPA"), (dict(branch="Mechanical"), "branches"),
    (dict(graduation_year=2024), "batches"), (dict(graduation_year=None), "batches"),
])
def test_ineligible_student_sees_flag_and_cannot_apply(env, world, scoring, profile, reason):
    env.db.one("profiles", id="cand-1").update(profile)
    assert board(env, world).json()[0]["eligible"] is False
    d = env.client.get(f"/candidate/jobs/{world.job['id']}", headers=world.cand).json()
    assert d["eligible"] is False and reason in d["ineligible_reason"]
    r = env.client.post(f"/candidate/jobs/{world.job['id']}/apply", headers=world.cand)
    assert r.status_code == 403 and reason in r.json()["detail"]
    assert env.db.rows("applications") == []


@pytest.mark.parametrize("mutate", [
    lambda e, w: e.db.one("jobs", id=w.job["id"]).update(status="draft"),
    lambda e, w: e.db.one("jobs", id=w.job["id"]).update(status="closed"),
    lambda e, w: e.db.one("jobs", id=w.job["id"]).update(domain="non-tech"),
    lambda e, w: e.db.one("job_drives", id=w.drive["id"]).update(status="draft"),
    lambda e, w: e.db.one("job_drives", id=w.drive["id"]).update(status="closed"),
    lambda e, w: e.db.one("job_drives", id=w.drive["id"]).update(college_id="col-2"),
    lambda e, w: e.db.one("profiles", id="cand-1").update(college_id="col-2"),
    lambda e, w: e.db.one("profiles", id="cand-1").update(college_id=None),
])
def test_job_is_invisible_when_not_live_for_this_student(env, world, mutate):
    mutate(env, world)
    assert board(env, world).json() == []
    assert env.client.get(f"/candidate/jobs/{world.job['id']}", headers=world.cand).status_code == 404
    assert env.client.post(f"/candidate/jobs/{world.job['id']}/apply", headers=world.cand).status_code == 404


def test_cannot_apply_after_the_apply_deadline(env, world, scoring):
    env.db.one("job_drives", id=world.drive["id"]).update(apply_deadline=iso(hours=-1))
    assert board(env, world).json() == []                       # hidden from the board…
    r = env.client.post(f"/candidate/jobs/{world.job['id']}/apply", headers=world.cand)
    assert r.status_code == 403 and "closed" in r.json()["detail"].lower()      # …and refused by id
    assert env.db.rows("applications") == []
    r = env.client.post(f"/candidate/jobs/{world.job['id']}/application-drafts", headers=world.cand)
    assert r.status_code == 403
    # an existing applicant can still open the detail page to see their status
    assert env.client.get(f"/candidate/jobs/{world.job['id']}", headers=world.cand).status_code == 200


def test_apply_requires_resume_analysis_first(env, world, scoring):
    scoring.has_resume = False
    r = env.client.post(f"/candidate/jobs/{world.job['id']}/apply", headers=world.cand)
    assert r.status_code == 409 and "resume" in r.json()["detail"].lower()
    assert env.db.rows("applications") == []


def test_apply_scores_in_background_and_tracker_reflects_it(env, world, scoring):
    r = env.client.post(f"/candidate/jobs/{world.job['id']}/apply", headers=world.cand)
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "scoring"
    app_row = env.db.one("applications", student_id="cand-1")
    assert app_row["status"] == "scored" and scoring.calls == 1          # background task finished
    an = env.db.one("application_analyses", application_id=app_row["id"])
    # (80*40 + 60*20 + 50*20) / 80 = 67.5
    assert an["weighted_composite"] == 67.5 and an["placement_probability"] == 72
    assert an["weights_snapshot"] == WEIGHTS
    tr = env.client.get("/candidate/jobs/applications", headers=world.cand).json()
    assert tr[0]["status"] == "scored" and tr[0]["placement_probability"] == 72 and tr[0]["job_title"] == "Backend Engineer"
    assert board(env, world).json()[0]["already_applied"] is True
    mine = env.client.get(f"/candidate/jobs/applications/{app_row['id']}", headers=world.cand)
    assert mine.status_code == 200 and mine.json()["weighted_composite"] == 67.5


def test_double_apply_is_a_conflict_and_leaves_one_application(env, world, scoring):
    url = f"/candidate/jobs/{world.job['id']}/apply"
    assert env.client.post(url, headers=world.cand).status_code == 201
    assert env.client.post(url, headers=world.cand).status_code == 409
    assert len(env.db.rows("applications")) == 1 and scoring.calls == 1


def test_scoring_failure_resets_status_and_writes_nothing(env, world, scoring):
    scoring.fail = True
    assert env.client.post(f"/candidate/jobs/{world.job['id']}/apply", headers=world.cand).status_code == 201
    a = env.db.one("applications", student_id="cand-1")
    assert a["status"] == "applied"
    assert env.db.rows("application_analyses") == []
    assert env.client.get(f"/candidate/jobs/applications/{a['id']}", headers=world.cand).status_code == 409


def test_screening_questions_are_enforced_and_stored(env, world, scoring):
    q1 = env.db.add("job_screening_questions", job_id=world.job["id"], question_text="Why us?", required=True, position=0)
    q2 = env.db.add("job_screening_questions", job_id=world.job["id"], question_text="Notice?", required=False, position=1)
    url = f"/candidate/jobs/{world.job['id']}/apply"
    assert board(env, world).json()[0]["has_screening_questions"] is True
    assert env.client.post(url, headers=world.cand).status_code == 400
    assert env.client.post(url, headers=world.cand, json={"screening_answers": [{"question_id": q1["id"], "answer": "   "}]}).status_code == 400
    r = env.client.post(url, headers=world.cand, json={
        "cover_letter": "  Hello  ",
        "screening_answers": [{"question_id": q1["id"], "answer": "Great team"}, {"question_id": "forged-id", "answer": "x"}]})
    assert r.status_code == 201, r.text
    stored = env.db.rows("application_screening_answers")
    assert [(a["question_id"], a["answer"]) for a in stored] == [(q1["id"], "Great team")]
    assert env.db.one("applications", student_id="cand-1")["cover_letter"] == "Hello"


def test_candidates_cannot_read_each_others_applications(env, world, scoring):
    env.client.post(f"/candidate/jobs/{world.job['id']}/apply", headers=world.cand)
    app_id = env.db.one("applications", student_id="cand-1")["id"]
    other = env.user("cand-2", "candidate", profile={"college_id": "col-1", "domain": "tech"})
    for path in (f"/candidate/jobs/applications/{app_id}", f"/candidate/jobs/applications/{app_id}/rounds",
                 f"/candidate/jobs/applications/{app_id}/prep-plan"):
        assert env.client.get(path, headers=other).status_code == 404, path
    assert env.client.get("/candidate/jobs/applications", headers=other).json() == []


def test_rounds_are_revealed_one_at_a_time(env, world, scoring):
    r1 = env.db.add("job_drive_rounds", drive_id=world.drive["id"], round_number=1, round_type="tech", mode="ai")
    r2 = env.db.add("job_drive_rounds", drive_id=world.drive["id"], round_number=2, round_type="hr", mode="live")
    env.client.post(f"/candidate/jobs/{world.job['id']}/apply", headers=world.cand)
    app_id = env.db.one("applications", student_id="cand-1")["id"]
    url = f"/candidate/jobs/applications/{app_id}/rounds"
    assert [r["round_number"] for r in env.client.get(url, headers=world.cand).json()] == [1]
    env.db.add("application_round_results", application_id=app_id, round_id=r1["id"], status="shortlisted")
    assert [r["round_number"] for r in env.client.get(url, headers=world.cand).json()] == [1, 2]
    tr = env.client.get("/candidate/jobs/applications", headers=world.cand).json()[0]
    assert (tr["current_round"], tr["total_rounds"]) == (2, 2)


def test_job_detail_hides_company_internals(env, world):
    d = env.client.get(f"/candidate/jobs/{world.job['id']}", headers=world.cand).json()
    assert "weights" not in d and "resume_weight" not in str(d)
    assert d["drive_id"] == world.drive["id"]


def test_candidate_job_routes_require_candidate_role(env, world):
    assert env.client.get("/candidate/jobs").status_code == 401
    assert env.client.get("/candidate/jobs", headers=world.hr).status_code == 403
    assert env.client.post(f"/candidate/jobs/{world.job['id']}/apply", headers=world.hr).status_code == 403


# ── the full cross-portal journey ───────────────────────────────────
def test_full_journey_company_college_candidate(env, scoring):
    c = env.client

    # 1. Company signs up and drafts + publishes a job
    r = c.post("/auth/company-signup", json={"email": "hr@acme.dev", "password": "Passw0rd!x", "first_name": "Hana",
                                            "last_name": "Roe", "company_name": "Acme", "industry": "Software", "size": "11-50"})
    assert r.status_code == 200
    hr = {"Authorization": f"Bearer {r.json()['token']}"}
    col = env.college("col-1", "Alpha College")
    job = c.post("/company/jobs", headers=hr, json=dict(
        title="Backend Engineer", description="Own and scale the platform APIs end to end.", domain="tech",
        experience_level="fresher", location="Pune", openings_count=2,
        deadline=(datetime.now().date() + timedelta(days=30)).isoformat(), weights=WEIGHTS, skills=["Python"],
        min_cgpa=7, ctc_min=800000, ctc_max=1200000)).json()
    assert c.post(f"/company/jobs/{job['id']}/publish", headers=hr).json()["status"] == "live"

    # 2. Company opens a drive at the college (with one AI round) and publishes it
    drive = c.post(f"/company/jobs/{job['id']}/drives", headers=hr, json={
        "college_id": col["id"], "apply_deadline": iso(days=10), "min_cgpa": 7.0, "eligible_branches": ["CSE"],
        "rounds": [{"round_number": 1, "round_type": "tech", "mode": "ai", "window_start": iso(days=11), "window_end": iso(days=12)}]}).json()
    assert c.post(f"/company/jobs/{job['id']}/drives/{drive['id']}/publish", headers=hr).json()["status"] == "live"

    # 3. The college's TPO uploads the roster
    tpo = env.user("tpo-1", "college", profile={"college_id": col["id"]})
    up = c.post("/api/students/upload", headers=tpo, files={"file": ("r.csv", b"name,email,branch,graduationYear\nCara,cara@x.com,CSE,2026\n", "text/csv")})
    assert up.status_code == 201

    # 4. A candidate signs up, completes onboarding and sees the job
    su = c.post("/auth/signup", json={"email": "cara@x.com", "password": "Passw0rd!x", "role": "candidate", "name": "Cara Cand"})
    cand = {"Authorization": f"Bearer {su.json()['token']}"}
    prof = c.patch("/auth/profile", headers=cand, json={"collegeName": "Alpha College", "domain": "tech", "branch": "CSE",
                                                        "cgpa": 8.9, "graduationYear": 2026, "onboarded": True})
    assert prof.json()["collegeId"] == col["id"]                    # resolved to the SAME college row the drive uses
    cards = c.get("/candidate/jobs", headers=cand).json()
    assert [x["id"] for x in cards] == [job["id"]] and cards[0]["eligible"] is True

    # 5. Candidate applies; scoring runs
    assert c.post(f"/candidate/jobs/{job['id']}/apply", headers=cand).status_code == 201
    assert c.post(f"/candidate/jobs/{job['id']}/apply", headers=cand).status_code == 409

    # 6. Company sees the ranked applicant, reviews the analysis and shortlists them
    rows = c.get(f"/company/jobs/{job['id']}/applicants", headers=hr).json()
    assert len(rows) == 1 and rows[0]["student_name"] == "Cara Cand" and rows[0]["has_analysis"] is True
    assert rows[0]["weighted_composite"] == 67.5
    app_id = rows[0]["application_id"]
    assert c.get(f"/company/jobs/{job['id']}/applicants/{app_id}", headers=hr).status_code == 200
    assert c.patch(f"/company/jobs/{job['id']}/applicants/{app_id}/status", headers=hr, json={"status": "shortlisted"}).json()["status"] == "shortlisted"

    # 7. The drive roster reflects the applicant, and the funnel counts her
    drives = c.get(f"/company/jobs/{job['id']}/drives", headers=hr).json()
    assert drives[0]["applicant_count"] == 1
    # 8. Candidate sees the new status in their tracker
    tr = c.get("/candidate/jobs/applications", headers=cand).json()
    assert tr[0]["status"] == "shortlisted" and tr[0]["total_rounds"] == 1 and tr[0]["current_round"] == 1

    # 9. Company closes the job: it disappears from the candidate board but history stays
    c.post(f"/company/jobs/{job['id']}/close", headers=hr)
    assert c.get("/candidate/jobs", headers=cand).json() == []
    assert len(c.get("/candidate/jobs/applications", headers=cand).json()) == 1
    assert c.post(f"/candidate/jobs/{job['id']}/apply", headers=cand).status_code in (404, 409)

    # 10. Another company can see none of it
    hr2, _ = env.company_user("hr-9", "Evil Corp")
    assert c.get(f"/company/jobs/{job['id']}/applicants", headers=hr2).status_code == 404
    assert c.get("/company/jobs", headers=hr2).json() == []
