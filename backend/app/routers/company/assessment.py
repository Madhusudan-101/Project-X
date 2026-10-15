"""Company Online Assessment router.

  GET    /company/oa/problems                                   problem library (validated problems only)
  GET    /company/oa/problems/{problem_id}                      preview one problem
  GET    /company/jobs/{job}/drives/{drive}/assessment          current definition (null if none)
  PUT    /company/jobs/{job}/drives/{drive}/assessment          create / replace (locked once anyone started)
  DELETE /company/jobs/{job}/drives/{drive}/assessment          remove (locked once anyone started)
  POST   /company/jobs/{job}/drives/{drive}/assessment/invites  invite applicants (idempotent)
  GET    /company/jobs/{job}/drives/{drive}/assessment/invites
  POST   /company/jobs/{job}/drives/{drive}/assessment/invites/{application_id}/resend
  DELETE /company/jobs/{job}/drives/{drive}/assessment/invites/{application_id}   revoke
  POST   /company/jobs/{job}/drives/{drive}/assessment/remind   remind invited, not-started
  GET    /company/jobs/{job}/drives/{drive}/assessment/results  scoreboard
  GET    /company/jobs/{job}/drives/{drive}/assessment/results/{application_id}  one candidate in full

Everything is scoped to the caller's own company through the job. The OA window
itself stays on the drive (existing drive update endpoint) — only the test
content, invites and results live here. Shortlisting remains a manual action.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ...crud import (
    get_company_by_owner_id,
    get_job,
    get_profiles_basic,
    get_profiles_college_map,
    list_applications_for_job,
    list_drives_for_job,
)
from ...deps import db_client, require_company_role
from ...services.candidate import oa_judge
from ...services.candidate.oa_bank import template_sections
from ...services.notifications import oa_emails
from ..candidate.assessment import _first, _parse_ts, format_args, provision_template

log = logging.getLogger(__name__)
router = APIRouter(prefix="/company", tags=["company-oa"])

MAX_SECTIONS = 12
MAX_QUESTIONS_PER_SECTION = 10
FLAG_TAB_SWITCHES = 3
TEMPLATES = ("coding", "analytics", "aptitude")


# ── Schemas ─────────────────────────────────────────────────────────

class McqIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=5000)
    options: List[str] = Field(min_length=2, max_length=8)
    correct_option: int = Field(ge=0)
    points: int = Field(default=10, ge=0, le=1000)


class QuestionIn(BaseModel):
    problem_id: Optional[str] = None
    points: Optional[int] = Field(default=None, ge=0, le=1000)
    mcq: Optional[McqIn] = None


class SectionIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    kind: str = Field(pattern="^(coding|sql|mcq)$")
    duration_minutes: int = Field(ge=1, le=240)
    questions: List[QuestionIn] = Field(min_length=1, max_length=MAX_QUESTIONS_PER_SECTION)


class AssessmentIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    invite_mode: str = Field(default="invited", pattern="^(all|invited)$")
    template: Optional[str] = Field(default=None, pattern="^(coding|analytics|aptitude)$")
    sections: Optional[List[SectionIn]] = Field(default=None, max_length=MAX_SECTIONS)


class InviteIn(BaseModel):
    application_ids: Optional[List[str]] = None
    all: bool = False


# ── Helpers ─────────────────────────────────────────────────────────

def _company(user: dict) -> dict:
    c = get_company_by_owner_id(user["id"])
    if not c:
        raise HTTPException(status_code=404, detail="Company profile not found. Please complete onboarding.")
    return c


def _owned_drive(job_id: str, drive_id: str, user: dict) -> tuple[dict, dict]:
    company = _company(user)
    job = get_job(job_id)
    if not job or job["company_id"] != company["id"]:
        raise HTTPException(status_code=404, detail="Job not found.")
    drive = next((d for d in list_drives_for_job(job_id) if d["id"] == drive_id), None)
    if not drive:
        raise HTTPException(status_code=404, detail="Drive not found.")
    return job, drive


def _assessment(drive: dict) -> Optional[dict]:
    return _first(db_client.table("oa_assessments").select("*").eq("drive_id", drive["id"]).limit(1).execute())


def _need_assessment(drive: dict) -> dict:
    a = _assessment(drive)
    if not a:
        raise HTTPException(status_code=404, detail="Create the assessment first.")
    return a


def _attempts(assessment_id: str) -> List[dict]:
    return db_client.table("oa_attempts").select("*").eq("assessment_id", assessment_id).execute().data or []


def _locked(assessment_id: str) -> bool:
    return bool(_attempts(assessment_id))


def _definition(assessment: dict) -> Dict[str, Any]:
    sections = (
        db_client.table("oa_sections").select("*").eq("assessment_id", assessment["id"])
        .order("position", desc=False).execute().data or []
    )
    questions = (
        db_client.table("oa_questions").select("*").in_("section_id", [s["id"] for s in sections]).order(
            "position", desc=False).execute().data
        if sections else []
    )
    by_sec: Dict[str, List[dict]] = {}
    for q in questions:
        by_sec.setdefault(q["section_id"], []).append(q)
    invites = db_client.table("oa_invites").select("status").eq("assessment_id", assessment["id"]).execute().data or []
    attempts = _attempts(assessment["id"])
    return {
        "id": assessment["id"],
        "title": assessment["title"],
        "invite_mode": assessment.get("invite_mode", "invited"),
        "locked": bool(attempts),
        "coding_enabled": oa_judge.judge_enabled(),
        "stats": {
            "invited": sum(1 for i in invites if i["status"] == "invited"),
            "started": len(attempts),
            "submitted": sum(1 for a in attempts if a["status"] == "submitted"),
        },
        "total_duration_minutes": sum(int(s["duration_minutes"]) for s in sections),
        "sections": [
            {
                "position": s["position"], "title": s["title"], "kind": s["kind"],
                "duration_minutes": int(s["duration_minutes"]),
                "questions": [
                    {"position": q["position"], "qtype": q["qtype"], "title": q["title"],
                     "points": int(q["points"]), "problem_id": q.get("problem_id")}
                    for q in by_sec.get(s["id"], [])
                ],
            }
            for s in sections
        ],
    }


def _validate_and_build(sections: List[SectionIn]) -> List[dict]:
    """Turn the request into insertable rows, checking every library problem."""
    wanted = {q.problem_id for s in sections for q in s.questions if q.problem_id}
    problems = {}
    if wanted:
        rows = db_client.table("oa_problems").select("id, title, statement_html, active, validated") \
            .in_("id", list(wanted)).execute().data or []
        problems = {r["id"]: r for r in rows}
    out = []
    for s in sections:
        qs = []
        for i, q in enumerate(s.questions, start=1):
            if bool(q.problem_id) == bool(q.mcq):
                raise HTTPException(status_code=422, detail=f"Question {i} in '{s.title}' needs exactly one of problem_id or mcq.")
            if q.problem_id:
                if s.kind == "mcq":
                    raise HTTPException(status_code=422, detail=f"'{s.title}' is a multiple-choice section; coding problems go in a coding/SQL section.")
                p = problems.get(q.problem_id)
                if not p or not p["active"]:
                    raise HTTPException(status_code=422, detail=f"Unknown problem '{q.problem_id}'.")
                if not p["validated"]:
                    raise HTTPException(status_code=422, detail=f"Problem '{q.problem_id}' hasn't been validated yet.")
                qs.append({"position": i, "qtype": "coding", "title": p["title"], "prompt": p["statement_html"],
                           "problem_id": p["id"], "points": q.points if q.points is not None else 100})
            else:
                if s.kind != "mcq":
                    raise HTTPException(status_code=422, detail=f"'{s.title}' is a coding section; multiple-choice questions go in an MCQ section.")
                m = q.mcq
                if m.correct_option >= len(m.options):
                    raise HTTPException(status_code=422, detail=f"Question {i} in '{s.title}': correct_option is out of range.")
                qs.append({"position": i, "qtype": "mcq", "title": m.title, "prompt": m.prompt, "options": m.options,
                           "correct_option": m.correct_option, "points": q.points if q.points is not None else m.points})
        out.append({"title": s.title, "kind": s.kind, "duration_minutes": s.duration_minutes, "questions": qs})
    return out


# ── Problem library ─────────────────────────────────────────────────

@router.get("/oa/problems")
def list_problems(
    q: Optional[str] = Query(default=None, max_length=100),
    difficulty: Optional[str] = Query(default=None, pattern="^(Easy|Medium|Hard)$"),
    topic: Optional[str] = Query(default=None, max_length=80),
    limit: int = Query(default=100, ge=1, le=300),
    current_user: dict = Depends(require_company_role),
) -> List[Dict[str, Any]]:
    _company(current_user)
    rows = db_client.table("oa_problems").select("id, title, difficulty, topics, languages") \
        .eq("active", True).eq("validated", True).order("title", desc=False).execute().data or []
    needle = (q or "").strip().lower()
    out = [
        r for r in rows
        if (not needle or needle in r["title"].lower() or needle in r["id"])
        and (not difficulty or r.get("difficulty") == difficulty)
        and (not topic or topic in (r.get("topics") or []))
    ]
    return out[:limit]


@router.get("/oa/problems/{problem_id}")
def problem_preview(problem_id: str, current_user: dict = Depends(require_company_role)) -> Dict[str, Any]:
    _company(current_user)
    p = _first(db_client.table("oa_problems").select("*").eq("id", problem_id).eq("active", True).limit(1).execute())
    if not p:
        raise HTTPException(status_code=404, detail="Problem not found.")
    tests = db_client.table("oa_problem_tests").select("position, args, expected, is_visible") \
        .eq("problem_id", problem_id).order("position", desc=False).execute().data or []
    return {
        "id": p["id"], "title": p["title"], "difficulty": p.get("difficulty"), "topics": p.get("topics") or [],
        "statement_html": p["statement_html"], "constraints_html": p.get("constraints_html") or "",
        "languages": p.get("languages") or [],
        "examples": [{"input": format_args(p.get("params") or [], t["args"]), "expected": t["expected"]}
                     for t in tests if t["is_visible"]],
        "hidden_test_count": sum(1 for t in tests if not t["is_visible"]),
    }


# ── Assessment definition ───────────────────────────────────────────

_BASE = "/jobs/{job_id}/drives/{drive_id}/assessment"


@router.get(_BASE)
def get_assessment(job_id: str, drive_id: str, current_user: dict = Depends(require_company_role)) -> Optional[Dict[str, Any]]:
    _, drive = _owned_drive(job_id, drive_id, current_user)
    a = _assessment(drive)
    return _definition(a) if a else None


@router.put(_BASE)
def put_assessment(
    job_id: str, drive_id: str, body: AssessmentIn,
    current_user: dict = Depends(require_company_role),
) -> Dict[str, Any]:
    _, drive = _owned_drive(job_id, drive_id, current_user)
    if bool(body.template) == bool(body.sections):
        raise HTTPException(status_code=422, detail="Provide either a template or a list of sections.")
    built = _validate_and_build(body.sections) if body.sections else None

    existing = _assessment(drive)
    if existing and _locked(existing["id"]):
        raise HTTPException(
            status_code=409,
            detail="Candidates have already started this assessment, so it can no longer be changed.",
        )

    if existing:
        db_client.table("oa_sections").delete().eq("assessment_id", existing["id"]).execute()
        db_client.table("oa_assessments").update(
            {"title": body.title, "invite_mode": body.invite_mode}
        ).eq("id", existing["id"]).execute()
        assessment = {**existing, "title": body.title, "invite_mode": body.invite_mode}
    else:
        assessment = _first(
            db_client.table("oa_assessments").insert({
                "drive_id": drive["id"], "title": body.title, "invite_mode": body.invite_mode,
                "created_by": current_user["id"],
            }).execute()
        )
    try:
        if body.template:
            provision_template(assessment["id"], body.template)
        else:
            for pos, sec in enumerate(built, start=1):
                row = _first(db_client.table("oa_sections").insert({
                    "assessment_id": assessment["id"], "position": pos, "title": sec["title"],
                    "kind": sec["kind"], "duration_minutes": sec["duration_minutes"],
                }).execute())
                db_client.table("oa_questions").insert(
                    [{"section_id": row["id"], **q} for q in sec["questions"]]
                ).execute()
    except Exception:
        # Don't leave a half-written definition behind.
        db_client.table("oa_sections").delete().eq("assessment_id", assessment["id"]).execute()
        raise
    return _definition(assessment)


@router.delete(_BASE, status_code=204)
def delete_assessment(job_id: str, drive_id: str, current_user: dict = Depends(require_company_role)) -> None:
    _, drive = _owned_drive(job_id, drive_id, current_user)
    a = _need_assessment(drive)
    if _locked(a["id"]):
        raise HTTPException(status_code=409, detail="Candidates have already started this assessment.")
    db_client.table("oa_assessments").delete().eq("id", a["id"]).execute()


# ── Invites ─────────────────────────────────────────────────────────

def _drive_applications(job: dict, drive: dict) -> List[dict]:
    """Non-rejected applications from students at the drive's college."""
    apps = [a for a in list_applications_for_job(job["id"]) if a["status"] != "rejected"]
    colleges = get_profiles_college_map([a["student_id"] for a in apps])
    return [a for a in apps if colleges.get(a["student_id"]) == drive["college_id"]]


