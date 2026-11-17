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
from app.services.admin.permissions import ALL_PERMISSIONS, GLOBAL_SCOPE_ID  # noqa: E402

db, auth = FakeDB(), FakeAuth()
deps.db_client.table = db.table
deps.db_client.rpc = db.rpc
for name in ("get_user", "sign_up", "sign_in_with_password", "refresh_session", "verify_otp", "resend", "reset_password_for_email"):
    setattr(deps.auth_client.auth, name, getattr(auth, name))
deps.admin_client.auth.admin.update_user_by_id = auth.update_user_by_id
deps.admin_client.auth.admin.sign_out = auth.sign_out
deps.admin_client.auth.admin.create_user = auth.create_user
deps.create_client = lambda *a, **k: SimpleNamespace(table=db.table, rpc=db.rpc, postgrest=SimpleNamespace(auth=lambda t: None))

# stub the one external AI call in the apply -> score pipeline
import app.services.candidate.application_scoring_service as svc  # noqa: E402
import app.routers.candidate.jobs as cand_jobs  # noqa: E402


class _Dim:
    def __init__(self, s): self.score = s


class _Result:
    dimensions = SimpleNamespace(resume=_Dim(80), github=_Dim(60), leetcode=_Dim(50), interview=_Dim(None), assessment=_Dim(None))
    placement_probability = 72
    # The recruiter panel reads recruiter_verdict.label/.recommendation; a stub without it crashed the page
    # whenever scoring finished before the recruiter opened the job (an intermittent E2E failure).
    def model_dump(self, mode="json"): return {"placement_probability": 72, "summary": "Solid backend profile.",
                                               "recruiter_verdict": {"label": "Strong fit", "recommendation": "advance",
                                                                     "summary": "Solid backend profile."}}


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
    user("u-admin", "admin", "admin@e2e.dev", name="Ada Admin", first_name="Ada", last_name="Admin", is_super_admin=False)
    for permission in ALL_PERMISSIONS:
        db.add("admin_user_permissions", user_id="u-admin", permission=permission, scope_type="global",
               scope_id=GLOBAL_SCOPE_ID, expires_at=None)
    user("u-super", "admin", "super@e2e.dev", name="Sam Super", first_name="Sam", last_name="Super", is_super_admin=True)
    user("u-bare", "admin", "bare@e2e.dev", name="Bo Bare", first_name="Bo", last_name="Bare", is_super_admin=False)
    # /admin/colleges/{id} takes a real uuid, unlike the "col-1" the rest of this world uses.
    db.add("colleges", id="5a5a5a5a-1111-4111-8111-111111111111", name="Delta College")
    user("u-tpo2", "college", "tpo2@e2e.dev", name="Tom TPO", first_name="Tom", last_name="TPO",
         college_id="5a5a5a5a-1111-4111-8111-111111111111")
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
        """Port of public.claim_peer_matchmaking_ticket(): pair with the best other waiting ticket (not blocked, same topic first, oldest first)."""
        me = p["p_student_id"]
        blocks = db.tables.get("peer_blocks", [])
        blocked = lambda o: any((b["blocker_id"], b["blocked_id"]) in ((me, o), (o, me)) for b in blocks)
        topic = p.get("p_topic")
        waiting = sorted([t for t in db.tables.get("peer_matchmaking_tickets", [])
                          if t.get("status") == "waiting" and t["student_id"] != me and not blocked(t["student_id"])],
                         key=lambda t: (0 if (topic is None or t.get("topic") is None or t.get("topic") == topic) else 1, t["created_at"]))
        if not waiting:
            return []
        t = waiting[0]
        t.update(status="matched", room_id=p["p_room_id"], matched_with=me, matched_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat())
        return [{"peer_id": t["student_id"], "ticket_id": t["id"], "peer_private": bool(t.get("keep_private"))}]

    db.rpc_handlers["claim_peer_matchmaking_ticket"] = claim_ticket
    _empty_ctc = lambda: {"roles": 0, "average": None, "highest": None, "lowest": None,
                          "distribution": [{"bucket": b, "count": 0} for b in ("<3 LPA", "3-6 LPA", "6-10 LPA", "10-15 LPA", "15-25 LPA", "25+ LPA")]}
    # same shape public.admin_ctc_stats() always returns (a jsonb object, never an empty set)
    db.rpc_handlers["admin_ctc_stats"] = lambda p: {"currency": "INR", "excluded_other_currency": 0,
                                                    "posted": _empty_ctc(), "filled": _empty_ctc()}
    db.add("students", college_id="col-1", name="Sam Student", email="sam@e2e.dev", branch="CSE", graduation_year=2026,
           employability_score=71, verification_status="verified", placement_status="not_placed")

    # Python ports of the list functions the management pages are built on, so their
    # write flows have real rows to act on. Each reads the live fake tables.
    def paged(rows, p):
        total, start = len(rows), p.get("p_offset") or 0
        return [{**r, "total_count": total} for r in rows[start:start + (p.get("p_limit") or 25)]]

    def matches(p, *values):
        term = (p.get("p_search") or "").lower()
        return not term or any(term in str(v or "").lower() for v in values)

    def list_users(p):
        emails = {r["id"]: r["email"] for r in db.tables["profiles"]}
        rows = []
        for r in db.tables["profiles"]:
            blocked = deps.is_currently_blocked(r)
            if p.get("p_user_id") and r["id"] != p["p_user_id"]: continue
            if p.get("p_role") and r["role"] != p["p_role"]: continue
            if p.get("p_status") and (p["p_status"] == "blocked") != blocked: continue
            if not matches(p, r.get("name"), r["email"]): continue
            rows.append({"user_id": r["id"], "email": r["email"], "name": r.get("name") or r["email"], "role": r["role"],
                         "college_id": r.get("college_id"), "college_name": r.get("college_name"), "company_id": None,
                         "company_name": None, "created_at": iso(-30), "onboarded": bool(r.get("onboarded")), "is_blocked": blocked,
                         "blocked_permanent": bool(r.get("blocked_permanent")), "blocked_until": r.get("blocked_until"),
                         "blocked_at": r.get("blocked_at"), "blocked_reason": r.get("blocked_reason"),
                         "blocked_by_email": emails.get(r.get("blocked_by")), "last_activity": None})
        return paged(rows, p)

    def list_colleges(p):
        rows = []
        for c in db.tables["colleges"]:
            has_account = any(r["role"] == "college" and r.get("college_id") == c["id"] for r in db.tables["profiles"])
            if p.get("p_college_id") and c["id"] != p["p_college_id"]: continue
            if not p.get("p_college_id") and p.get("p_registration", "registered") == "registered" and not has_account: continue
            if not matches(p, c.get("name"), c.get("city")): continue
            rows.append({"college_id": c["id"], "name": c["name"], "city": c.get("city"), "state": c.get("state"),
                         "college_type": c.get("type"), "has_account": has_account, "registered_at": iso(-30), "candidates": 2,
                         "roster_students": 1, "roster_placed": 0, "portal_drives": 0, "companies": 1, "drives": 1,
                         "applications": 0, "applicants": 0, "shortlisted": 0, "selected": 0, "selected_applicants": 0,
                         "last_activity": None, "is_active": has_account})
        return paged(rows, p)

    def list_candidates(p):
        rows = [{"candidate_id": r["id"], "name": r.get("name"), "email": r["email"], "college_id": r.get("college_id"),
                 "college_name": r.get("college_name"), "branch": r.get("branch"), "graduation_year": r.get("graduation_year"),
                 "registered_at": iso(-30), "applications": 0, "shortlisted": 0, "selected": 0, "placement_status": "not_applied"}
                for r in db.tables["profiles"] if r["role"] == "candidate" and matches(p, r.get("name"), r["email"])]
        return paged(rows, p)

    db.rpc_handlers.update(admin_list_users=list_users, admin_list_colleges=list_colleges, admin_list_candidates=list_candidates)

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


