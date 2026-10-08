"""OA coding + company flow — pytest-free, in-memory Supabase fake, REAL local judge.

Covers: problem library, assessment builder + validation, edit locking, invites
(idempotent, college-scoped, emails), invite gating, Run/Submit against the
judge (visible vs hidden, partial credit, caps, throttle, judge-down), section
one-way enforcement, scoring (best coding submission + MCQ), integrity
counters, company results / detail, cross-company isolation.

Run with:  python tests/test_oa_coding_and_company.py
"""
from __future__ import annotations

import os, sys, time
from datetime import datetime, timedelta, timezone

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "svc-role-test")
os.environ.setdefault("SUPABASE_ANON_KEY", "anon-test")
os.environ["OA_JUDGE_BACKEND"] = "local"
os.environ["OA_ALLOW_LOCAL_JUDGE"] = "1"
os.environ.pop("OA_AUTOPROVISION_DEFAULT", None)
os.environ["OA_MAX_SUBMISSIONS_PER_QUESTION"] = "4"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE)); sys.path.insert(0, HERE)

from fastapi.testclient import TestClient  # noqa: E402
from oa_fake_db import FakeDB  # noqa: E402

db = FakeDB()
from app.routers.candidate import assessment as oa, assessment_code as oac  # noqa: E402
from app.routers.company import assessment as co  # noqa: E402
from app.services.notifications import oa_emails  # noqa: E402
from app import main  # noqa: E402
from app.deps import require_candidate_role, require_company_role  # noqa: E402

for m in (oa, oac, co):
    m.db_client = db
oa._notify_submitted = lambda attempt: None
oac.MIN_SECONDS_BETWEEN_RUNS = 0

NOW = datetime.now(timezone.utc)
COLLEGE = "col-1"
STUDENTS = {"stu-1": {"id": "stu-1", "college_id": COLLEGE, "domain": "tech"},
            "stu-2": {"id": "stu-2", "college_id": "col-other", "domain": "tech"}}
COMPANIES = {"co-user-1": {"id": "co-1"}, "co-user-2": {"id": "co-2"}}
who = {"candidate": "stu-1", "company": "co-user-1"}
main.app.dependency_overrides[require_candidate_role] = lambda: STUDENTS[who["candidate"]]
main.app.dependency_overrides[require_company_role] = lambda: {"id": who["company"], "profile_role": "company"}

sent = []
oa_emails.send_invite = lambda app_id, s, e, reminder=False: (sent.append((app_id, reminder)) or "sent")
oa_emails.send_submitted_confirmation = lambda attempt: "sent"

def seed():
    db.store.clear()
    db.store["applications"] = [
        {"id": "app-1", "student_id": "stu-1", "job_id": "job-1", "company_id": "co-1", "status": "applied", "applied_at": "2026-01-01"},
        {"id": "app-2", "student_id": "stu-2", "job_id": "job-1", "company_id": "co-1", "status": "applied", "applied_at": "2026-01-02"},
    ]
    drive = {"id": "drive-1", "job_id": "job-1", "college_id": COLLEGE, "status": "live",
             "oa_window_start": (NOW - timedelta(hours=1)).isoformat(), "oa_window_end": (NOW + timedelta(hours=2)).isoformat()}
    st["drive"] = drive
    base = lambda pos, args, exp, vis: {"id": f"t{pos}", "problem_id": "two-sum", "position": pos, "args": args, "expected": exp, "is_visible": vis}
    db.store["oa_problems"] = [
        {"id": "two-sum", "title": "Two Sum", "difficulty": "Easy", "topics": ["Array & Hashing"], "statement_html": "<p>Find two numbers.</p>",
         "constraints_html": "<li>n >= 2</li>", "function_name": "twoSum", "params": ["nums", "target"],
         "starter_code": {"javascript": "function twoSum(nums, target) {\n}\n"}, "languages": ["javascript", "python"],
         "validated": True, "active": True},
        {"id": "raw-one", "title": "Raw", "difficulty": "Easy", "topics": [], "statement_html": "<p>x</p>", "constraints_html": "",
         "function_name": "rawOne", "params": ["a"], "starter_code": {}, "languages": ["python"], "validated": False, "active": True},
    ]
    db.store["oa_problem_tests"] = [
        base(1, [[2, 7, 11, 15], 9], [0, 1], True), base(2, [[3, 2, 4], 6], [1, 2], True),
        base(3, [[3, 3], 6], [0, 1], False), base(4, [[-1, -2, -3, -4, -5], -8], [2, 4], False), base(5, [[0, 4, 3, 0], 0], [0, 3], False),
    ]

