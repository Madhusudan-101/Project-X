"""Candidate Online Assessment router — /candidate/oa

HackerRank-style OA: a drive's assessment is a list of timed, one-way
sections. Timing is server-authoritative — the client only renders a
countdown from `deadline`; every request re-derives the real state from
`section_started_at` so a closed laptop or a tampered clock cannot buy time.

  GET  /candidate/oa                              my OAs (one per application with a drive)
  GET  /candidate/oa/{application_id}             instructions page payload
  POST /candidate/oa/{application_id}/start       begin the attempt (window-gated)
  GET  /candidate/oa/{application_id}/session     current section + questions (no answer keys)
  PUT  /candidate/oa/{application_id}/answers     autosave one answer
  POST /candidate/oa/{application_id}/sections/submit   close current section, move on
  POST /candidate/oa/{application_id}/events      proctoring signal (tab switch)

Semantics (mirrored in the instructions shown to candidates):
  * once a section is submitted or times out it can never be revisited
  * unused time never rolls over
  * time keeps running while the candidate is away — on return, expired
    sections are closed and the next section's clock is counted from the
    moment the previous one ended
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field

from ...crud import get_application, get_company_names, get_drive_for_job_college, get_job
from ...deps import _parse_ts, db_client, require_candidate_role
from ...services.candidate import oa_judge
from ...services.candidate.oa_bank import pick_template, template_sections

log = logging.getLogger(__name__)
router = APIRouter(prefix="/candidate/oa", tags=["candidate-oa"])

_MAX_ANSWER_CHARS = 50_000


# ── Schemas ─────────────────────────────────────────────────────────

class OASectionOut(BaseModel):
    position: int
    title: str
    kind: str
    question_count: int
    duration_minutes: int


class OAAttemptOut(BaseModel):
    status: str
    current_section: int
    started_at: str
    submitted_at: Optional[str] = None


class OAProblemExampleOut(BaseModel):
    input: str
    expected: str


class OAProblemOut(BaseModel):
    id: str
    function_name: str
    languages: List[str]
    constraints_html: str = ""
    examples: List[OAProblemExampleOut] = []


class OAOverviewOut(BaseModel):
    application_id: str
    job_title: str
    company_name: str
    assessment_title: str
    # unscheduled | upcoming | open | closed | in_progress | submitted
    state: str
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    server_time: str
    total_duration_minutes: int
    total_questions: int
    sections: List[OASectionOut]
    coding_enabled: bool = False
    attempt: Optional[OAAttemptOut] = None


class OAListItemOut(BaseModel):
    application_id: str
    job_title: str
    company_name: str
    state: str
    window_start: Optional[str] = None
    window_end: Optional[str] = None


class OAQuestionOut(BaseModel):
    id: str
    position: int
    qtype: str
    title: str
    prompt: str
    options: Optional[List[str]] = None
    starter_code: Optional[Dict[str, str]] = None
    points: int
    prompt_format: str = "markdown"   # markdown | html (library problems)
    problem: Optional[OAProblemOut] = None
    answer: Optional[str] = None
    language: Optional[str] = None


class OACurrentSectionOut(BaseModel):
    position: int
    total_sections: int
    title: str
    kind: str
    duration_minutes: int
    deadline: str
    questions: List[OAQuestionOut]


class OASessionOut(BaseModel):
    status: str  # in_progress | submitted
    server_time: str
    coding_enabled: bool = False
    section: Optional[OACurrentSectionOut] = None


class AnswerIn(BaseModel):
    question_id: str
    answer: Optional[str] = Field(default=None, max_length=_MAX_ANSWER_CHARS)
    language: Optional[str] = Field(default=None, max_length=32)


class OAEventIn(BaseModel):
    type: str = Field(pattern="^(tab_switch|fullscreen_exit|paste)$")


# ── Helpers ─────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _first(res: Any) -> Optional[Dict[str, Any]]:
    return res.data[0] if res.data else None


def _load_context(application_id: str, user: dict) -> tuple[dict, dict, dict]:
    """(application, job, drive) for a student's own application. One 404 for
    every miss so existence never leaks."""
    application = get_application(application_id)
    if not application or application["student_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Assessment not found.")
    if application.get("status") == "rejected":
        raise HTTPException(status_code=403, detail="This application is no longer active.")
    job = get_job(application["job_id"])
    drive = get_drive_for_job_college(application["job_id"], user.get("college_id"))
    if not job or not drive or drive.get("status") != "live":
        raise HTTPException(status_code=404, detail="Assessment not found.")
    return application, job, drive


def provision_template(assessment_id: str, template: str) -> None:
    """Fill an (empty) assessment with one of the built-in templates.

    Coding questions that name a `library_problem` use the real, server-graded problem
    when it is loaded and validated; otherwise the original stored-only question is
    used so a database without the library still works."""
    wanted = [q["library_problem"] for sec in template_sections(template) for q in sec["questions"]
              if q.get("library_problem")]
    library = {}
    if wanted:
        rows = (
            db_client.table("oa_problems").select("id, title, statement_html, active, validated")
            .in_("id", wanted).execute().data or []
        )
        library = {r["id"]: r for r in rows if r.get("active") and r.get("validated")}

    for pos, sec in enumerate(template_sections(template), start=1):
        section = _first(
            db_client.table("oa_sections")
            .insert({
                "assessment_id": assessment_id,
                "position": pos,
                "title": sec["title"],
                "kind": sec["kind"],
                "duration_minutes": sec["duration_minutes"],
            })
            .execute()
        )
        rows = []
        for i, q in enumerate(sec["questions"], start=1):
            q = dict(q)
            ref = library.get(q.pop("library_problem", None))
            if ref:
                q.update({"title": ref["title"], "prompt": ref["statement_html"], "problem_id": ref["id"],
                          "starter_code": None})
            rows.append({"section_id": section["id"], "position": i, **q})
        db_client.table("oa_questions").insert(rows).execute()


def _get_assessment(drive: dict) -> Optional[dict]:
    return _first(
        db_client.table("oa_assessments").select("*").eq("drive_id", drive["id"]).limit(1).execute()
    )


def _ensure_assessment(job: dict, drive: dict) -> dict:
    """The drive's assessment. Companies create these (company router). For
    demos/dev only, `OA_AUTOPROVISION_DEFAULT=1` lets the first candidate open
    provision the default template for the role — off by default so candidates
    never see an assessment the company didn't set up."""
    existing = _get_assessment(drive)
    if existing:
        return existing
    if os.getenv("OA_AUTOPROVISION_DEFAULT") != "1":
        raise HTTPException(status_code=404, detail="Assessment not found.")

    try:
        created = _first(
            db_client.table("oa_assessments")
            .insert({
                "drive_id": drive["id"],
                "title": f"{job['title']} — Online Assessment",
                "invite_mode": "all",
            })
            .execute()
        )
    except APIError:
        # Lost a race with a concurrent first-open; the winner's rows are authoritative.
        winner = _get_assessment(drive)
        if winner:
            return winner
        raise
    if not created:
        raise HTTPException(status_code=500, detail="Could not prepare the assessment.")
    try:
        provision_template(created["id"], pick_template(job))
    except Exception:
        # Never leave a half-built assessment behind — the next open retries cleanly.
        db_client.table("oa_assessments").delete().eq("id", created["id"]).execute()
        raise
    return created


