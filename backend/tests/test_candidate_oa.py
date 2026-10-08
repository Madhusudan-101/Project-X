"""Online Assessment router test — pytest-free, in-memory Supabase fake.

Covers: window gating, lazy provisioning, answer keys never leaked, one-way
sections, server-side expiry (incl. multi-section catch-up), MCQ grading,
ownership checks.

Run with:  python tests/test_candidate_oa.py
"""
from __future__ import annotations

import os, sys, uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "svc-role-test")
os.environ.setdefault("SUPABASE_ANON_KEY", "anon-test")
os.environ["OA_AUTOPROVISION_DEFAULT"] = "1"   # this file exercises the default-template path
os.environ.pop("OA_JUDGE_BACKEND", None)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient  # noqa: E402


from oa_fake_db import FakeDB  # noqa: E402


db = FakeDB()
from app.routers.candidate import assessment as oa  # noqa: E402
from app import main  # noqa: E402
from app.deps import require_candidate_role  # noqa: E402

oa.db_client = db
oa._notify_submitted = lambda attempt: None   # emails are covered in the coding/company test
ME = {"id": "stu-1", "college_id": "col-1", "domain": "tech"}
main.app.dependency_overrides[require_candidate_role] = lambda: ME

NOW = datetime.now(timezone.utc)
state = {"drive": None}
oa.get_application = lambda aid: next((a for a in db.store.get("applications", []) if a["id"] == aid), None)
oa.get_job = lambda jid: {"id": jid, "title": "Backend Engineer", "domain": "tech"}
oa.get_drive_for_job_college = lambda jid, cid: state["drive"]
oa.get_company_names = lambda ids: {i: "Acme" for i in ids}
client = TestClient(main.app)

fails = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if not cond else ""))
    if not cond: fails.append(name)

def setup(start, end, template_domain="tech"):
    db.store.clear()
    db.store["applications"] = [{"id": "app-1", "student_id": "stu-1", "job_id": "job-1",
                                 "company_id": "co-1", "status": "applied"},
                                {"id": "app-2", "student_id": "someone-else", "job_id": "job-1",
                                 "company_id": "co-1", "status": "applied"}]
    state["drive"] = {"id": "drive-1", "status": "live",
                      "oa_window_start": start.isoformat() if start else None,
                      "oa_window_end": end.isoformat() if end else None}

def backdate(minutes):
    a = db.store["oa_attempts"][0]
    a["section_started_at"] = (datetime.fromisoformat(a["section_started_at"]) - timedelta(minutes=minutes)).isoformat()

# 1. window gating
setup(NOW + timedelta(hours=1), NOW + timedelta(hours=3))
r = client.get("/candidate/oa/app-1").json()
check("upcoming state", r["state"] == "upcoming")
check("coding template: 3 sections 15/30/45", [s["duration_minutes"] for s in r["sections"]] == [15, 30, 45], r["sections"])
check("start before window refused", client.post("/candidate/oa/app-1/start").status_code == 409)
setup(None, None)
check("unscheduled", client.get("/candidate/oa/app-1").json()["state"] == "unscheduled")
setup(NOW - timedelta(hours=3), NOW - timedelta(hours=1))
check("closed", client.get("/candidate/oa/app-1").json()["state"] == "closed")
check("start after window refused", client.post("/candidate/oa/app-1/start").status_code == 409)

# 2. ownership
setup(NOW - timedelta(hours=1), NOW + timedelta(hours=1))
check("other student's application is 404", client.get("/candidate/oa/app-2").status_code == 404)

# 3. start + no answer key leak
r = client.post("/candidate/oa/app-1/start")
check("start ok", r.status_code == 200, r.text)
sec = r.json()["section"]
check("section 1 is Coding 1", sec["title"] == "Coding 1" and sec["position"] == 1)
check("no correct_option in payload", "correct_option" not in r.text)
check("double start idempotent", client.post("/candidate/oa/app-1/start").status_code == 200
      and len(db.store["oa_attempts"]) == 1)

# 4. autosave + resume
qid = sec["questions"][0]["id"]
check("save answer", client.put("/candidate/oa/app-1/answers", json={"question_id": qid, "answer": "print(1)", "language": "python"}).status_code == 200)
s = client.get("/candidate/oa/app-1/session").json()["section"]["questions"][0]
check("answer restored on reload", s["answer"] == "print(1)" and s["language"] == "python")
check("foreign question rejected", client.put("/candidate/oa/app-1/answers", json={"question_id": "nope", "answer": "x"}).status_code == 404)

# 5. one-way: submit section 1 -> section 2, can't write section-1 question
r = client.post("/candidate/oa/app-1/sections/submit").json()
check("advanced to section 2", r["section"]["position"] == 2)
check("old question locked", client.put("/candidate/oa/app-1/answers", json={"question_id": qid, "answer": "hack"}).status_code == 404)

# 6. expiry: section 2 is 30 min; away for 31 -> section 3 (45 min) started at the END of section 2
backdate(31)
r = client.get("/candidate/oa/app-1/session").json()
check("expired section skipped", r["section"]["position"] == 3)
started = datetime.fromisoformat(db.store["oa_attempts"][0]["section_started_at"])
check("next clock counts from previous end (1 min already used)", 59 < (datetime.now(timezone.utc) - started).total_seconds() < 120)

# 7. stale submit after expiry must not close the following section
backdate(40)   # section 3 has 45 min; 41 used -> still open
r = client.post("/candidate/oa/app-1/sections/submit").json()
check("submit last section finalises", r["status"] == "submitted")
check("attempt submitted in db", db.store["oa_attempts"][0]["status"] == "submitted")
check("overview shows submitted", client.get("/candidate/oa/app-1").json()["state"] == "submitted")
check("no restart after submit", client.post("/candidate/oa/app-1/start").json()["status"] == "submitted")
check("no answers after submit", client.put("/candidate/oa/app-1/answers", json={"question_id": qid, "answer": "x"}).status_code == 409)

# 8. full timeout of everything finalises, and MCQ grading
setup(NOW - timedelta(hours=1), NOW + timedelta(hours=1))
db.store["jobs"] = []
oa.get_job = lambda jid: {"id": jid, "title": "Marketing Associate", "domain": "non-tech"}
r = client.get("/candidate/oa/app-1").json()
check("aptitude template has 5 sections", len(r["sections"]) == 5, [s["title"] for s in r["sections"]])
client.post("/candidate/oa/app-1/start")
sec = client.get("/candidate/oa/app-1/session").json()["section"]  # Quant
keys = {q["id"]: q for q in db.store["oa_questions"]}
for q in sec["questions"]:
    right = keys[q["id"]]["correct_option"]
    client.put("/candidate/oa/app-1/answers", json={"question_id": q["id"], "answer": str(right)})
check("bad option rejected", client.put("/candidate/oa/app-1/answers", json={"question_id": sec["questions"][0]["id"], "answer": "9"}).status_code == 422)
backdate(10_000)  # everything expired
r = client.get("/candidate/oa/app-1/session").json()
check("all sections timed out -> submitted", r["status"] == "submitted")
a = db.store["oa_attempts"][0]
check("MCQ graded (3 correct × 10)", a["score"] == 30, a)
check("max score = 15 mcq × 10", a["max_score"] == 150, a)
client.post("/candidate/oa/app-1/events", json={"type": "tab_switch"})

print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