st = {"drive": None}
seed()
for m in (co,):
    m.get_company_by_owner_id = lambda uid: COMPANIES[uid]
    m.get_job = lambda jid: {"id": jid, "company_id": "co-1", "title": "Backend Engineer", "domain": "tech"}
    m.list_drives_for_job = lambda jid: [st["drive"]]
    m.list_applications_for_job = lambda jid: db.store["applications"]
    m.get_profiles_college_map = lambda ids: {i: STUDENTS[i]["college_id"] for i in ids}
    m.get_profiles_basic = lambda ids: {i: {"id": i, "name": f"Student {i}", "email": f"{i}@x.edu"} for i in ids}
oa.get_application = lambda aid: next((a for a in db.store["applications"] if a["id"] == aid), None)
oa.get_job = lambda jid: {"id": jid, "title": "Backend Engineer", "domain": "tech"}
oa.get_drive_for_job_college = lambda jid, cid: st["drive"] if cid == COLLEGE else None
oa.get_company_names = lambda ids: {i: "Acme" for i in ids}
client = TestClient(main.app)

fails = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f" — {str(detail)[:300]}" if not cond else ""))
    if not cond: fails.append(name)

def as_candidate(u="stu-1"): who["candidate"] = u
def as_company(u="co-user-1"): who["company"] = u
URL = "/company/jobs/job-1/drives/drive-1/assessment"
def backdate(minutes):
    a = db.store["oa_attempts"][0]
    a["section_started_at"] = (datetime.fromisoformat(a["section_started_at"]) - timedelta(minutes=minutes)).isoformat()

GOOD_PY = "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n"
GOOD_JS = "function twoSum(nums, target) { const m = new Map(); for (let i = 0; i < nums.length; i++) { if (m.has(target - nums[i])) return [m.get(target - nums[i]), i]; m.set(nums[i], i); } }"
# right on the examples, wrong on hidden cases (only handles positive numbers)
PARTIAL_PY = "def two_sum(nums, target):\n    for i in range(len(nums)):\n        for j in range(i+1, len(nums)):\n            if nums[i] + nums[j] == target and nums[i] > 0 and nums[j] > 0:\n                return [i, j]\n    return []\n"

# ── 1. library ──────────────────────────────────────────────────────
r = client.get("/company/oa/problems").json()
check("library lists validated problems only", [p["id"] for p in r] == ["two-sum"], r)
check("search filter", client.get("/company/oa/problems?q=nothing").json() == [])
pv = client.get("/company/oa/problems/two-sum").json()
check("preview: 2 visible examples, hidden only counted", len(pv["examples"]) == 2 and pv["hidden_test_count"] == 3, pv)
HIDDEN_MARKERS = ["-1, -2, -3", "-1,-2,-3", "0, 4, 3, 0", "0,4,3,0", "[3, 3], 6", "[3,3],6"]
leaks = lambda payload: [m for m in HIDDEN_MARKERS if m in payload]
check("preview leaks no hidden args", not leaks(str(pv)) and not leaks(__import__("json").dumps(pv)), leaks(str(pv)))

# ── 2. builder + validation ─────────────────────────────────────────
MCQ = {"title": "Percent", "prompt": "10% of 200?", "options": ["10", "20", "30"], "correct_option": 1, "points": 10}
GOOD = {"title": "Backend OA", "invite_mode": "invited", "sections": [
    {"title": "Coding 1", "kind": "coding", "duration_minutes": 15, "questions": [{"problem_id": "two-sum", "points": 100}]},
    {"title": "Quant", "kind": "mcq", "duration_minutes": 10, "questions": [{"mcq": MCQ}]}]}
