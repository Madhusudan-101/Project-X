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
         "starter_code": {"javascript": "function twoSum(nums, target) {\n}\n"}, "languages": ["javascript", "python", "java", "cpp"],
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
check("session carries the problem, html prompt, all four languages", q["prompt_format"] == "html" and q["problem"]["languages"] == ["javascript", "python", "java", "cpp"], q)
check("java + c++ starters are typed from the examples", "public int[] twoSum(int[] nums, int target)" in q["starter_code"]["java"]
      and "vector<int> twoSum(vector<int>& nums, int target)" in q["starter_code"]["cpp"], q["starter_code"])
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
GOOD_JAVA = "import java.util.*;\nclass Solution { public int[] twoSum(int[] nums, int target) { Map<Integer,Integer> m = new HashMap<>(); for (int i = 0; i < nums.length; i++) { if (m.containsKey(target - nums[i])) return new int[]{m.get(target - nums[i]), i}; m.put(nums[i], i); } return null; } }"
GOOD_CPP = "class Solution { public: vector<int> twoSum(vector<int>& nums, int target) { unordered_map<int,int> m; for (int i = 0; i < (int)nums.size(); i++) { if (m.count(target - nums[i])) return {m[target - nums[i]], i}; m[nums[i]] = i; } return {}; } };"
r = client.post(RUN, json={"language": "java", "source": GOOD_JAVA}).json()
check("run: java passes both examples", r["verdict"] == "accepted" and [c["status"] for c in r["cases"]] == ["pass", "pass"], r)
r = client.post(RUN, json={"language": "cpp", "source": GOOD_CPP}).json()
check("run: c++ passes both examples", r["verdict"] == "accepted" and [c["status"] for c in r["cases"]] == ["pass", "pass"], r)
r = client.post(RUN, json={"language": "java", "source": GOOD_JAVA.replace("return null;", "return null")}).json()
check("run: java compile error is reported with a line number", r["verdict"] == "compile_error" and "Line 2:" in r["compile_error"], r)
r = client.post(RUN, json={"language": "python", "source": GOOD_PY, "custom_args": [[1, 5, 9], 14]}).json()
check("run: custom input returns the real output", r["cases"][-1]["label"] == "Custom" and r["cases"][-1]["actual"] == "[1,2]" and r["cases"][-1]["expected"] is None, r)
check("run: wrong custom arity → 422", client.post(RUN, json={"language": "python", "source": GOOD_PY, "custom_args": [[1]]}).status_code == 422)
r = client.post(RUN, json={"language": "python", "source": "def two_sum(:\n"}).json()
check("run: syntax error reported", r["verdict"] == "compile_error" and "SyntaxError" in r["compile_error"], r)
r = client.post(RUN, json={"language": "python", "source": "def two_sum(n, t):\n    return n[99]\n"}).json()
check("run: runtime error shown with line", r["verdict"] == "runtime_error" and "IndexError" in r["cases"][0]["error"], r)
check("run: language not on the problem → 422", client.post(RUN, json={"language": "ruby", "source": "x"}).status_code == 422)
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

# ── 4b. timestamped event log ───────────────────────────────────────
n0 = len(db.store["oa_events"])
check("every event above was logged with a server timestamp", n0 == 7 and all(e.get("occurred_at") for e in db.store["oa_events"]), db.store.get("oa_events"))
BIG = "x = 1\n" * 1000
client.post("/candidate/oa/app-1/events", json={"type": "paste", "question_id": QID,
            "detail": {"text": BIG, "length": len(BIG), "target": "editor", "evil": "<script>", "away_ms": "no"}})
client.post("/candidate/oa/app-1/events", json={"type": "tab_return", "question_id": "not-a-question", "detail": {"away_ms": 4200}})
client.post("/candidate/oa/app-1/events", json={"type": "copy", "question_id": QID, "detail": {"text": "Given an array of integers", "target": "other"}})
ev = db.store["oa_events"][n0:]
p_ev, ret_ev, copy_ev = ev
check("paste keeps its question, capped text, full length and target", p_ev["question_id"] == QID and len(p_ev["meta"]["text"]) == 4000
      and p_ev["meta"]["length"] == len(BIG) and p_ev["meta"]["truncated"] is True and p_ev["meta"]["target"] == "editor", p_ev["meta"].keys())