def _window(drive: dict) -> tuple[Optional[str], Optional[str]]:
    return (
        str(drive["oa_window_start"]) if drive.get("oa_window_start") else None,
        str(drive["oa_window_end"]) if drive.get("oa_window_end") else None,
    )


@router.post(_BASE + "/invites")
def invite(
    job_id: str, drive_id: str, body: InviteIn,
    current_user: dict = Depends(require_company_role),
) -> Dict[str, Any]:
    job, drive = _owned_drive(job_id, drive_id, current_user)
    assessment = _need_assessment(drive)
    if not (body.all or body.application_ids):
        raise HTTPException(status_code=422, detail="Choose applicants to invite.")
    pool = {a["id"]: a for a in _drive_applications(job, drive)}
    targets = list(pool) if body.all else list(dict.fromkeys(body.application_ids or []))
    not_eligible = [t for t in targets if t not in pool]
    targets = [t for t in targets if t in pool]

    current = {
        r["application_id"]: r
        for r in db_client.table("oa_invites").select("*").eq("assessment_id", assessment["id"]).execute().data or []
    }
    start, end = _window(drive)
    result = {"invited": 0, "already_invited": 0, "not_eligible": len(not_eligible),
              "email": {"sent": 0, "skipped": 0, "failed": 0}}
    for app_id in targets:
        row = current.get(app_id)
        if row and row["status"] == "invited":
            result["already_invited"] += 1
            continue
        if row:
            db_client.table("oa_invites").update({"status": "invited", "invited_by": current_user["id"]}) \
                .eq("id", row["id"]).execute()
        else:
            db_client.table("oa_invites").insert({
                "application_id": app_id, "assessment_id": assessment["id"], "invited_by": current_user["id"],
            }).execute()
        status = oa_emails.send_invite(app_id, start, end)
        db_client.table("oa_invites").update(
            {"email_status": status, "last_emailed_at": datetime.now(timezone.utc).isoformat()}
        ).eq("application_id", app_id).execute()
        result["invited"] += 1
        result["email"][status] += 1
    return result