def _is_invited(assessment: dict, application_id: str) -> bool:
    if assessment.get("invite_mode", "invited") == "all":
        return True
    row = _first(
        db_client.table("oa_invites").select("status")
        .eq("application_id", application_id).eq("assessment_id", assessment["id"]).limit(1).execute()
    )
    return bool(row and row.get("status") == "invited")


def _require_access(assessment: dict, application_id: str) -> None:
    """Invited applicants (or anyone who already has an attempt) may open it."""
    if _get_attempt(application_id) or _is_invited(assessment, application_id):
        return
    raise HTTPException(status_code=404, detail="Assessment not found.")


def _sections(assessment_id: str) -> List[dict]:
    res = (
        db_client.table("oa_sections")
        .select("*")
        .eq("assessment_id", assessment_id)
        .order("position", desc=False)
        .execute()
    )
    return res.data or []


_PUBLIC_Q_COLS = "id, section_id, position, qtype, title, prompt, options, starter_code, points, problem_id"


def _questions_for(section_ids: List[str], *, with_key: bool = False) -> Dict[str, List[dict]]:
    if not section_ids:
        return {}
    cols = _PUBLIC_Q_COLS + (", correct_option" if with_key else "")
    res = (
        db_client.table("oa_questions")
        .select(cols)
        .in_("section_id", section_ids)
        .order("position", desc=False)
        .execute()
    )
    out: Dict[str, List[dict]] = {}
    for q in res.data or []:
        out.setdefault(q["section_id"], []).append(q)
    return out