check("unknown detail keys and bad types are dropped", set(p_ev["meta"]) == {"text", "length", "truncated", "target"}, p_ev["meta"].keys())
check("a question outside the current section is not recorded", ret_ev["question_id"] is None and ret_ev["meta"] == {"away_ms": 4200}, ret_ev)
check("copy is logged but is not a counter", copy_ev["meta"]["text"].startswith("Given an array") and db.store["oa_attempts"][0]["paste_events"] == 3
      and db.store["oa_attempts"][0]["tab_switches"] == 4, db.store["oa_attempts"][0])
import app.routers.candidate.assessment as _oa_mod
_oa_mod.MAX_EVENTS_PER_ATTEMPT = len(db.store["oa_events"])
client.post("/candidate/oa/app-1/events", json={"type": "tab_switch"})
check("past the cap: counters still count, the log stops", len(db.store["oa_events"]) == _oa_mod.MAX_EVENTS_PER_ATTEMPT
      and db.store["oa_attempts"][0]["tab_switches"] == 5)
db.store["oa_attempts"][0]["tab_switches"] = 4   # restore for the later assertions
_oa_mod.MAX_EVENTS_PER_ATTEMPT = 2000

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
check("results row", row["state"] == "submitted" and row["percent"] == 100.0 and row["tab_switches"] == 4 and row["flagged"] is True and row["paste_events"] == 3, row)
check("results stats", res["stats"] == {"invited": 1, "started": 1, "submitted": 1, "average_percent": 100.0, "flagged": 1}, res["stats"])
d = client.get(URL + "/results/app-1").json()
cq = next(x for x in d["questions"] if x["qtype"] == "coding")
check("detail: every submission with its code", len(cq["submissions"]) == 4 and "def two_sum" in cq["submissions"][0]["source"] and cq["best_score"] == 100.0, cq["best_score"])
mqd = next(x for x in d["questions"] if x["qtype"] == "mcq")
check("detail: mcq shows chosen vs correct", mqd["chosen_option"] == 1 and mqd["correct_option"] == 1)
tl = d["events"]
check("detail: timeline is ordered, placed on the clock and on a question",
      [e["type"] for e in tl["items"]][:2] == ["tab_switch", "tab_switch"] and all(e["offset_seconds"] is not None for e in tl["items"]), tl["items"][:2])
big = next(e for e in tl["items"] if e["type"] == "paste" and e["detail"].get("length") == len(BIG))
check("detail: paste shows where and what", big["question"]["title"] and big["detail"]["text"].startswith("x = 1"), big)
check("detail: summary counts", tl["counts"]["tab_switch"] == 4 and tl["counts"]["paste"] == 3 and tl["largest_paste"] == len(BIG) and tl["capped"] is False, tl["counts"])
check("no attempt → 404 detail", client.get(URL + "/results/app-2").status_code == 404)

# ── 7b. code similarity ─────────────────────────────────────────────
att1 = db.store["oa_attempts"][0]
db.store["oa_submissions"] = [x for x in db.store["oa_submissions"] if x["language"] == "python"]   # app-1's best is its python solution
db.store["oa_attempts"].append({**att1, "id": "att-2", "application_id": "app-2", "student_id": "stu-2"})
COPY_PY = GOOD_PY.replace("seen", "cache").replace("nums", "arr").replace("target", "goal").replace(" n ", " v ").replace("[n]", "[v]").replace("i, n in", "k, v in").replace(", i]", ", k]")
db.store["oa_submissions"].append({"id": "sub-x", "attempt_id": "att-2", "question_id": QID, "language": "python", "source": COPY_PY,
                                   "verdict": "accepted", "passed": 5, "total": 5, "score": 100, "created_at": "2026-10-16T12:00:00+00:00"})
sim = client.get(URL + "/similarity").json()
sq = next(x for x in sim["questions"] if x["question_id"] == QID)
check("similarity: the renamed copy is flagged high", len(sq["pairs"]) == 1 and sq["pairs"][0]["level"] == "high" and sq["pairs"][0]["similarity"] >= 0.9, sq)
check("similarity: names both candidates, summary + caveat", {sq["pairs"][0]["a"]["name"], sq["pairs"][0]["b"]["name"]} == {"Student stu-1", "Student stu-2"}
      and sim["summary"] == {"flagged_pairs": 1, "candidates_involved": 2} and "not proof" in sim["note"], sim["summary"])
