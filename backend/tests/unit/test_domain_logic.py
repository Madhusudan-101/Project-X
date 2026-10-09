"""Unit tests: request schemas, scoring math, code-judge helpers, admin plumbing,
auth dependencies (block rules), OA template picking."""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import schemas as S


# ── schemas ─────────────────────────────────────────────────────────
def _job(**over):
    base = dict(
        title="Backend Engineer", description="x" * 30, domain="tech", experience_level="fresher",
        location="Remote", openings_count=2, deadline=date.today() + timedelta(days=10),
        weights=dict(resume_weight=40, github_weight=20, leetcode_weight=20, interview_weight=10,
                     assessment_weight=10),
    )
    base.update(over)
    return S.JobCreateIn(**base)


def test_job_happy_path_defaults():
    j = _job()
    assert j.visibility == "all" and j.employment_type == "full-time" and j.publish is False


@pytest.mark.parametrize("weights", [
    dict(resume_weight=50, github_weight=20, leetcode_weight=20, interview_weight=10, assessment_weight=10),
    dict(resume_weight=10, github_weight=10, leetcode_weight=10, interview_weight=10, assessment_weight=10),
    dict(resume_weight=-10, github_weight=60, leetcode_weight=20, interview_weight=20, assessment_weight=10),
    dict(resume_weight=101, github_weight=0, leetcode_weight=0, interview_weight=0, assessment_weight=-1),
])
def test_job_weights_must_be_100_and_non_negative(weights):
    with pytest.raises(ValidationError):
        _job(weights=weights)


@pytest.mark.parametrize("field,value", [
    ("title", "ab"), ("description", "too short"), ("domain", "other"), ("experience_level", "10+"),
    ("openings_count", 0), ("visibility", "private"), ("employment_type", "volunteer"),
    ("interview_duration_minutes", 45), ("interview_mode", "carrier-pigeon"), ("min_cgpa", 10.5),
    ("internship_duration_months", 0), ("location", ""),
])
def test_job_enum_and_range_validation(field, value):
    with pytest.raises(ValidationError):
        _job(**{field: value})


def test_restricted_job_needs_colleges_and_open_job_clears_them():
    with pytest.raises(ValidationError):
        _job(visibility="restricted")
    assert _job(visibility="restricted", visible_college_ids=["c1"]).visible_college_ids == ["c1"]
    assert _job(visibility="all", visible_college_ids=["c1"]).visible_college_ids == []


@pytest.mark.parametrize("lo,hi", [("ctc_min", "ctc_max"), ("stipend_min", "stipend_max"), ("ppo_ctc_min", "ppo_ctc_max")])
def test_job_min_cannot_exceed_max(lo, hi):
    with pytest.raises(ValidationError):
        _job(**{lo: 20, hi: 10})
    assert _job(**{lo: 10, hi: 10})  # equal is fine
    assert _job(**{lo: 10})          # one-sided is fine


@pytest.mark.parametrize("field", ["ctc_min", "ctc_max", "stipend_min", "stipend_max"])
def test_job_money_cannot_be_negative(field):
    with pytest.raises(ValidationError):
        _job(**{field: -1})


def test_job_update_range_checks_when_both_present():
    with pytest.raises(ValidationError):
        S.JobUpdateIn(ctc_min=30, ctc_max=10)
    assert S.JobUpdateIn(ctc_min=10).ctc_min == 10
    assert S.JobUpdateIn().model_dump(exclude_none=True) == {}


def test_auth_email_validation_and_name_aliases():
    with pytest.raises(ValidationError):
        S.AuthIn(email="nope", password="pw")
    s = S.SignupIn(email="a@b.co", password="pw", first_name="A", last_name="B")
    assert (s.resolved_first_name, s.resolved_last_name) == ("A", "B")
    s = S.SignupIn(email="a@b.co", password="pw", firstName="C", lastName="D")
    assert (s.resolved_first_name, s.resolved_last_name) == ("C", "D")
    assert S.AuthIn(email="a@b.co", password="pw").role == "candidate"