def _get_attempt(application_id: str) -> Optional[dict]:
    return _first(
        db_client.table("oa_attempts").select("*").eq("application_id", application_id).limit(1).execute()
    )


def _section_deadline(attempt: dict, section: dict) -> datetime:
    started = _parse_ts(attempt["section_started_at"]) or _now()
    return started + timedelta(minutes=int(section["duration_minutes"]))


def _best_coding_scores(attempt_id: str) -> Dict[str, float]:
    """Best graded submission per coding question (HackerRank-style: your
    strongest submission counts, so a later worse attempt can't hurt you)."""
    rows = (
        db_client.table("oa_submissions").select("question_id, score").eq("attempt_id", attempt_id).execute().data
        or []
    )
    best: Dict[str, float] = {}
    for r in rows:
        best[r["question_id"]] = max(best.get(r["question_id"], 0.0), float(r["score"] or 0))
    return best


def _finalize(attempt: dict, sections: List[dict]) -> dict:
    """Mark the attempt submitted and total the score: MCQs are auto-graded and
    coding questions count their best judged submission. Unsubmitted code is
    kept for review but earns nothing (candidates are told this up front)."""
    by_section = _questions_for([s["id"] for s in sections], with_key=True)
    questions = [q for s in sections for q in by_section.get(s["id"], [])]
    answers = (
        db_client.table("oa_answers").select("question_id, answer").eq("attempt_id", attempt["id"]).execute().data
        or []
    )
    given = {a["question_id"]: a["answer"] for a in answers}
    coding = _best_coding_scores(attempt["id"])

    score = 0.0
    max_score = 0
    for q in questions:
        max_score += int(q["points"])
        if q["qtype"] == "mcq" and q.get("correct_option") is not None:
            if str(given.get(q["id"])) == str(q["correct_option"]):
                score += int(q["points"])
        elif q["qtype"] == "coding":
            score += min(float(q["points"]), coding.get(q["id"], 0.0))

    updated = _first(
        db_client.table("oa_attempts")
        .update({
            "status": "submitted",
            "submitted_at": _now().isoformat(),
            "score": round(score, 2),
            "max_score": max_score,
        })
        .eq("id", attempt["id"])
        .eq("status", "in_progress")
        .execute()
    )
    final = updated or _get_attempt(attempt["application_id"]) or attempt
    if updated:
        _notify_submitted(attempt)
    return final


def _notify_submitted(attempt: dict) -> None:
    """Fire-and-forget confirmation email: a slow or broken mail provider must
    never delay or fail a submission."""
    def work() -> None:
        try:
            from ...services.notifications import oa_emails
            oa_emails.send_submitted_confirmation(attempt)
        except Exception:  # noqa: BLE001
            log.exception("OA submitted-confirmation email failed")

    threading.Thread(target=work, daemon=True).start()


def _settle(attempt: dict, sections: List[dict]) -> dict:
    """Close every section whose time has run out, in order. The next
    section's clock starts when the previous one ENDED, not when the
    candidate came back."""
    if attempt["status"] != "in_progress":
        return attempt
    now = _now()
    cur = int(attempt["current_section"])
    started = _parse_ts(attempt["section_started_at"]) or now
    changed = False
    while cur <= len(sections):
        end = started + timedelta(minutes=int(sections[cur - 1]["duration_minutes"]))
        if now < end:
            break
        cur += 1
        started = end
        changed = True
    if not changed:
        return attempt
    if cur > len(sections):
        attempt = {**attempt, "current_section": len(sections)}
        return _finalize(attempt, sections)
    updated = _first(
        db_client.table("oa_attempts")
        .update({"current_section": cur, "section_started_at": started.isoformat()})
        .eq("id", attempt["id"])
        .eq("status", "in_progress")
        .execute()
    )
    return updated or {**attempt, "current_section": cur, "section_started_at": started.isoformat()}


