"""Candidate OA — coding Run / Submit — /candidate/oa/{application_id}/questions/{question_id}

  POST .../run     visible examples (+ an optional custom input). Not stored,
                   not scored. Shows the candidate real output.
  POST .../submit  ALL tests (visible + hidden). Stored in oa_submissions and
                   scored; only the best submission per question counts.

Both endpoints are bound to the attempt: the question must belong to the
candidate's CURRENT section and that section must still be open on the server
clock, so a closed section can't be graded after the fact. Hidden test inputs
and expected values are never returned — only pass counts.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...deps import db_client, require_candidate_role
from ...services.candidate import oa_judge
from .assessment import (
    _active_attempt,
    _first,
    _settle,
    allowed_languages,
    format_args,
    load_problems,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/candidate/oa", tags=["candidate-oa"])

MIN_SECONDS_BETWEEN_RUNS = 1.5
_last_run: Dict[str, float] = {}
_last_run_lock = threading.Lock()


def _max_submissions() -> int:
    return int(os.getenv("OA_MAX_SUBMISSIONS_PER_QUESTION") or 20)


# ── Schemas ─────────────────────────────────────────────────────────

class RunIn(BaseModel):
    language: str = Field(max_length=32)
    source: str = Field(max_length=oa_judge.MAX_SOURCE_CHARS)
    custom_args: Optional[List[Any]] = None   # one positional-args list, e.g. [[2,7],9]


class CaseOut(BaseModel):
    label: str
    status: str                    # pass | fail | error | timeout | ran
    input: str
    expected: Optional[str] = None
    actual: Optional[str] = None
    error: Optional[str] = None


class RunOut(BaseModel):
    verdict: str
    compile_error: Optional[str] = None
    crash: Optional[str] = None
    stdout: str = ""
    cases: List[CaseOut] = []


class SubmitOut(RunOut):
    submission_id: Optional[str] = None
    passed: int = 0
    total: int = 0
    hidden_passed: int = 0
    hidden_total: int = 0
    score: float = 0
    points: int = 0
    submissions_left: int = 0


# ── Helpers ─────────────────────────────────────────────────────────

def _throttle(attempt_id: str) -> None:
    now = time.monotonic()
    with _last_run_lock:
        prev = _last_run.get(attempt_id, 0.0)
        if now - prev < MIN_SECONDS_BETWEEN_RUNS:
            raise HTTPException(status_code=429, detail="Slow down — wait a moment before running again.")
        _last_run[attempt_id] = now
        if len(_last_run) > 5000:  # keep the dict bounded
            for k in sorted(_last_run, key=_last_run.get)[:2500]:
                _last_run.pop(k, None)


def _current_question(application_id: str, question_id: str, user: dict) -> tuple[dict, dict, dict]:
    """(attempt, question, problem) — enforces 'current section, still open'."""
    attempt, sections = _active_attempt(application_id, user)
    settled = _settle(attempt, sections)
    if settled["status"] != "in_progress":
        raise HTTPException(status_code=409, detail="The assessment has ended.")
    if int(settled["current_section"]) != int(attempt["current_section"]):
        raise HTTPException(status_code=409, detail="This section's time is up.")
    section = sections[int(settled["current_section"]) - 1]
    question = _first(
        db_client.table("oa_questions").select("id, qtype, points, problem_id, title")
        .eq("id", question_id).eq("section_id", section["id"]).limit(1).execute()
    )
    if not question or question["qtype"] != "coding" or not question.get("problem_id"):
        raise HTTPException(status_code=404, detail="Question isn't a coding question in the current section.")
    problem = load_problems([question["problem_id"]]).get(question["problem_id"])
    if not problem:
        raise HTTPException(status_code=404, detail="Problem not found.")
    return settled, question, problem


def _tests(problem_id: str, *, visible_only: bool) -> List[dict]:
    q = db_client.table("oa_problem_tests").select("position, args, expected, is_visible").eq("problem_id", problem_id)
    if visible_only:
        q = q.eq("is_visible", True)
    return q.order("position", desc=False).execute().data or []


def _run_judge(problem: dict, language: str, source: str, cases: List[dict]) -> oa_judge.JudgeRun:
    if language not in allowed_languages(problem):
        raise HTTPException(status_code=422, detail=f"{language} isn't available for this problem.")
    if not source.strip():
        raise HTTPException(status_code=422, detail="Write some code first.")
    try:
        return oa_judge.judge(language, source, problem["function_name"], cases, problem.get("compare") or "exact")
    except oa_judge.JudgeBusy:
        raise HTTPException(status_code=503, detail="The code runner is busy. Try again in a few seconds.")
    except oa_judge.JudgeUnavailable as e:
        log.warning("OA judge unavailable: %s", e)
        raise HTTPException(
            status_code=503,
            detail="Code execution is unavailable right now. Your code is saved — try again shortly.",
        )


def _show(v: Any) -> str:
    import json
    return json.dumps(v, separators=(",", ":"))


def _case_out(label: str, params: List[str], case: dict, outcome: Optional[oa_judge.CaseOutcome]) -> CaseOut:
    return CaseOut(
        label=label,
        status=outcome.status if outcome else "error",
        input=format_args(params, case["args"]),
        expected=_show(case["expected"]) if "expected" in case else None,
        actual=_show(outcome.actual) if outcome and outcome.status in ("pass", "fail", "ran") else None,
        error=outcome.error if outcome else None,
    )


# ── Run ─────────────────────────────────────────────────────────────

@router.post("/{application_id}/questions/{question_id}/run", response_model=RunOut)
def run_route(
    application_id: str,
    question_id: str,
    body: RunIn,
    current_user: dict = Depends(require_candidate_role),
) -> RunOut:
    attempt, _, problem = _current_question(application_id, question_id, current_user)
    params = problem.get("params") or []
    cases: List[dict] = [{"args": t["args"], "expected": t["expected"], "label": f"Example {i}"}
                         for i, t in enumerate(_tests(problem["id"], visible_only=True), start=1)]
    if body.custom_args is not None:
        if len(body.custom_args) != len(params):
            raise HTTPException(status_code=422, detail=f"Custom input needs {len(params)} value(s): {', '.join(params)}.")
        cases.append({"args": body.custom_args, "label": "Custom"})
    _throttle(attempt["id"])
    run = _run_judge(problem, body.language, body.source, cases)
    return RunOut(
        verdict=oa_judge.overall_verdict(run),
        compile_error=run.compile_error,
        crash=run.crash,
        stdout=run.stdout,
        cases=[_case_out(c["label"], params, c, o) for c, o in zip(cases, run.outcomes)],
    )


# ── Submit ──────────────────────────────────────────────────────────

@router.post("/{application_id}/questions/{question_id}/submit", response_model=SubmitOut)
def submit_route(
    application_id: str,
    question_id: str,
    body: RunIn,
    current_user: dict = Depends(require_candidate_role),
) -> SubmitOut:
    attempt, question, problem = _current_question(application_id, question_id, current_user)
    params = problem.get("params") or []

    used = len(
        db_client.table("oa_submissions").select("id")
        .eq("attempt_id", attempt["id"]).eq("question_id", question_id).execute().data or []
    )
    if used >= _max_submissions():
        raise HTTPException(status_code=429, detail=f"You've used all {_max_submissions()} submissions for this question.")

    tests = _tests(problem["id"], visible_only=False)
    if not tests:
        raise HTTPException(status_code=409, detail="This problem has no tests yet.")
    _throttle(attempt["id"])
    run = _run_judge(problem, body.language, body.source, [{"args": t["args"], "expected": t["expected"]} for t in tests])

    verdict = oa_judge.overall_verdict(run)
    total = len(tests)
    passed = sum(1 for o in run.outcomes if o.status == "pass")
    points = int(question["points"])
    score = round(points * passed / total, 2) if total else 0.0

    visible_idx = [i for i, t in enumerate(tests) if t["is_visible"]]
    visible_cases = [
        _case_out(f"Example {n}", params, tests[i], run.outcomes[i] if i < len(run.outcomes) else None)
        for n, i in enumerate(visible_idx, start=1)
    ]
    hidden_total = total - len(visible_idx)
    hidden_passed = sum(1 for i, o in enumerate(run.outcomes) if o.status == "pass" and not tests[i]["is_visible"])

    saved = _first(
        db_client.table("oa_submissions").insert({
            "attempt_id": attempt["id"],
            "question_id": question_id,
            "language": body.language,
            "source": body.source,
            "verdict": verdict,
            "passed": passed,
            "total": total,
            "score": score,
            "results": [c.model_dump() for c in visible_cases],
        }).execute()
    )
    # Keep the editor draft in step with what was just judged.
    db_client.table("oa_answers").upsert(
        {"attempt_id": attempt["id"], "question_id": question_id, "answer": body.source, "language": body.language},
        on_conflict="attempt_id,question_id",
    ).execute()

    return SubmitOut(
        verdict=verdict,
        compile_error=run.compile_error,
        crash=run.crash,
        stdout=run.stdout,
        cases=visible_cases,
        submission_id=(saved or {}).get("id"),
        passed=passed,
        total=total,
        hidden_passed=hidden_passed,
        hidden_total=hidden_total,
        score=score,
        points=points,
        submissions_left=max(0, _max_submissions() - used - 1),
    )