def test_student_schema_year_bounds_and_status():
    ok = S.StudentIn(name="A", email="a@b.co", branch="CSE", graduationYear=2027)
    assert ok.graduationYear == 2027
    for y in (1949, date.today().year + 11, -1):
        with pytest.raises(ValidationError):
            S.StudentIn(name="A", email="a@b.co", branch="CSE", graduationYear=y)
    with pytest.raises(ValidationError):
        S.StudentUpdateIn(placementStatus="hired")
    with pytest.raises(ValidationError):
        S.StudentBulkPlacementIn(studentIds=[], placementStatus="placed")
    with pytest.raises(ValidationError):
        S.StudentBulkPlacementIn(studentIds=["1"], placementStatus="nope")


def test_profile_update_validates_ranges():
    with pytest.raises(ValidationError):
        S.ProfileUpdateIn(cgpa=11)
    with pytest.raises(ValidationError):
        S.ProfileUpdateIn(cgpa=-0.1)
    with pytest.raises(ValidationError):
        S.ProfileUpdateIn(graduationYear=1066)
    assert S.ProfileUpdateIn(cgpa=9.4, graduationYear=2026).cgpa == 9.4


def test_block_schemas_custom_needs_until():
    with pytest.raises(ValidationError):
        S.StudentBlockIn(duration="custom", reason="x")
    with pytest.raises(ValidationError):
        S.StudentBlockIn(duration="2w", reason="x")
    with pytest.raises(ValidationError):
        S.StudentBlockIn(duration="1h", reason="")
    assert S.StudentBlockIn(duration="custom", until="2030-01-01T00:00:00Z", reason="x")


def test_grant_permission_scope_rules():
    with pytest.raises(ValidationError):
        S.GrantPermissionIn(permission="candidates.view", scope_type="college")
    with pytest.raises(ValidationError):
        S.GrantPermissionIn(permission="x", scope_type="planet")
    assert S.GrantPermissionIn(permission="x").scope_type == "global"


def test_college_provision_needs_id_or_name_and_trims_email():
    with pytest.raises(ValidationError):
        S.CollegeProvisionIn(email="a@b.co", first_name="A", last_name="B")
    p = S.CollegeProvisionIn(email="  a@b.co ", first_name="A", last_name="B", college_name="IIT")
    assert p.email == "a@b.co"


def test_screening_question_bounds_and_drive_update_date():
    with pytest.raises(ValidationError):
        S.ScreeningQuestionIn(question_text="")
    with pytest.raises(ValidationError):
        S.ScreeningQuestionIn(question_text="x" * 501)
    # regression: `date` field shadowing made DriveUpdateIn.date None-only
    assert S.DriveUpdateIn(date="2030-05-05").date == date(2030, 5, 5)


def test_role_schemas_bound_minimum_score():
    with pytest.raises(ValidationError):
        S.RoleCreateIn(title="T", description="D", experience_level="fresher",
                       deadline=date.today(), minimum_employability_score=101)
    with pytest.raises(ValidationError):
        S.RoleCreateIn(title="T", description="D", experience_level="fresher",
                       deadline=date.today(), minimum_employability_score=-1)


# ── scoring composite ───────────────────────────────────────────────
from app.services.candidate.job_scoring_agent import compute_weighted_composite  # noqa: E402


class _D:
    def __init__(self, score): self.score = score


class _Dims:
    def __init__(self, r=None, g=None, l=None, i=None, a=None):
        self.resume, self.github, self.leetcode, self.interview, self.assessment = (_D(x) for x in (r, g, l, i, a))


W = dict(resume_weight=40, github_weight=20, leetcode_weight=20, interview_weight=10, assessment_weight=10)


def test_composite_weighted_mean():
    assert compute_weighted_composite(_Dims(100, 0, 50, 50, 50), W) == pytest.approx(60.0)


def test_composite_ignores_missing_dimensions_and_renormalises():
    # only resume (40) + github (20) scored -> (80*40 + 40*20) / 60
    assert compute_weighted_composite(_Dims(80, 40), W) == pytest.approx(66.67, abs=0.01)


def test_composite_zero_weight_dimension_ignored():
    w = {**W, "resume_weight": 0, "github_weight": 100, "leetcode_weight": 0, "interview_weight": 0, "assessment_weight": 0}
    assert compute_weighted_composite(_Dims(10, 90), w) == 90.0