# Supabase Storage stand-in for OA webcam snapshots: bytes live in memory, "signed" URLs point back here.
from fastapi import Response  # noqa: E402
from app.services.candidate import oa_snapshots as _snaps  # noqa: E402

_SNAPSHOT_FILES: dict = {}
_snaps.upload = lambda path, data: _SNAPSHOT_FILES.__setitem__(path, data)
_snaps.signed_urls = lambda paths: {p: f"http://127.0.0.1:8000/__e2e/files/{p}" for p in paths if p in _SNAPSHOT_FILES}
_snaps.delete = lambda paths: [_SNAPSHOT_FILES.pop(p, None) for p in paths] and None


@app.get("/__e2e/files/{path:path}")
def _file(path: str):
    if path not in _SNAPSHOT_FILES:
        return Response(status_code=404)
    return Response(_SNAPSHOT_FILES[path], media_type="image/jpeg")


@app.post("/__e2e/reset")
def _reset():
    """Test-only: wipe and re-seed so every test starts from the same world."""
    _SNAPSHOT_FILES.clear()
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
        "applications_rows": db.tables.get("applications", []), "peer_matchmaking_tickets_rows": db.tables.get("peer_matchmaking_tickets", []), "peer_user_reports_rows": db.tables.get("peer_user_reports", []), "peer_blocks_rows": db.tables.get("peer_blocks", []), "peer_consents_rows": db.tables.get("peer_consents", []), "peer_session_consents_rows": db.tables.get("peer_session_consents", []), "peer_user_flags_rows": db.tables.get("peer_user_flags", []), "peer_scheduled_meetings_rows": db.tables.get("peer_scheduled_meetings", []), "peer_interview_reports_rows": db.tables.get("peer_interview_reports", []), "students_rows": db.tables.get("students", [])}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8000, log_level="warning")