def put(body): return client.put(URL, json=body)
bad = lambda s: put({"title": "t", "sections": s})
check("unvalidated problem rejected", bad([{"title": "c", "kind": "coding", "duration_minutes": 5, "questions": [{"problem_id": "raw-one"}]}]).status_code == 422)
check("unknown problem rejected", bad([{"title": "c", "kind": "coding", "duration_minutes": 5, "questions": [{"problem_id": "nope"}]}]).status_code == 422)
check("mcq in coding section rejected", bad([{"title": "c", "kind": "coding", "duration_minutes": 5, "questions": [{"mcq": MCQ}]}]).status_code == 422)
check("problem in mcq section rejected", bad([{"title": "c", "kind": "mcq", "duration_minutes": 5, "questions": [{"problem_id": "two-sum"}]}]).status_code == 422)
check("mcq correct_option out of range rejected", bad([{"title": "c", "kind": "mcq", "duration_minutes": 5, "questions": [{"mcq": {**MCQ, "correct_option": 9}}]}]).status_code == 422)
check("template and sections together rejected", put({**GOOD, "template": "coding"}).status_code == 422)
check("no assessment yet → null", client.get(URL).json() is None)
r = put(GOOD)
check("create assessment", r.status_code == 200 and len(r.json()["sections"]) == 2 and r.json()["total_duration_minutes"] == 25, r.text)
check("coding enabled flag reflects judge", r.json()["coding_enabled"] is True)
as_company("co-user-2")
check("other company can't read, edit, invite or see results", all(c == 404 for c in [
    client.get(URL).status_code, put(GOOD).status_code, client.post(URL + "/invites", json={"all": True}).status_code,
    client.get(URL + "/results").status_code, client.delete(URL).status_code]))
as_company("co-user-1")
r = put({"title": "From template", "template": "aptitude"})
check("replace with a built-in template", r.status_code == 200 and len(r.json()["sections"]) == 5, r.text)
r = put({"title": "Coding template", "template": "coding"}).json()
qs = [q for s in r["sections"] for q in s["questions"]]
check("coding template uses the library problem where it's loaded, stored question otherwise",
      qs[0]["problem_id"] == "two-sum" and qs[1]["problem_id"] is None and qs[2]["problem_id"] is None, qs)
put(GOOD)

# ── 3. invite gating + invites ──────────────────────────────────────
as_candidate("stu-1")
check("uninvited candidate can't open it", client.get("/candidate/oa/app-1").status_code == 404)
check("uninvited candidate sees nothing listed", client.get("/candidate/oa").json() == [])
as_company()
r = client.post(URL + "/invites", json={"all": True}).json()
check("invite all → only same-college applicants", r["invited"] == 1 and sent == [("app-1", False)], (r, sent))
r = client.post(URL + "/invites", json={"application_ids": ["app-1", "app-2"]}).json()
check("re-invite is idempotent; other-college not eligible", r["invited"] == 0 and r["already_invited"] == 1 and r["not_eligible"] == 1 and len(sent) == 1, r)
check("empty invite request rejected", client.post(URL + "/invites", json={}).status_code == 422)
check("resend uses same link, flagged as reminder", client.post(URL + "/invites/app-1/resend").json() == {"email": "sent"} and sent[-1] == ("app-1", True))
check("remind reaches not-started invitees", client.post(URL + "/remind").json()["sent"] == 1)
check("invite list", [i["application_id"] for i in client.get(URL + "/invites").json() if i["invited"]] == ["app-1"])

as_candidate("stu-1")
r = client.get("/candidate/oa").json()
check("invited candidate sees it on the dashboard list", len(r) == 1 and r[0]["state"] == "open", r)
ov = client.get("/candidate/oa/app-1").json()
check("overview has sections + coding flag", ov["total_questions"] == 2 and ov["coding_enabled"] is True, ov)
as_candidate("stu-2")
check("other student can't open someone else's application", client.get("/candidate/oa/app-1").status_code == 404)
as_candidate("stu-1")