def _state(drive: dict, attempt: Optional[dict]) -> str:
    if attempt:
        return "submitted" if attempt["status"] == "submitted" else "in_progress"
    start = _parse_ts(drive.get("oa_window_start"))
    end = _parse_ts(drive.get("oa_window_end"))
    if not start or not end:
        return "unscheduled"
    now = _now()
    if now < start:
        return "upcoming"
    if now > end:
        return "closed"
    return "open"


# ── GET /candidate/oa ───────────────────────────────────────────────

@router.get("", response_model=List[OAListItemOut])
def list_my_assessments(current_user: dict = Depends(require_candidate_role)) -> List[OAListItemOut]:
    apps = (
        db_client.table("applications")
        .select("id, job_id, company_id, status")
        .eq("student_id", current_user["id"])
        .neq("status", "rejected")
        .execute()
        .data
        or []
    )
    if not apps:
        return []
    names = get_company_names(list({a["company_id"] for a in apps}))
    attempts = {
        a["application_id"]: a
        for a in (
            db_client.table("oa_attempts")
            .select("application_id, status")
            .eq("student_id", current_user["id"])
            .execute()
            .data
            or []
        )
    }
    out: List[OAListItemOut] = []
    for a in apps:
        drive = get_drive_for_job_college(a["job_id"], current_user.get("college_id"))
        if not drive or drive.get("status") != "live" or not drive.get("oa_window_start"):
            continue
        job = get_job(a["job_id"])
        assessment = _get_assessment(drive)
        if not job or not assessment:
            continue
        if a["id"] not in attempts and not _is_invited(assessment, a["id"]):
            continue
        out.append(OAListItemOut(
            application_id=a["id"],
            job_title=job["title"],
            company_name=names.get(a["company_id"], "A company"),
            state=_state(drive, attempts.get(a["id"])),
            window_start=str(drive["oa_window_start"]),
            window_end=str(drive["oa_window_end"]) if drive.get("oa_window_end") else None,
        ))
    return out


# ── GET /candidate/oa/{application_id} ──────────────────────────────

@router.get("/{application_id}", response_model=OAOverviewOut)
def overview_route(
    application_id: str, current_user: dict = Depends(require_candidate_role)
) -> OAOverviewOut:
    application, job, drive = _load_context(application_id, current_user)
    assessment = _ensure_assessment(job, drive)
    _require_access(assessment, application_id)
    sections = _sections(assessment["id"])
    questions = _questions_for([s["id"] for s in sections])

    attempt = _get_attempt(application_id)
    if attempt:
        attempt = _settle(attempt, sections)

    company = get_company_names([application["company_id"]]).get(application["company_id"], "A company")
    return OAOverviewOut(
        application_id=application_id,
        job_title=job["title"],
        company_name=company,
        assessment_title=assessment["title"],
        state=_state(drive, attempt),
        window_start=str(drive["oa_window_start"]) if drive.get("oa_window_start") else None,
        window_end=str(drive["oa_window_end"]) if drive.get("oa_window_end") else None,
        server_time=_now().isoformat(),
        total_duration_minutes=sum(int(s["duration_minutes"]) for s in sections),
        total_questions=sum(len(questions.get(s["id"], [])) for s in sections),
        sections=[
            OASectionOut(
                position=s["position"],
                title=s["title"],
                kind=s["kind"],
                question_count=len(questions.get(s["id"], [])),
                duration_minutes=int(s["duration_minutes"]),
            )
            for s in sections
        ],
        coding_enabled=oa_judge.judge_enabled(),
        attempt=OAAttemptOut(
            status=attempt["status"],
            current_section=int(attempt["current_section"]),
            started_at=str(attempt["started_at"]),
            submitted_at=str(attempt["submitted_at"]) if attempt.get("submitted_at") else None,
        ) if attempt else None,
    )


# ── POST /candidate/oa/{application_id}/start ───────────────────────