cmp_ = client.get(URL + "/similarity/compare", params={"question_id": QID, "a": "app-1", "b": "app-2"}).json()
check("similarity: side-by-side with the shared lines marked", cmp_["comparable"] and cmp_["a"]["source"] == GOOD_PY and cmp_["b"]["source"] == COPY_PY
      and cmp_["a"]["matched_lines"] and cmp_["b"]["matched_lines"] and cmp_["level"] == "high", cmp_["a"]["matched_lines"])
db.store["oa_submissions"][-1]["source"] = PARTIAL_PY
check("similarity: a different solution is not flagged", client.get(URL + "/similarity").json()["summary"]["flagged_pairs"] == 0)
check("similarity: a candidate without code → 404", client.get(URL + "/similarity/compare", params={"question_id": QID, "a": "app-1", "b": "app-9"}).status_code == 404)
check("similarity: the other company can't see it", (lambda: (as_company("co-user-2"), client.get(URL + "/similarity").status_code)[1])() == 404)
as_company()
db.store["oa_attempts"] = [x for x in db.store["oa_attempts"] if x["id"] != "att-2"]
db.store["oa_submissions"] = [x for x in db.store["oa_submissions"] if x["id"] != "sub-x"]

# ── 8. expiry enforced on the server for code endpoints ─────────────
seed(); put(GOOD); client.post(URL + "/invites", json={"all": True}); sent.clear()
as_candidate()
q = client.post("/candidate/oa/app-1/start").json()["section"]["questions"][0]
backdate(16)   # coding section is 15 min
r = client.post(f"/candidate/oa/app-1/questions/{q['id']}/submit", json={"language": "python", "source": GOOD_PY})
check("submit after the section expired is refused", r.status_code == 409, r.text)
check("nothing was graded", not db.store.get("oa_submissions"))

# ── 9. webcam snapshots ─────────────────────────────────────────────
import base64
from app.services.candidate import oa_snapshots as snaps
stored_objs = {}
snaps.upload = lambda path, data: stored_objs.__setitem__(path, data)
snaps.signed_urls = lambda paths: {p: "https://signed.example/" + p for p in paths}
JPEG = b"\xff\xd8\xff\xe0" + b"j" * 200 + b"\xff\xd9"
IMG = "data:image/jpeg;base64," + base64.b64encode(JPEG).decode()
def snap(**kw): return client.post("/candidate/oa/app-1/snapshots", json={"image": IMG, **kw})

as_company(); seed()
check("webcam_mode must be off|optional|required", put({**GOOD, "webcam_mode": "always"}).status_code == 422)
r = put({**GOOD, "webcam_mode": "required"}).json()
check("company can require the camera", r["webcam_mode"] == "required" and client.get(URL).json()["webcam_mode"] == "required", r)
client.post(URL + "/invites", json={"all": True})
as_candidate()
ov = client.get("/candidate/oa/app-1").json()
check("instructions page learns the camera policy", ov["webcam_mode"] == "required" and ov["snapshot_retention_days"] == 30, ov)
r = client.post("/candidate/oa/app-1/start")
check("required camera: can't start without consenting", r.status_code == 409 and not db.store.get("oa_attempts"), r.text)
r = client.post("/candidate/oa/app-1/start", json={"webcam_consent": False})
check("required camera: explicit 'no' is refused too", r.status_code == 409)
r = client.post("/candidate/oa/app-1/start", json={"webcam_consent": True}).json()
check("consent starts the attempt with the camera active", r["webcam"] == {"mode": "required", "active": True, "interval_seconds": 60}
      and db.store["oa_attempts"][0]["webcam_consent_at"], r.get("webcam"))
q1 = r["section"]["questions"][0]["id"]
check("a snapshot is stored under the attempt and question", snap(question_id=q1, faces=1).json() == {"ok": True, "stored": True}
      and len(stored_objs) == 1 and next(iter(stored_objs.values())) == JPEG and db.store["oa_snapshots"][0]["question_id"] == q1)