# ── 4. take it ──────────────────────────────────────────────────────
r = client.post("/candidate/oa/app-1/start").json()
q = r["section"]["questions"][0]
check("session carries the problem, html prompt, both languages", q["prompt_format"] == "html" and q["problem"]["languages"] == ["javascript", "python"], q)
check("python starter generated from the signature", "def two_sum(nums, target):" in q["starter_code"]["python"], q["starter_code"])
check("visible examples shown as 'name = value'", q["problem"]["examples"][0] == {"input": "nums = [2,7,11,15], target = 9", "expected": "[0,1]"}, q["problem"]["examples"])
body = str(r)
check("no hidden tests or answer keys in the session payload", not leaks(body) and "correct_option" not in body and "hidden" not in body.lower(), leaks(body))
QID = q["id"]
RUN = f"/candidate/oa/app-1/questions/{QID}/run"
SUB = f"/candidate/oa/app-1/questions/{QID}/submit"

r = client.post(RUN, json={"language": "python", "source": GOOD_PY}).json()
check("run: python passes both examples", r["verdict"] == "accepted" and [c["status"] for c in r["cases"]] == ["pass", "pass"], r)
r = client.post(RUN, json={"language": "javascript", "source": GOOD_JS}).json()
check("run: javascript passes", r["verdict"] == "accepted", r)
r = client.post(RUN, json={"language": "python", "source": GOOD_PY, "custom_args": [[1, 5, 9], 14]}).json()
check("run: custom input returns the real output", r["cases"][-1]["label"] == "Custom" and r["cases"][-1]["actual"] == "[1,2]" and r["cases"][-1]["expected"] is None, r)
check("run: wrong custom arity → 422", client.post(RUN, json={"language": "python", "source": GOOD_PY, "custom_args": [[1]]}).status_code == 422)
r = client.post(RUN, json={"language": "python", "source": "def two_sum(:\n"}).json()
check("run: syntax error reported", r["verdict"] == "compile_error" and "SyntaxError" in r["compile_error"], r)
r = client.post(RUN, json={"language": "python", "source": "def two_sum(n, t):\n    return n[99]\n"}).json()
check("run: runtime error shown with line", r["verdict"] == "runtime_error" and "IndexError" in r["cases"][0]["error"], r)
check("run: language not on the problem → 422", client.post(RUN, json={"language": "java", "source": "x"}).status_code == 422)
check("run: empty source → 422", client.post(RUN, json={"language": "python", "source": "  "}).status_code == 422)
check("run is not stored", "oa_submissions" not in db.store or not db.store["oa_submissions"])

r = client.post(SUB, json={"language": "python", "source": PARTIAL_PY}).json()
check("submit: partial credit, hidden detail withheld", r["verdict"] == "wrong_answer" and r["passed"] == 3 and r["total"] == 5 and r["hidden_passed"] == 1 and r["hidden_total"] == 3 and r["score"] == 60.0, r)
check("submit response exposes visible cases only", len(r["cases"]) == 2 and not leaks(__import__("json").dumps(r)), leaks(str(r)))
r = client.post(SUB, json={"language": "python", "source": GOOD_PY}).json()
check("submit: full marks", r["verdict"] == "accepted" and r["score"] == 100.0 and r["passed"] == 5 and r["submissions_left"] == 2, r)
r = client.post(SUB, json={"language": "python", "source": PARTIAL_PY}).json()
check("a worse resubmission is stored", len(db.store["oa_submissions"]) == 3 and r["score"] == 60.0)
r = client.post(SUB, json={"language": "javascript", "source": GOOD_JS})
check("4th submission allowed, 5th blocked by the cap", r.status_code == 200 and client.post(SUB, json={"language": "python", "source": GOOD_PY}).status_code == 429)