@router.post("/{application_id}/start", response_model=OASessionOut)
def start_route(
    application_id: str, current_user: dict = Depends(require_candidate_role)
) -> OASessionOut:
    _, job, drive = _load_context(application_id, current_user)
    assessment = _ensure_assessment(job, drive)
    _require_access(assessment, application_id)
    sections = _sections(assessment["id"])
    if not sections:
        raise HTTPException(status_code=409, detail="This assessment has no sections yet.")

    attempt = _get_attempt(application_id)
    if not attempt:
        state = _state(drive, None)
        if state == "unscheduled":
            raise HTTPException(status_code=409, detail="The assessment window hasn't been announced yet.")
        if state == "upcoming":
            raise HTTPException(status_code=409, detail="The assessment window hasn't opened yet.")
        if state == "closed":
            raise HTTPException(status_code=409, detail="The assessment window has closed.")
        now = _now().isoformat()
        try:
            attempt = _first(
                db_client.table("oa_attempts")
                .insert({
                    "application_id": application_id,
                    "student_id": current_user["id"],
                    "assessment_id": assessment["id"],
                    "current_section": 1,
                    "started_at": now,
                    "section_started_at": now,
                })
                .execute()
            )
        except APIError:
            attempt = _get_attempt(application_id)  # double-click / second tab
        if not attempt:
            raise HTTPException(status_code=500, detail="Could not start the assessment.")
    return _session(attempt, sections)


# ── GET /candidate/oa/{application_id}/session ──────────────────────

def format_args(params: List[str], args: List[Any]) -> str:
    return ", ".join(f"{n} = {json.dumps(v, separators=(',', ':'))}" for n, v in zip(params, args))


def load_problems(problem_ids: List[str]) -> Dict[str, dict]:
    """Library problems + their VISIBLE examples. Hidden tests are never read here."""
    ids = list({i for i in problem_ids if i})
    if not ids:
        return {}
    rows = db_client.table("oa_problems").select("*").in_("id", ids).execute().data or []
    visible = (
        db_client.table("oa_problem_tests")
        .select("problem_id, position, args, expected")
        .in_("problem_id", ids)
        .eq("is_visible", True)
        .order("position", desc=False)
        .execute()
        .data
        or []
    )
    out = {r["id"]: {**r, "examples": []} for r in rows}
    for t in visible:
        if t["problem_id"] in out:
            out[t["problem_id"]]["examples"].append(t)
    return out


def allowed_languages(problem: dict) -> List[str]:
    langs = [l for l in (problem.get("languages") or []) if l in oa_judge.SUPPORTED_LANGUAGES]
    return langs or ["javascript"]


def _question_out(q: dict, problem: Optional[dict], saved: dict) -> OAQuestionOut:
    starter = q.get("starter_code")
    problem_out = None
    prompt, fmt = q["prompt"], "markdown"
    if problem:
        langs = allowed_languages(problem)
        stored = problem.get("starter_code") or {}
        starter = {
            l: oa_judge.starter_for(l, problem["function_name"], problem.get("params") or [], stored)
            for l in langs
        }
        problem_out = OAProblemOut(
            id=problem["id"],
            function_name=problem["function_name"],
            languages=langs,
            constraints_html=problem.get("constraints_html") or "",
            examples=[
                OAProblemExampleOut(
                    input=format_args(problem.get("params") or [], t["args"]),
                    expected=json.dumps(t["expected"], separators=(",", ":")),
                )
                for t in problem["examples"]
            ],
        )
        prompt, fmt = problem["statement_html"], "html"
    return OAQuestionOut(
        id=q["id"],
        position=q["position"],
        qtype=q["qtype"],
        title=q["title"],
        prompt=prompt,
        options=q.get("options"),
        starter_code=starter,
        points=int(q["points"]),
        prompt_format=fmt,
        problem=problem_out,
        answer=saved.get("answer"),
        language=saved.get("language"),
    )


def _session(attempt: dict, sections: List[dict]) -> OASessionOut:
    attempt = _settle(attempt, sections)
    now = _now().isoformat()
    if attempt["status"] == "submitted":
        return OASessionOut(status="submitted", server_time=now, coding_enabled=oa_judge.judge_enabled())

    section = sections[int(attempt["current_section"]) - 1]
    questions = _questions_for([section["id"]]).get(section["id"], [])
    problems = load_problems([q["problem_id"] for q in questions if q.get("problem_id")])
    saved = {
        a["question_id"]: a
        for a in (
            db_client.table("oa_answers")
            .select("question_id, answer, language")
            .eq("attempt_id", attempt["id"])
            .in_("question_id", [q["id"] for q in questions] or ["00000000-0000-0000-0000-000000000000"])
            .execute()
            .data
            or []
        )
    }
    return OASessionOut(
        status="in_progress",
        server_time=now,
        coding_enabled=oa_judge.judge_enabled(),
        section=OACurrentSectionOut(
            position=section["position"],
            total_sections=len(sections),
            title=section["title"],
            kind=section["kind"],
            duration_minutes=int(section["duration_minutes"]),
            deadline=_section_deadline(attempt, section).isoformat(),
            questions=[
                _question_out(q, problems.get(q.get("problem_id")), saved.get(q["id"]) or {})
                for q in questions
            ],
        ),
    )


