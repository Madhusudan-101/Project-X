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

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field

from ...crud import get_application, get_company_names, get_drive_for_job_college, get_job
from ...deps import _parse_ts, db_client, require_candidate_role
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
    section: Optional[OACurrentSectionOut] = None


class AnswerIn(BaseModel):
    question_id: str
    answer: Optional[str] = Field(default=None, max_length=_MAX_ANSWER_CHARS)
    language: Optional[str] = Field(default=None, max_length=32)


class OAEventIn(BaseModel):
    type: str = Field(pattern="^tab_switch$")


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


def _ensure_assessment(job: dict, drive: dict) -> dict:
    """Return the drive's assessment, provisioning the default template for
    its role on first access."""
    existing = _first(
        db_client.table("oa_assessments").select("*").eq("drive_id", drive["id"]).limit(1).execute()
    )
    if existing:
        return existing

    try:
        created = _first(
            db_client.table("oa_assessments")
            .insert({"drive_id": drive["id"], "title": f"{job['title']} — Online Assessment"})
            .execute()
        )
    except APIError:
        # Lost a race with a concurrent first-open; the winner's rows are authoritative.
        winner = _first(
            db_client.table("oa_assessments").select("*").eq("drive_id", drive["id"]).limit(1).execute()
        )
        if winner:
            return winner
        raise
    if not created:
        raise HTTPException(status_code=500, detail="Could not prepare the assessment.")

    try:
        for pos, sec in enumerate(template_sections(pick_template(job)), start=1):
            section = _first(
                db_client.table("oa_sections")
                .insert({
                    "assessment_id": created["id"],
                    "position": pos,
                    "title": sec["title"],
                    "kind": sec["kind"],
                    "duration_minutes": sec["duration_minutes"],
                })
                .execute()
            )
            rows = [
                {"section_id": section["id"], "position": i, **q}
                for i, q in enumerate(sec["questions"], start=1)
            ]
            db_client.table("oa_questions").insert(rows).execute()
    except Exception:
        # Never leave a half-built assessment behind — the next open retries cleanly.
        db_client.table("oa_assessments").delete().eq("id", created["id"]).execute()
        raise
    return created


def _sections(assessment_id: str) -> List[dict]:
    res = (
        db_client.table("oa_sections")
        .select("*")
        .eq("assessment_id", assessment_id)
        .order("position", desc=False)
        .execute()
    )
    return res.data or []


_PUBLIC_Q_COLS = "id, section_id, position, qtype, title, prompt, options, starter_code, points"


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


def _finalize(attempt: dict, sections: List[dict]) -> dict:
    """Auto-grade MCQs, mark the attempt submitted. Coding answers are kept
    for the company to review — there is no code runner here, so they add to
    `max_score` but not to `score`."""
    by_section = _questions_for([s["id"] for s in sections], with_key=True)
    questions = [q for s in sections for q in by_section.get(s["id"], [])]
    answers = (
        db_client.table("oa_answers").select("question_id, answer").eq("attempt_id", attempt["id"]).execute().data
        or []
    )
    given = {a["question_id"]: a["answer"] for a in answers}

    score = 0
    max_score = 0
    for q in questions:
        max_score += int(q["points"])
        if q["qtype"] == "mcq" and q.get("correct_option") is not None:
            if str(given.get(q["id"])) == str(q["correct_option"]):
                score += int(q["points"])

    updated = _first(
        db_client.table("oa_attempts")
        .update({
            "status": "submitted",
            "submitted_at": _now().isoformat(),
            "score": score,
            "max_score": max_score,
        })
        .eq("id", attempt["id"])
        .eq("status", "in_progress")
        .execute()
    )
    return updated or _get_attempt(attempt["application_id"]) or attempt


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
        if not job:
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

def _session(attempt: dict, sections: List[dict]) -> OASessionOut:
    attempt = _settle(attempt, sections)
    now = _now().isoformat()
    if attempt["status"] == "submitted":
        return OASessionOut(status="submitted", server_time=now)

    section = sections[int(attempt["current_section"]) - 1]
    questions = _questions_for([section["id"]]).get(section["id"], [])
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
        section=OACurrentSectionOut(
            position=section["position"],
            total_sections=len(sections),
            title=section["title"],
            kind=section["kind"],
            duration_minutes=int(section["duration_minutes"]),
            deadline=_section_deadline(attempt, section).isoformat(),
            questions=[
                OAQuestionOut(
                    id=q["id"],
                    position=q["position"],
                    qtype=q["qtype"],
                    title=q["title"],
                    prompt=q["prompt"],
                    options=q.get("options"),
                    starter_code=q.get("starter_code"),
                    points=int(q["points"]),
                    answer=(saved.get(q["id"]) or {}).get("answer"),
                    language=(saved.get(q["id"]) or {}).get("language"),
                )
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
    if attempt["status"] == "in_progress":
        db_client.table("oa_attempts").update(
            {"tab_switches": int(attempt.get("tab_switches") or 0) + 1}
        ).eq("id", attempt["id"]).execute()
    return {"ok": True}