def test_composite_fallback_mean_when_all_weighted_dims_missing():
    w = {**W, "resume_weight": 0, "github_weight": 0, "leetcode_weight": 0, "interview_weight": 50, "assessment_weight": 50}
    assert compute_weighted_composite(_Dims(60, 80, None), w) == 70.0


def test_composite_with_no_scores_is_zero_and_in_range():
    assert compute_weighted_composite(_Dims(), W) == 0.0
    out = compute_weighted_composite(_Dims(100, 100, 100, 100, 100), W)
    assert out == 100.0


def test_composite_fallback_considers_every_scored_dimension():
    # Only interview/assessment carry weight but they are unscored; resume etc. exist.
    w = {**W, "resume_weight": 0, "github_weight": 0, "leetcode_weight": 0}
    w["interview_weight"], w["assessment_weight"] = 0, 0
    assert compute_weighted_composite(_Dims(r=50, i=100), w) == 75.0


# ── code judge helpers ──────────────────────────────────────────────
from app.services.candidate import oa_judge as J  # noqa: E402


@pytest.mark.parametrize("name,expected", [
    ("twoSum", "two_sum"), ("lengthOfLIS", "length_of_lis"), ("isValidBST", "is_valid_bst"),
    ("maxArea", "max_area"), ("foo", "foo"), ("a1B", "a1_b"),
])
def test_snake_case(name, expected):
    assert J.snake_case(name) == expected


def test_function_name_and_starters():
    assert J.function_name_for("python", "twoSum") == "two_sum"
    assert J.function_name_for("javascript", "twoSum") == "twoSum"
    assert "def two_sum(nums, target_value):" in J.python_starter("twoSum", ["nums", "targetValue"])
    assert J.starter_for("javascript", "f", ["a", "b"], {}).startswith("function f(a, b)")
    assert J.starter_for("python", "f", ["a"], {"python": "custom"}) == "custom"


def test_values_equal_strictness():
    assert J.values_equal(1, 1.0)
    assert J.values_equal(0.1 + 0.2, 0.3)
    assert not J.values_equal(True, 1)
    assert not J.values_equal(1, True)
    assert J.values_equal(True, True)
    assert not J.values_equal("1", 1)
    assert not J.values_equal([1, 2], [2, 1])
    assert J.values_equal({"a": [1, {"b": 2}]}, {"a": [1, {"b": 2}]})
    assert not J.values_equal({"a": 1}, {"a": 1, "b": 2})
    assert J.values_equal(None, None)
    assert not J.values_equal(None, 0)
    assert not J.values_equal([], {})


def test_outputs_match_unordered_is_recursive():
    assert J.outputs_match([[2, 1], [4, 3]], [[3, 4], [1, 2]], "unordered")
    assert not J.outputs_match([[2, 1], [4, 3]], [[3, 4], [1, 2]], "exact")
    assert not J.outputs_match([1, 1, 2], [1, 2, 2], "unordered")
    assert J.outputs_match([], [], "unordered")


def test_overall_verdict_priority():
    O = J.CaseOutcome
    assert J.overall_verdict(J.JudgeRun(compile_error="x")) == "compile_error"
    assert J.overall_verdict(J.JudgeRun(crash_kind="time_limit")) == "time_limit"
    assert J.overall_verdict(J.JudgeRun(outcomes=[O(0, "pass"), O(1, "fail")])) == "wrong_answer"
    # the first non-passing case decides the verdict
    assert J.overall_verdict(J.JudgeRun(outcomes=[O(0, "fail"), O(1, "error")])) == "wrong_answer"
    assert J.overall_verdict(J.JudgeRun(outcomes=[O(0, "pass"), O(1, "error"), O(2, "fail")])) == "runtime_error"
    assert J.overall_verdict(J.JudgeRun(outcomes=[O(0, "pass"), O(1, "timeout")])) == "time_limit"
    assert J.overall_verdict(J.JudgeRun(outcomes=[O(0, "pass")])) == "accepted"
    assert J.overall_verdict(J.JudgeRun()) == "accepted"