def _active_attempt(application_id: str, current_user: dict) -> tuple[dict, List[dict]]:
    _, job, drive = _load_context(application_id, current_user)
    assessment = _ensure_assessment(job, drive)
    attempt = _get_attempt(application_id)
    if not attempt:
        raise HTTPException(status_code=409, detail="You haven't started this assessment.")
    return attempt, _sections(assessment["id"])


@router.get("/{application_id}/session", response_model=OASessionOut)
def session_route(
    application_id: str, current_user: dict = Depends(require_candidate_role)
) -> OASessionOut:
    attempt, sections = _active_attempt(application_id, current_user)
    return _session(attempt, sections)


# ── PUT /candidate/oa/{application_id}/answers ──────────────────────

@router.put("/{application_id}/answers")
def save_answer_route(
    application_id: str,
    body: AnswerIn,
    current_user: dict = Depends(require_candidate_role),
) -> Dict[str, Any]:
    attempt, sections = _active_attempt(application_id, current_user)
    settled = _settle(attempt, sections)
    if settled["status"] != "in_progress":
        raise HTTPException(status_code=409, detail="The assessment has ended.")
    if int(settled["current_section"]) != int(attempt["current_section"]):
        raise HTTPException(status_code=409, detail="This section's time is up.")

    section = sections[int(settled["current_section"]) - 1]
    question = _first(
        db_client.table("oa_questions")
        .select("id, qtype, options")
        .eq("id", body.question_id)
        .eq("section_id", section["id"])
        .limit(1)
        .execute()
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question isn't part of the current section.")
    if question["qtype"] == "mcq" and body.answer is not None:
        n = len(question.get("options") or [])
        if not (body.answer.isdigit() and int(body.answer) < n):
            raise HTTPException(status_code=422, detail="Invalid option.")

    db_client.table("oa_answers").upsert(
        {
            "attempt_id": attempt["id"],
            "question_id": body.question_id,
            "answer": body.answer,
            "language": body.language,
        },
        on_conflict="attempt_id,question_id",
    ).execute()
    return {"saved": True}


# ── POST /candidate/oa/{application_id}/sections/submit ─────────────

@router.post("/{application_id}/sections/submit", response_model=OASessionOut)
def submit_section_route(
    application_id: str, current_user: dict = Depends(require_candidate_role)
) -> OASessionOut:
    attempt, sections = _active_attempt(application_id, current_user)
    settled = _settle(attempt, sections)
    # If time ran out on the section the client believed it was in, _settle
    # already moved on; submitting again would wrongly close the NEXT section.
    if settled["status"] == "in_progress" and int(settled["current_section"]) == int(attempt["current_section"]):
        nxt = int(settled["current_section"]) + 1
        if nxt > len(sections):
            settled = _finalize(settled, sections)
        else:
            settled = _first(
                db_client.table("oa_attempts")
                .update({"current_section": nxt, "section_started_at": _now().isoformat()})
                .eq("id", settled["id"])
                .eq("status", "in_progress")
                .eq("current_section", settled["current_section"])
                .execute()
            ) or settled
    return _session(settled, sections)


# ── POST /candidate/oa/{application_id}/events ──────────────────────

@router.post("/{application_id}/events")
def event_route(
    application_id: str,
    body: OAEventIn,
    current_user: dict = Depends(require_candidate_role),
) -> Dict[str, Any]:
    attempt, _ = _active_attempt(application_id, current_user)
    column = {"tab_switch": "tab_switches", "fullscreen_exit": "fullscreen_exits", "paste": "paste_events"}[body.type]
    if attempt["status"] == "in_progress":
        db_client.table("oa_attempts").update(
            {column: int(attempt.get(column) or 0) + 1}
        ).eq("id", attempt["id"]).execute()
    return {"ok": True}
