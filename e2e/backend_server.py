"""Backend for browser E2E: the REAL FastAPI app with Supabase replaced by the in-memory fakes
(backend/tests/integration/fakes.py) and the Gemini scoring call stubbed. Seeded with one of each portal user.

    python e2e/backend_server.py [port]
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.update(SUPABASE_URL="https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY="svc", SUPABASE_ANON_KEY="anon",
                  PEERMEET_SHARED_SECRET="e2e-secret", OA_AUTOPROVISION_DEFAULT="1", LIVEKIT_URL="wss://e2e.livekit.invalid", LIVEKIT_API_KEY="devkey", LIVEKIT_API_SECRET="devsecret-devsecret-devsecret-1234", AI_INTERVIEW_SHARED_SECRET="e2e-ai-secret", OA_JUDGE_BACKEND="local", OA_ALLOW_LOCAL_JUDGE="1", FRONTEND_ORIGINS="http://127.0.0.1:8080,http://localhost:8080")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.join(ROOT, "backend", "tests", "integration"))

import uvicorn  # noqa: E402
from fakes import FakeAuth, FakeDB  # noqa: E402

from app import deps  # noqa: E402

db, auth = FakeDB(), FakeAuth()
deps.db_client.table = db.table
deps.db_client.rpc = db.rpc
for name in ("get_user", "sign_up", "sign_in_with_password", "refresh_session", "verify_otp", "resend", "reset_password_for_email"):
    setattr(deps.auth_client.auth, name, getattr(auth, name))
deps.admin_client.auth.admin.update_user_by_id = auth.update_user_by_id
deps.create_client = lambda *a, **k: SimpleNamespace(table=db.table, rpc=db.rpc, postgrest=SimpleNamespace(auth=lambda t: None))

# stub the one external AI call in the apply -> score pipeline
import app.services.candidate.application_scoring_service as svc  # noqa: E402
import app.routers.candidate.jobs as cand_jobs  # noqa: E402


class _Dim:
    def __init__(self, s): self.score = s


class _Result:
    dimensions = SimpleNamespace(resume=_Dim(80), github=_Dim(60), leetcode=_Dim(50), interview=_Dim(None), assessment=_Dim(None))
    placement_probability = 72
    def model_dump(self, mode="json"): return {"placement_probability": 72, "summary": "Solid backend profile."}


async def _score(**kw): return _Result()

_prev = SimpleNamespace(resume_text="Python developer", portfolio={}, result={})
svc.score_application = _score
svc.load_previous_analysis = lambda sid: _prev
cand_jobs.student_has_scoring_inputs = lambda sid: True

# LiveKit: the room/dispatch calls need a real LiveKit server -> stub only that network hop.
from livekit import api as _lk_api  # noqa: E402


class _FakeLK:
    def __init__(self, *a):
        self.room = self
        self.agent_dispatch = self

    async def create_room(self, req): pass
    async def create_dispatch(self, req): pass
    async def aclose(self): pass


_lk_api.LiveKitAPI = _FakeLK

# ── seed ────────────────────────────────────────────────────────────
PW = "Passw0rd!x"
iso = lambda d=0: (datetime.now(timezone.utc) + timedelta(days=d)).isoformat()


def seed():


    def user(uid, role, email, **profile):
        auth.add_user(uid, email, PW, {"role": role})
        db.add("profiles", id=uid, email=email, role=role, onboarded=True, **profile)


    db.add("colleges", id="col-1", name="Alpha College")
    user("u-admin", "admin", "admin@e2e.dev", name="Ada Admin", first_name="Ada", last_name="Admin", is_super_admin=True)
    user("u-tpo", "college", "tpo@e2e.dev", name="Tara TPO", first_name="Tara", last_name="TPO", college_id="col-1")
    user("u-hr", "company", "hr@e2e.dev", name="Hana HR", first_name="Hana", last_name="HR")
    company = db.add("companies", owner_id="u-hr", name="Acme Corp", industry="Software", size="11-50", hiring_domains=["tech"])
    user("u-cand", "candidate", "cand@e2e.dev", name="Cara Candidate", first_name="Cara", last_name="Candidate", college_id="col-1",
         domain="tech", cgpa=8.8, branch="CSE", graduation_year=2026, skills=["Python"], interested_roles=["Backend Engineer"],
         college_name="Alpha College")
    job = db.add("jobs", company_id=company["id"], title="Backend Engineer", description="Build and scale reliable APIs for our platform.",
                 domain="tech", experience_level="fresher", location="Pune", openings_count=2, deadline="2099-01-01",
                 visibility="all", status="live", employment_type="full-time")
    db.add("job_weights", job_id=job["id"], resume_weight=40, github_weight=20, leetcode_weight=20, interview_weight=10, assessment_weight=10)
    drive = db.add("job_drives", job_id=job["id"], college_id="col-1", status="live", is_on_campus=True, apply_deadline=iso(10),
                    oa_window_start=iso(-0.05), oa_window_end=iso(2))
    db.add("job_drive_rounds", drive_id=drive["id"], round_number=1, round_type="tech", mode="ai", window_start=iso(11), window_end=iso(12))
    import json as _json
    for prob in _json.load(open(os.path.join(ROOT, "backend", "db", "seed", "oa_problems.json"))):
        tests = prob.pop("tests", [])
        db.add("oa_problems", **{**{"active": True}, **prob})
        for i, t in enumerate(tests):
            db.add("oa_problem_tests", problem_id=prob["id"], position=i, args=t["args"], expected=t["expected"],
                   is_visible=t.get("is_visible", False))
    user("u-cand2", "candidate", "cand2@e2e.dev", name="Dev Candidate", first_name="Dev", last_name="Candidate", college_id="col-1",
         domain="tech", cgpa=7.9, branch="IT", graduation_year=2026, skills=["Go"], college_name="Alpha College")

    def claim_ticket(p):
        """Port of public.claim_peer_matchmaking_ticket(): atomically pair with the oldest other waiting ticket."""
        waiting = sorted([t for t in db.tables.get("peer_matchmaking_tickets", [])
                          if t.get("status") == "waiting" and t["student_id"] != p["p_student_id"]], key=lambda t: t["created_at"])
        if not waiting:
            return []
        t = waiting[0]
        t.update(status="matched", room_id=p["p_room_id"], matched_with=p["p_student_id"])
        return [{"peer_id": t["student_id"], "ticket_id": t["id"]}]

    db.rpc_handlers["claim_peer_matchmaking_ticket"] = claim_ticket
    _empty_ctc = lambda: {"roles": 0, "average": None, "highest": None, "lowest": None,
                          "distribution": [{"bucket": b, "count": 0} for b in ("<3 LPA", "3-6 LPA", "6-10 LPA", "10-15 LPA", "15-25 LPA", "25+ LPA")]}
    # same shape public.admin_ctc_stats() always returns (a jsonb object, never an empty set)
    db.rpc_handlers["admin_ctc_stats"] = lambda p: {"currency": "INR", "excluded_other_currency": 0,
                                                    "posted": _empty_ctc(), "filled": _empty_ctc()}
    db.add("students", college_id="col-1", name="Sam Student", email="sam@e2e.dev", branch="CSE", graduation_year=2026,
           employability_score=71, verification_status="verified", placement_status="not_placed")

    # a couple of admin RPCs so the admin dashboard has data
    db.rpc_handlers["admin_overview"] = lambda p: {
        "totals": {"users": 4, "candidates": 1, "recruiters": 1, "college_accounts": 1, "admins": 1, "companies": 1, "colleges": 1,
                   "colleges_in_directory": 1, "drives": 1, "drives_live": 1, "drives_draft": 0, "drives_closed": 0,
                   "colleges_with_drives": 1, "companies_with_drives": 1},
        "period": {"new_candidates": 1, "new_companies": 1, "new_colleges": 0, "drives_created": 1, "applications": 0, "applicants": 0,
                   "shortlisted": 0, "selected": 0, "selected_applicants": 0, "drives_with_applications": 0, "active_candidates": 1,
                   "active_companies": 1, "active_colleges": 1}}



seed()

from app.main import app  # noqa: E402


@app.post("/__e2e/reset")
def _reset():
    """Test-only: wipe and re-seed so every test starts from the same world."""
    db.reset()
    auth.reset()
    seed()
    return {"ok": True}


@app.post("/__e2e/block")
def _block(body: dict):
    """Test-only: block a profile (the admin-block RPC path needs Postgres)."""
    db.one("profiles", id=body["id"]).update(blocked_permanent=True, blocked_reason=body.get("reason"))
    return {"ok": True}


@app.post("/__e2e/patch")
def _patch(body: dict):
    """Test-only: set columns on rows of a table (no `where` = every row)."""
    n = 0
    for r in db.tables.get(body["table"], []):
        if all(r.get(k) == v for k, v in (body.get("where") or {}).items()):
            r.update(body["set"]); n += 1
    return {"updated": n}


@app.get("/__e2e/state")
def _state():
    """Test-only: lets specs assert on what the backend actually stored."""
    return {t: len(rows) for t, rows in db.tables.items()} | {
        "applications_rows": db.tables.get("applications", []), "peer_matchmaking_tickets_rows": db.tables.get("peer_matchmaking_tickets", []), "students_rows": db.tables.get("students", [])}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8000, log_level="warning")