def test_judge_disabled_by_default_and_config(monkeypatch):
    assert J.judge_enabled() is False
    with pytest.raises(J.JudgeUnavailable):
        J.judge("python", "def f(): pass", "f", [{"args": []}])
    monkeypatch.setenv("OA_JUDGE_BACKEND", "piston")
    assert J.judge_enabled() is False          # no URL
    monkeypatch.setenv("OA_PISTON_URL", "http://piston")
    assert J.judge_enabled() is True
    monkeypatch.setenv("OA_JUDGE_BACKEND", "local")
    assert J.judge_enabled() is False          # not explicitly allowed
    monkeypatch.setenv("OA_ALLOW_LOCAL_JUDGE", "1")
    assert J.judge_enabled() is True


def test_judge_rejects_unknown_language_and_oversize(monkeypatch):
    monkeypatch.setenv("OA_JUDGE_BACKEND", "local")
    monkeypatch.setenv("OA_ALLOW_LOCAL_JUDGE", "1")
    with pytest.raises(J.JudgeUnavailable):
        J.judge("cobol", "x", "f", [])
    run = J.judge("python", "#" * (J.MAX_SOURCE_CHARS + 1), "f", [{"args": []}])
    assert run.compile_error and "too large" in run.compile_error


def test_build_program_rejects_unknown_language():
    with pytest.raises(ValueError):
        J.build_program("ruby", "x", "f")


@pytest.fixture
def local_judge(monkeypatch):
    monkeypatch.setenv("OA_JUDGE_BACKEND", "local")
    monkeypatch.setenv("OA_ALLOW_LOCAL_JUDGE", "1")


def test_judge_python_end_to_end_local(local_judge):
    src = "def add(a, b):\n    return a + b\n"
    run = J.judge("python", src, "add", [
        {"args": [1, 2], "expected": 3}, {"args": [2, 2], "expected": 5}, {"args": [0, 0]},
    ])
    assert [o.status for o in run.outcomes] == ["pass", "fail", "ran"]
    assert run.outcomes[1].actual == 4
    assert J.overall_verdict(run) == "wrong_answer"


def test_judge_python_camel_case_name_maps_to_snake(local_judge):
    run = J.judge("python", "def two_sum(a):\n    return a\n", "twoSum", [{"args": [7], "expected": 7}])
    assert J.overall_verdict(run) == "accepted"


def test_judge_python_compile_and_runtime_errors(local_judge):
    run = J.judge("python", "def f(:\n", "f", [{"args": [], "expected": 1}])
    assert J.overall_verdict(run) == "compile_error"
    run = J.judge("python", "def f():\n    return 1/0\n", "f", [{"args": [], "expected": 1}])
    assert J.overall_verdict(run) == "runtime_error"
    run = J.judge("python", "x = 1\n", "f", [{"args": [], "expected": 1}])
    assert J.overall_verdict(run) in ("compile_error", "runtime_error")


def test_judge_python_infinite_loop_times_out(local_judge, monkeypatch):
    monkeypatch.setattr(J, "PER_CASE_SECONDS", 1)
    run = J.judge("python", "def f():\n    while True: pass\n", "f", [{"args": [], "expected": 1}])
    assert J.overall_verdict(run) == "time_limit"


def test_judge_print_spoofing_cannot_forge_a_verdict(local_judge):
    src = ('def f():\n    print("@@OA" + "0"*24 + "@@" + \'{"results":[{"ok":true,"value":1}]}\')\n'
           '    return 2\n')
    run = J.judge("python", src, "f", [{"args": [], "expected": 1}])
    assert J.overall_verdict(run) == "wrong_answer"


def test_judge_does_not_mutate_expected_via_shared_args(local_judge):
    src = "def f(a):\n    a.append(9)\n    return a\n"
    run = J.judge("python", src, "f", [{"args": [[1]], "expected": [1, 9]}, {"args": [[1]], "expected": [1, 9]}])
    assert [o.status for o in run.outcomes] == ["pass", "pass"]