# judge unavailable, throttle
os.environ["OA_JUDGE_BACKEND"] = "off"
r = client.post(RUN, json={"language": "python", "source": GOOD_PY})
check("judge off → clear 503, nothing crashes", r.status_code == 503 and "unavailable" in r.json()["detail"], r.text)
os.environ["OA_JUDGE_BACKEND"] = "local"
oac.MIN_SECONDS_BETWEEN_RUNS = 30
oac._last_run.clear()
client.post(RUN, json={"language": "python", "source": GOOD_PY})
check("rapid-fire runs are throttled", client.post(RUN, json={"language": "python", "source": GOOD_PY}).status_code == 429)
oac.MIN_SECONDS_BETWEEN_RUNS = 0

# integrity counters
for t in ["tab_switch"] * 4 + ["fullscreen_exit", "paste", "paste"]:
    client.post("/candidate/oa/app-1/events", json={"type": t})
a = db.store["oa_attempts"][0]
check("integrity counters", (a["tab_switches"], a["fullscreen_exits"], a["paste_events"]) == (4, 1, 2), a)
check("unknown event type rejected", client.post("/candidate/oa/app-1/events", json={"type": "nope"}).status_code == 422)

# ── 5. locking ──────────────────────────────────────────────────────
as_company()
check("assessment locked once someone started", put(GOOD).status_code == 409 and client.delete(URL).status_code == 409)
check("can't revoke a started candidate", client.delete(URL + "/invites/app-1").status_code == 409)

# ── 6. one-way sections ─────────────────────────────────────────────
as_candidate()
r = client.post("/candidate/oa/app-1/sections/submit").json()
check("moved to section 2", r["section"]["position"] == 2 and r["section"]["questions"][0]["qtype"] == "mcq")
check("old coding question no longer runnable", client.post(RUN, json={"language": "python", "source": GOOD_PY}).status_code == 404)
check("mcq isn't a coding question", client.post(f"/candidate/oa/app-1/questions/{r['section']['questions'][0]['id']}/run", json={"language": "python", "source": "x"}).status_code == 404)
mq = r["section"]["questions"][0]["id"]
client.put("/candidate/oa/app-1/answers", json={"question_id": mq, "answer": "1"})
r = client.post("/candidate/oa/app-1/sections/submit").json()
check("finished", r["status"] == "submitted")
a = db.store["oa_attempts"][0]
check("score = best coding submission (100) + correct MCQ (10)", a["score"] == 110 and a["max_score"] == 110, a)
check("no running code after submission", client.post(RUN, json={"language": "python", "source": GOOD_PY}).status_code in (404, 409))

# ── 7. company results ──────────────────────────────────────────────
as_company()
res = client.get(URL + "/results").json()
row = res["rows"][0]
check("results row", row["state"] == "submitted" and row["percent"] == 100.0 and row["tab_switches"] == 4 and row["flagged"] is True and row["paste_events"] == 2, row)
check("results stats", res["stats"] == {"invited": 1, "started": 1, "submitted": 1, "average_percent": 100.0, "flagged": 1}, res["stats"])
d = client.get(URL + "/results/app-1").json()
cq = next(x for x in d["questions"] if x["qtype"] == "coding")
check("detail: every submission with its code", len(cq["submissions"]) == 4 and "def two_sum" in cq["submissions"][0]["source"] and cq["best_score"] == 100.0, cq["best_score"])
mqd = next(x for x in d["questions"] if x["qtype"] == "mcq")
check("detail: mcq shows chosen vs correct", mqd["chosen_option"] == 1 and mqd["correct_option"] == 1)
check("no attempt → 404 detail", client.get(URL + "/results/app-2").status_code == 404)

# ── 8. expiry enforced on the server for code endpoints ─────────────
seed(); put(GOOD); client.post(URL + "/invites", json={"all": True}); sent.clear()
as_candidate()
q = client.post("/candidate/oa/app-1/start").json()["section"]["questions"][0]
backdate(16)   # coding section is 15 min
r = client.post(f"/candidate/oa/app-1/questions/{q['id']}/submit", json={"language": "python", "source": GOOD_PY})
check("submit after the section expired is refused", r.status_code == 409, r.text)
check("nothing was graded", not db.store.get("oa_submissions"))

print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