check("snapshots closer than the server floor are dropped", snap().json() == {"ok": True, "stored": False, "reason": "too_soon"} and len(stored_objs) == 1)
def age(): db.store["oa_attempts"][0]["last_snapshot_at"] = (NOW - timedelta(minutes=5)).isoformat()
age()
check("not a JPEG → 422", client.post("/candidate/oa/app-1/snapshots", json={"image": "data:image/png;base64," + base64.b64encode(JPEG).decode()}).status_code == 422)
check("JPEG header only → 422", client.post("/candidate/oa/app-1/snapshots", json={"image": base64.b64encode(b"\xff\xd8\xff" + b"x" * 200).decode()}).status_code == 422)
check("oversized → 422", client.post("/candidate/oa/app-1/snapshots", json={"image": base64.b64encode(JPEG + b"x" * 200_000).decode()}).status_code == 422)
check("question outside the current section is not recorded", snap(question_id="nope", faces=0).json()["stored"] and db.store["oa_snapshots"][-1]["question_id"] is None)
age(); snap(faces=3); age(); snap()
a = db.store["oa_attempts"][0]
check("counters: taken / no face / several faces", (a["snapshots_taken"], a["snapshots_no_face"], a["snapshots_multi_face"]) == (4, 1, 1), a)
age(); a["snapshots_taken"] = snaps.MAX_PER_ATTEMPT
check("per-attempt cap", snap().json() == {"ok": True, "stored": False, "reason": "limit"})
a["snapshots_taken"] = 4
client.post("/candidate/oa/app-1/events", json={"type": "camera_lost"})
check("camera_lost lands on the timeline", db.store["oa_events"][-1]["type"] == "camera_lost")

as_company()
g = client.get(URL + "/results/app-1/snapshots").json()
check("gallery: signed urls, time on the clock, question, face counts", g["mode"] == "required" and len(g["items"]) == 4
      and all(i["url"].startswith("https://signed.example/") for i in g["items"]) and g["items"][0]["question"]["position"] == 1
      and [i["faces"] for i in g["items"]] == [1, 0, 3, None] and g["retention_days"] == 30, g)
row = client.get(URL + "/results").json()["rows"][0]
check("results row carries the snapshot counters", (row["snapshots"], row["snapshots_no_face"], row["snapshots_multi_face"], row["webcam_consented"]) == (4, 1, 1, True), row)
check("other company can't open the gallery", (lambda: (as_company("co-user-2"), client.get(URL + "/results/app-1/snapshots").status_code)[1])() == 404)
as_company()
check("no attempt → 404 gallery", client.get(URL + "/results/app-2/snapshots").status_code == 404)

# optional: a candidate who declines is never photographed, even if their browser tries
seed(); put({**GOOD, "webcam_mode": "optional"}); client.post(URL + "/invites", json={"all": True}); as_candidate()
r = client.post("/candidate/oa/app-1/start").json()
check("optional camera: can start without consenting, camera inactive", r["webcam"] == {"mode": "optional", "active": False, "interval_seconds": 60}, r["webcam"])
check("no consent → snapshots refused", snap().status_code == 403 and not db.store.get("oa_snapshots"))
# off: nothing to consent to
seed(); put(GOOD); client.post(URL + "/invites", json={"all": True})
r = client.post("/candidate/oa/app-1/start", json={"webcam_consent": True}).json()
check("camera off: consent is ignored, no snapshots", r["webcam"]["active"] is False and db.store["oa_attempts"][0]["webcam_consent_at"] is None and snap().status_code == 403)

# ── 10. retention purge ─────────────────────────────────────────────
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1] / "scripts"))
import purge_oa_snapshots as purge_mod  # noqa: E402
purge_mod.db_client = db
removed_paths = []
snaps.delete = lambda paths: (removed_paths.extend(paths), None)[1]
db.store["oa_snapshots"] = [
    {"id": "old-1", "attempt_id": "x", "path": "a/b/1.jpg", "taken_at": (NOW - timedelta(days=45)).isoformat()},
    {"id": "old-2", "attempt_id": "x", "path": "a/b/2.jpg", "taken_at": (NOW - timedelta(days=31)).isoformat()},
    {"id": "new-1", "attempt_id": "x", "path": "a/b/3.jpg", "taken_at": (NOW - timedelta(days=2)).isoformat()},
]
check("purge dry run changes nothing", purge_mod.purge(30, dry_run=True) == (0, 0) and len(db.store["oa_snapshots"]) == 3 and not removed_paths)
check("purge removes only snapshots past retention, files then rows", purge_mod.purge(30) == (2, 0)
      and sorted(removed_paths) == ["a/b/1.jpg", "a/b/2.jpg"] and [r["id"] for r in db.store["oa_snapshots"]] == ["new-1"])
snaps.delete = lambda paths: "storage down"
db.store["oa_snapshots"].append({"id": "old-3", "attempt_id": "x", "path": "a/b/4.jpg", "taken_at": (NOW - timedelta(days=99)).isoformat()})
check("a storage failure keeps the rows so the next run retries", purge_mod.purge(30) == (0, 1) and any(r["id"] == "old-3" for r in db.store["oa_snapshots"]))

print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