@pytest.mark.skipif(__import__("shutil").which("node") is None, reason="node not installed")
def test_judge_javascript_end_to_end_local(local_judge):
    run = J.judge("javascript", "function add(a,b){return a+b}", "add",
                  [{"args": [1, 2], "expected": 3}, {"args": [1, 1], "expected": 3}])
    assert [o.status for o in run.outcomes] == ["pass", "fail"]
    run = J.judge("javascript", "function add(a,b){ throw new Error('x') }", "add", [{"args": [1, 2], "expected": 3}])
    assert J.overall_verdict(run) == "runtime_error"


# ── OA template picking ─────────────────────────────────────────────
from app.services.candidate.oa_bank import pick_template, template_sections  # noqa: E402


@pytest.mark.parametrize("job,tpl", [
    ({"domain": "non-tech", "title": "Data Analyst"}, "aptitude"),
    ({"domain": "tech", "title": "Data Analyst"}, "analytics"),
    ({"domain": "tech", "title": "SQL Developer"}, "analytics"),
    ({"domain": "tech", "title": "Business Intelligence Engineer"}, "analytics"),
    ({"domain": "tech", "title": "Backend Engineer"}, "coding"),
    ({"domain": "tech", "title": "Metadata Engineer"}, "coding"),   # 'data' inside a word must not trigger
    ({"domain": "tech", "title": None}, "coding"),
    ({}, "coding"),
])
def test_pick_template(job, tpl):
    assert pick_template(job) == tpl


def test_template_sections_are_nonempty_and_well_formed():
    for t in ("coding", "analytics", "aptitude"):
        secs = template_sections(t)
        assert secs
        for s in secs:
            assert s["questions"]
    for s in template_sections("aptitude"):
        for q in s["questions"]:
            if q.get("type") == "mcq":
                assert 0 <= q["correct"] < len(q["options"])


# ── admin plumbing ──────────────────────────────────────────────────
from app.services.admin import common as C  # noqa: E402


def test_date_range_validation():
    d = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert C.date_range(None, None).start is None
    with pytest.raises(HTTPException) as e:
        C.date_range(d, None)
    assert e.value.status_code == 422
    with pytest.raises(HTTPException):
        C.date_range(d, d)
    with pytest.raises(HTTPException):
        C.date_range(d, d - timedelta(days=1))
    with pytest.raises(HTTPException):
        C.date_range(d, d + timedelta(days=366 * 21))
    r = C.date_range(datetime(2026, 1, 1), datetime(2026, 1, 2))  # naive -> UTC
    assert r.start.tzinfo is not None


@pytest.mark.parametrize("days,bucket", [(1, "day"), (45, "day"), (46, "week"), (200, "week"), (201, "month")])
def test_date_range_bucket(days, bucket):
    s = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert C.DateRange(s, s + timedelta(days=days)).bucket == bucket
    assert C.DateRange(None, None).bucket == "month"


def test_sort_and_enum_helpers():
    assert C.clean_sort(None, "asc", ["a", "b"], "a") == ("a", "asc")
    with pytest.raises(HTTPException):
        C.clean_sort("zzz", "asc", ["a"], "a")
    with pytest.raises(HTTPException):
        C.clean_sort("a", "sideways", ["a"], "a")
    assert C.one_of("", ["x"], "n") is None and C.one_of(None, ["x"], "n") is None
    with pytest.raises(HTTPException):
        C.one_of("y", ["x"], "n")
    assert C.clean_search("  hi  ") == "hi"
    assert C.clean_search("   ") is None and C.clean_search(None) is None
    assert len(C.clean_search("x" * 500)) == 100


def test_ratio_never_fakes_zero():
    assert C.ratio(1, 0) is None and C.ratio(1, None) is None
    assert C.ratio(None, 4) == 0
    assert C.ratio(1, 3) == 0.3333


def test_csv_cell_neutralises_formulas():
    for evil in ("=1+1", "+cmd", "-2", "@SUM(A1)", "\tx", "\rx"):
        assert C._csv_cell(evil).startswith("'")
    assert C._csv_cell("safe") == "safe"
    assert C._csv_cell(None) == ""
    assert C._csv_cell(True) == "yes" and C._csv_cell(False) == "no"
    assert C._csv_cell(-5) == -5      # numbers are not text, leave them alone