@router.get(_BASE + "/invites")
def list_invites(job_id: str, drive_id: str, current_user: dict = Depends(require_company_role)) -> List[Dict[str, Any]]:
    job, drive = _owned_drive(job_id, drive_id, current_user)
    assessment = _need_assessment(drive)
    invites = {
        r["application_id"]: r
        for r in db_client.table("oa_invites").select("*").eq("assessment_id", assessment["id"]).execute().data or []
    }
    attempts = {a["application_id"]: a for a in _attempts(assessment["id"])}
    apps = _drive_applications(job, drive)
    people = get_profiles_basic([a["student_id"] for a in apps])
    out = []
    for a in apps:
        inv, att, p = invites.get(a["id"]), attempts.get(a["id"]), people.get(a["student_id"], {})
        out.append({
            "application_id": a["id"],
            "name": p.get("name") or " ".join(x for x in [p.get("first_name"), p.get("last_name")] if x) or "Candidate",
            "email": p.get("email"),
            "invited": bool(inv and inv["status"] == "invited"),
            "email_status": (inv or {}).get("email_status"),
            "attempt": (att["status"] if att else None),
        })
    return out


@router.post(_BASE + "/invites/{application_id}/resend")
def resend_invite(
    job_id: str, drive_id: str, application_id: str,
    current_user: dict = Depends(require_company_role),
) -> Dict[str, str]:
    _, drive = _owned_drive(job_id, drive_id, current_user)
    assessment = _need_assessment(drive)
    inv = _first(db_client.table("oa_invites").select("*").eq("application_id", application_id)
                 .eq("assessment_id", assessment["id"]).limit(1).execute())
    if not inv or inv["status"] != "invited":
        raise HTTPException(status_code=404, detail="That applicant hasn't been invited.")
    start, end = _window(drive)
    status = oa_emails.send_invite(application_id, start, end, reminder=True)
    db_client.table("oa_invites").update(
        {"email_status": status, "last_emailed_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", inv["id"]).execute()
    return {"email": status}


@router.delete(_BASE + "/invites/{application_id}", status_code=204)
def revoke_invite(
    job_id: str, drive_id: str, application_id: str,
    current_user: dict = Depends(require_company_role),
) -> None:
    _, drive = _owned_drive(job_id, drive_id, current_user)
    assessment = _need_assessment(drive)
    if _first(db_client.table("oa_attempts").select("id").eq("application_id", application_id).limit(1).execute()):
        raise HTTPException(status_code=409, detail="This candidate has already started.")
    db_client.table("oa_invites").update({"status": "revoked"}) \
        .eq("application_id", application_id).eq("assessment_id", assessment["id"]).execute()


@router.post(_BASE + "/remind")
def remind(job_id: str, drive_id: str, current_user: dict = Depends(require_company_role)) -> Dict[str, int]:
    _, drive = _owned_drive(job_id, drive_id, current_user)
    assessment = _need_assessment(drive)
    started = {a["application_id"] for a in _attempts(assessment["id"])}
    invites = db_client.table("oa_invites").select("*").eq("assessment_id", assessment["id"]) \
        .eq("status", "invited").execute().data or []
    start, end = _window(drive)
    counts = {"sent": 0, "skipped": 0, "failed": 0}
    for inv in invites:
        if inv["application_id"] in started:
            continue
        counts[oa_emails.send_invite(inv["application_id"], start, end, reminder=True)] += 1
        db_client.table("oa_invites").update({"last_emailed_at": datetime.now(timezone.utc).isoformat()}) \
            .eq("id", inv["id"]).execute()
    return counts


# ── Results ─────────────────────────────────────────────────────────

def _row(app_id: str, inv: Optional[dict], att: Optional[dict], person: dict) -> Dict[str, Any]:
    started = _parse_ts(att["started_at"]) if att else None
    done = _parse_ts(att.get("submitted_at")) if att and att.get("submitted_at") else None
    score, mx = (float(att["score"]), float(att["max_score"])) if att and att.get("score") is not None else (None, None)
    tabs = int(att.get("tab_switches") or 0) if att else 0
    return {
        "application_id": app_id,
        "name": person.get("name") or " ".join(x for x in [person.get("first_name"), person.get("last_name")] if x) or "Candidate",
        "email": person.get("email"),
        "invited": bool(inv and inv["status"] == "invited"),
        "state": "not_started" if not att else att["status"],
        "score": score, "max_score": mx,
        "percent": round(100 * score / mx, 1) if score is not None and mx else None,
        "started_at": str(att["started_at"]) if att else None,
        "submitted_at": str(att["submitted_at"]) if att and att.get("submitted_at") else None,
        "time_taken_seconds": int((done - started).total_seconds()) if started and done else None,
        "tab_switches": tabs,
        "fullscreen_exits": int(att.get("fullscreen_exits") or 0) if att else 0,
        "paste_events": int(att.get("paste_events") or 0) if att else 0,
        "flagged": tabs > FLAG_TAB_SWITCHES,
    }


@router.get(_BASE + "/results")
def results(job_id: str, drive_id: str, current_user: dict = Depends(require_company_role)) -> Dict[str, Any]:
    job, drive = _owned_drive(job_id, drive_id, current_user)
    assessment = _need_assessment(drive)
    invites = {r["application_id"]: r for r in
               db_client.table("oa_invites").select("*").eq("assessment_id", assessment["id"]).execute().data or []}
    attempts = {a["application_id"]: a for a in _attempts(assessment["id"])}
    ids = set(attempts) | {k for k, v in invites.items() if v["status"] == "invited"}
    apps = {a["id"]: a for a in list_applications_for_job(job_id) if a["id"] in ids}
    people = get_profiles_basic([a["student_id"] for a in apps.values()])
    rows = [_row(i, invites.get(i), attempts.get(i), people.get(apps[i]["student_id"], {})) for i in apps]
    scored = [r["percent"] for r in rows if r["percent"] is not None]
    return {
        "rows": rows,
        "stats": {
            "invited": sum(1 for r in rows if r["invited"]),
            "started": sum(1 for r in rows if r["state"] != "not_started"),
            "submitted": sum(1 for r in rows if r["state"] == "submitted"),
            "average_percent": round(sum(scored) / len(scored), 1) if scored else None,
            "flagged": sum(1 for r in rows if r["flagged"]),
        },
    }


@router.get(_BASE + "/results/{application_id}")
def result_detail(
    job_id: str, drive_id: str, application_id: str,
    current_user: dict = Depends(require_company_role),
) -> Dict[str, Any]:
    job, drive = _owned_drive(job_id, drive_id, current_user)
    assessment = _need_assessment(drive)
    app = next((a for a in list_applications_for_job(job_id) if a["id"] == application_id), None)
    attempt = _first(db_client.table("oa_attempts").select("*").eq("application_id", application_id)
                     .eq("assessment_id", assessment["id"]).limit(1).execute())
    if not app or not attempt:
        raise HTTPException(status_code=404, detail="No attempt found for that applicant.")
    inv = _first(db_client.table("oa_invites").select("*").eq("application_id", application_id).limit(1).execute())
    person = get_profiles_basic([app["student_id"]]).get(app["student_id"], {})

    definition = _definition(assessment)
    sections = db_client.table("oa_sections").select("id, position").eq("assessment_id", assessment["id"]).execute().data or []
    questions = db_client.table("oa_questions").select("*").in_("section_id", [s["id"] for s in sections]).execute().data or []
    sec_pos = {s["id"]: s["position"] for s in sections}
    answers = {a["question_id"]: a for a in
               db_client.table("oa_answers").select("*").eq("attempt_id", attempt["id"]).execute().data or []}
    subs = db_client.table("oa_submissions").select("*").eq("attempt_id", attempt["id"]) \
        .order("created_at", desc=False).execute().data or []
    by_q: Dict[str, List[dict]] = {}
    for s in subs:
        by_q.setdefault(s["question_id"], []).append(s)

    detail_qs = []
    for q in sorted(questions, key=lambda x: (sec_pos.get(x["section_id"], 0), x["position"])):
        ans = answers.get(q["id"]) or {}
        entry: Dict[str, Any] = {
            "section": sec_pos.get(q["section_id"]), "position": q["position"], "qtype": q["qtype"],
            "title": q["title"], "points": int(q["points"]),
        }
        if q["qtype"] == "mcq":
            chosen = ans.get("answer")
            entry.update({
                "options": q.get("options"), "correct_option": q.get("correct_option"),
                "chosen_option": int(chosen) if chosen not in (None, "") and str(chosen).isdigit() else None,
            })
        else:
            qs = by_q.get(q["id"], [])
            best = max(qs, key=lambda s: float(s["score"])) if qs else None
            entry.update({
                "best_score": float(best["score"]) if best else 0.0,
                "draft": {"language": ans.get("language"), "source": ans.get("answer")} if ans.get("answer") else None,
                "submissions": [
                    {"id": s["id"], "language": s["language"], "verdict": s["verdict"], "passed": s["passed"],
                     "total": s["total"], "score": float(s["score"]), "created_at": str(s["created_at"]),
                     "source": s["source"]}
                    for s in qs
                ],
            })
        detail_qs.append(entry)

    return {
        "candidate": _row(application_id, inv, attempt, person),
        "assessment_title": assessment["title"],
        "questions": detail_qs,
        "section_titles": {s["position"]: s["title"] for s in definition["sections"]},
    }