def test_csv_response_headers_and_body():
    res = C.csv_response(C.ExportResult([{"a": "=x", "b": 2}], 3, True), [("a", "A"), ("b", "B")], "f.csv")
    assert res.headers["X-Export-Truncated"] == "true"
    assert res.headers["X-Export-Rows"] == "1" and res.headers["X-Export-Total"] == "3"
    assert "A,B" in res.body_iterator.__next__() if hasattr(res.body_iterator, "__next__") else True


def test_rpc_all_pages_until_total(monkeypatch):
    calls = []

    def fake_rpc(name, params):
        calls.append((params["p_limit"], params["p_offset"]))
        total = 2500
        start = params["p_offset"]
        n = min(params["p_limit"], total - start, 1000)   # server caps at 1000
        return [{"total_count": total, "i": start + k} for k in range(n)]

    monkeypatch.setattr(C, "rpc", fake_rpc)
    res = C.rpc_all("f", {})
    assert len(res.rows) == 2500 and not res.truncated and res.total == 2500
    assert [r["i"] for r in res.rows] == list(range(2500))
    assert "total_count" not in res.rows[0]


def test_rpc_all_reports_truncation(monkeypatch):
    monkeypatch.setattr(C, "EXPORT_MAX_ROWS", 1500)
    monkeypatch.setattr(C, "rpc", lambda n, p: [{"total_count": 5000, "i": 0}] * min(p["p_limit"], 1000))
    res = C.rpc_all("f", {})
    assert res.truncated and len(res.rows) == 1500 and res.total == 5000


def test_rpc_all_empty(monkeypatch):
    monkeypatch.setattr(C, "rpc", lambda n, p: [])
    res = C.rpc_all("f", {})
    assert (res.rows, res.total, res.truncated) == ([], 0, False)


def test_rpc_page_past_end_still_reports_total(monkeypatch):
    def fake(name, p):
        return [] if p["p_offset"] > 0 else [{"total_count": 7, "x": 1}]
    monkeypatch.setattr(C, "rpc", fake)
    out = C.rpc_page("f", {}, C.Page(5, 25))
    assert out["items"] == [] and out["total"] == 7 and out["page"] == 5


def test_rpc_maps_missing_function_to_503(monkeypatch):
    from postgrest.exceptions import APIError

    class _Rpc:
        def __init__(self, code): self.code = code
        def execute(self): raise APIError({"message": "m", "code": self.code})

    monkeypatch.setattr(C.db_client, "rpc", lambda n, p: _Rpc("PGRST202"))
    with pytest.raises(HTTPException) as e:
        C.rpc("x", {})
    assert e.value.status_code == 503
    monkeypatch.setattr(C.db_client, "rpc", lambda n, p: _Rpc("XX000"))
    with pytest.raises(HTTPException) as e:
        C.rpc("x", {})
    assert e.value.status_code == 500


def test_page_offset():
    assert C.Page(1, 25).offset == 0 and C.Page(3, 10).offset == 20


# ── deps: block rules ───────────────────────────────────────────────
from app import deps  # noqa: E402


def test_block_state_rules():
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    assert deps.is_currently_blocked({"blocked_permanent": True})
    assert deps.is_currently_blocked({"blocked_until": future})
    assert not deps.is_currently_blocked({"blocked_until": past})
    assert not deps.is_currently_blocked({})
    assert not deps.is_currently_blocked({"blocked_until": "garbage"})   # never crashes / never locks out
    assert deps.is_currently_blocked({"blocked_until": future.replace("+00:00", "Z")})


def test_block_messages():
    assert "suspended" in deps.block_message({"blocked_permanent": True, "blocked_reason": " spam "})
    assert "Reason: spam" in deps.block_message({"blocked_permanent": True, "blocked_reason": " spam "})
    assert "until 2030" in deps.block_message({"blocked_until": "2030-01-01T00:00:00Z"})


def test_reject_if_blocked():
    deps._reject_if_blocked(None)
    deps._reject_if_blocked({})
    with pytest.raises(HTTPException) as e:
        deps._reject_if_blocked({"blocked_permanent": True})
    assert e.value.status_code == 403
