"""Company AI Interviews router — a hiring team sets up an AI interview for a role,
invites candidates and reads the results.

  GET    /company/ai-interviews/presets                       starting rubrics (from the practice tracks)
  GET    /company/ai-interviews                               templates (archived hidden unless asked)
  POST   /company/ai-interviews                               create a template
  GET    /company/ai-interviews/{id}                          one template
  PATCH  /company/ai-interviews/{id}                          edit (rubric / duration changes bump the version)
  DELETE /company/ai-interviews/{id}                          archive (invites stop working; results stay)
  POST   /company/ai-interviews/{id}/invites                  invite by email and/or from a job's applicants
  GET    /company/ai-interviews/{id}/invites
  POST   /company/ai-interviews/{id}/invites/{invite}/resend
  DELETE /company/ai-interviews/{id}/invites/{invite}         revoke (only before the candidate starts)
  GET    /company/ai-interviews/{id}/results                  scoreboard
  GET    /company/ai-interviews/{id}/results/{invite}         one candidate in full
  PUT    /company/ai-interviews/{id}/results/{invite}/decision   the hiring team's own decision

Everything is scoped to the caller's own company. Candidates take these interviews through
POST /candidate/ai-interview/session with an inviteId (see routers/candidate/ai_interview.py).
Practice interviews are a separate path and never appear here.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator

from ...crud import (
    _escape_like,
    get_company_by_owner_id,
    get_job,
    get_profiles_basic,
    list_applications_for_job,
)
from ...deps import db_client, require_company_role
from ...services.ai_interview.rubric import (
    MAX_DURATION,
    MIN_DURATION,
    PRESETS,
    CompetencyIn,
    validate_rubric,
    with_percentages,
)
from ...services.ai_interview.invites import effective_status, parse_ts as _parse
from ...services.notifications import ai_interview_emails
from ..candidate.ai_interview import _summarize_integrity

log = logging.getLogger(__name__)
router = APIRouter(prefix="/company/ai-interviews", tags=["company-ai-interviews"])

MAX_INVITES_PER_REQUEST = 100
EMAIL_RE = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")

Level = Literal["intern", "junior", "mid", "senior"]


# ── Schemas ─────────────────────────────────────────────────────────

class TemplateIn(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    role_title: str = Field(min_length=2, max_length=120)
    level: Level = "junior"
    job_id: Optional[str] = None
    instructions: str = Field(default="", max_length=1000)
    duration_minutes: int = Field(default=20, ge=MIN_DURATION, le=MAX_DURATION)
    rubric: List[CompetencyIn]
    status: Literal["draft", "active"] = "draft"

    @field_validator("title", "role_title", "instructions")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @model_validator(mode="after")
    def _rubric_rules(self) -> "TemplateIn":
        validate_rubric(self.rubric)  # raises ValueError -> 422
        return self


class TemplatePatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=120)
    role_title: Optional[str] = Field(default=None, min_length=2, max_length=120)
    level: Optional[Level] = None
    job_id: Optional[str] = None
    clear_job: bool = False
    instructions: Optional[str] = Field(default=None, max_length=1000)
    duration_minutes: Optional[int] = Field(default=None, ge=MIN_DURATION, le=MAX_DURATION)
    rubric: Optional[List[CompetencyIn]] = None
    status: Optional[Literal["draft", "active", "archived"]] = None

    @model_validator(mode="after")
    def _rubric_rules(self) -> "TemplatePatch":
        if self.rubric is not None:
            validate_rubric(self.rubric)
        return self


class InviteIn(BaseModel):
    emails: List[str] = Field(default_factory=list)
    application_ids: List[str] = Field(default_factory=list)
    expires_in_days: int = Field(default=7, ge=1, le=30)

    @model_validator(mode="after")
    def _some_target(self) -> "InviteIn":
        if not self.emails and not self.application_ids:
            raise ValueError("Add at least one email address or choose applicants.")
        if len(self.emails) + len(self.application_ids) > MAX_INVITES_PER_REQUEST:
            raise ValueError(f"Invite at most {MAX_INVITES_PER_REQUEST} candidates at a time.")
        return self


class DecisionIn(BaseModel):
    decision: Optional[Literal["advance", "hold", "reject"]] = None  # null clears it
    note: str = Field(default="", max_length=1000)


# ── Helpers ─────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _first(res: Any) -> Optional[dict]:
    rows = res.data or []
    return rows[0] if rows else None


def _company(user: dict) -> dict:
    c = get_company_by_owner_id(user["id"])
    if not c:
        raise HTTPException(status_code=404, detail="Company profile not found. Please complete onboarding.")
    return c


def _template(template_id: str, user: dict) -> tuple[dict, dict]:
    company = _company(user)
    row = _first(
        db_client.table("ai_interview_templates").select("*")
        .eq("id", template_id).eq("company_id", company["id"]).limit(1).execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Interview not found.")
    return company, row


def _invite(template: dict, invite_id: str) -> dict:
    row = _first(
        db_client.table("ai_interview_invites").select("*")
        .eq("id", invite_id).eq("template_id", template["id"]).limit(1).execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    return row


def _check_job(company: dict, job_id: Optional[str]) -> None:
    if not job_id:
        return
    job = get_job(job_id)
    if not job or job.get("company_id") != company["id"]:
        raise HTTPException(status_code=400, detail="That job does not belong to your company.")


def _template_out(row: dict, counts: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "role_title": row["role_title"],
        "level": row.get("level", "junior"),
        "job_id": row.get("job_id"),
        "instructions": row.get("instructions") or "",
        "duration_minutes": row["duration_minutes"],
        "status": row["status"],
        "version": row.get("version", 1),
        "rubric": with_percentages(row.get("rubric") or []),
        "created_at": str(row.get("created_at", "")),
        "updated_at": str(row.get("updated_at", "")),
        "counts": counts or {"invited": 0, "started": 0, "completed": 0},
    }


def _counts_by_template(template_ids: List[str]) -> Dict[str, Dict[str, int]]:
    out = {t: {"invited": 0, "started": 0, "completed": 0} for t in template_ids}
    if not template_ids:
        return out
    rows = db_client.table("ai_interview_invites").select("template_id, status, expires_at") \
        .in_("template_id", template_ids).execute().data or []
    for r in rows:
        st = effective_status(r)
        if st in out[r["template_id"]]:
            out[r["template_id"]][st] += 1
    return out


def _find_student(email: str) -> Optional[dict]:
    """The candidate account for an email, if one exists (case-insensitive)."""
    row = _first(
        db_client.table("profiles").select("id, role, email").ilike("email", _escape_like(email)).limit(1).execute()
    )
    return row if row and row.get("role") == "candidate" else None


def _send(template: dict, company: dict, invite: dict, *, reminder: bool = False) -> str:
    status = ai_interview_emails.send_invite(
        invite_id=invite["id"], to=invite["email"], company=company["name"], role=template["role_title"],
        duration_minutes=template["duration_minutes"], expires_at=invite["expires_at"],
        instructions=template.get("instructions") or "", reminder=reminder,
    )
    db_client.table("ai_interview_invites").update(
        {"last_emailed_at": _iso(_now()), "email_status": status}
    ).eq("id", invite["id"]).execute()
    return status


# ── Presets ─────────────────────────────────────────────────────────

@router.get("/presets")
def presets(current_user: dict = Depends(require_company_role)) -> List[Dict[str, Any]]:
    return [
        {"id": pid, "label": p["label"], "role_title": p["role_title"],
         "competencies": with_percentages(p["competencies"])}
        for pid, p in PRESETS.items()
    ]


# ── Templates ───────────────────────────────────────────────────────

@router.get("")
def list_templates(
    include_archived: bool = Query(default=False),
    current_user: dict = Depends(require_company_role),
) -> List[Dict[str, Any]]:
    company = _company(current_user)
    rows = db_client.table("ai_interview_templates").select("*") \
        .eq("company_id", company["id"]).order("created_at", desc=True).execute().data or []
    if not include_archived:
        rows = [r for r in rows if r["status"] != "archived"]
    counts = _counts_by_template([r["id"] for r in rows])
    return [_template_out(r, counts[r["id"]]) for r in rows]


@router.post("", status_code=201)
def create_template(body: TemplateIn, current_user: dict = Depends(require_company_role)) -> Dict[str, Any]:
    company = _company(current_user)
    _check_job(company, body.job_id)
    row = db_client.table("ai_interview_templates").insert({
        "company_id": company["id"],
        "created_by": current_user["id"],
        "job_id": body.job_id,
        "title": body.title,
        "role_title": body.role_title,
        "level": body.level,
        "instructions": body.instructions,
        "duration_minutes": body.duration_minutes,
        "rubric": validate_rubric(body.rubric),
        "status": body.status,
        "version": 1,
    }).execute().data[0]
    return _template_out(row)


@router.get("/{template_id}")
def get_template(template_id: str, current_user: dict = Depends(require_company_role)) -> Dict[str, Any]:
    _, row = _template(template_id, current_user)
    return _template_out(row, _counts_by_template([row["id"]])[row["id"]])


@router.patch("/{template_id}")
def update_template(
    template_id: str, body: TemplatePatch, current_user: dict = Depends(require_company_role),
) -> Dict[str, Any]:
    company, row = _template(template_id, current_user)
    patch: Dict[str, Any] = {}
    for field in ("title", "role_title", "level", "instructions", "duration_minutes", "status"):
        value = getattr(body, field)
        if value is not None:
            patch[field] = value
    if body.clear_job:
        patch["job_id"] = None
    elif body.job_id is not None:
        _check_job(company, body.job_id)
        patch["job_id"] = body.job_id
    if body.rubric is not None:
        patch["rubric"] = validate_rubric(body.rubric)
    # Anything that changes what candidates are asked is a new version of the interview.
    if "rubric" in patch or ("duration_minutes" in patch and patch["duration_minutes"] != row["duration_minutes"]):
        patch["version"] = int(row.get("version", 1)) + 1
    if not patch:
        return _template_out(row, _counts_by_template([row["id"]])[row["id"]])
    patch["updated_at"] = _iso(_now())
    updated = db_client.table("ai_interview_templates").update(patch).eq("id", row["id"]).execute().data[0]
    return _template_out(updated, _counts_by_template([row["id"]])[row["id"]])


@router.delete("/{template_id}", status_code=204)
def archive_template(template_id: str, current_user: dict = Depends(require_company_role)) -> None:
    _, row = _template(template_id, current_user)
    db_client.table("ai_interview_templates").update(
        {"status": "archived", "updated_at": _iso(_now())}
    ).eq("id", row["id"]).execute()


# ── Invites ─────────────────────────────────────────────────────────

def _targets(body: InviteIn, template: dict, company: dict) -> tuple[Dict[str, Optional[str]], List[str]]:
    """Resolve the request into {email: application_id | None} plus the emails that are invalid."""
    wanted: Dict[str, Optional[str]] = {}
    invalid: List[str] = []
    for raw in body.emails:
        email = (raw or "").strip().lower()
        if not email:
            continue
        if not EMAIL_RE.match(email):
            invalid.append(raw.strip())
        else:
            wanted.setdefault(email, None)
    if body.application_ids:
        if not template.get("job_id"):
            raise HTTPException(status_code=400, detail="Link this interview to a job to invite its applicants.")
        job = get_job(template["job_id"])
        if not job or job.get("company_id") != company["id"]:
            raise HTTPException(status_code=400, detail="The linked job no longer belongs to your company.")
        apps = {a["id"]: a for a in list_applications_for_job(job["id"])}
        unknown = [a for a in body.application_ids if a not in apps]
        if unknown:
            raise HTTPException(status_code=400, detail="Some applicants do not belong to the linked job.")
        people = get_profiles_basic([apps[a]["student_id"] for a in body.application_ids])
        for app_id in body.application_ids:
            email = ((people.get(apps[app_id]["student_id"]) or {}).get("email") or "").strip().lower()
            if EMAIL_RE.match(email):
                wanted[email] = app_id
    return wanted, invalid


@router.post("/{template_id}/invites")
def invite(
    template_id: str, body: InviteIn, current_user: dict = Depends(require_company_role),
) -> Dict[str, Any]:
    company, template = _template(template_id, current_user)
    if template["status"] != "active":
        raise HTTPException(status_code=409, detail="Activate this interview before inviting candidates.")
    wanted, invalid = _targets(body, template, company)
    existing = {
        r["email"]: r
        for r in db_client.table("ai_interview_invites").select("*").eq("template_id", template["id"]).execute().data or []
    }
    expires = _iso(_now() + timedelta(days=body.expires_in_days))
    result = {"invited": 0, "reinvited": 0, "already_invited": 0, "already_taken": 0,
              "invalid": invalid, "emails_sent": 0, "emails_skipped": 0, "emails_failed": 0}

    for email, app_id in wanted.items():
        student = _find_student(email)
        row = existing.get(email)
        if row and row["status"] in ("started", "completed"):
            result["already_taken"] += 1
            continue
        if row and effective_status(row) == "invited":
            result["already_invited"] += 1
            continue
        if row:  # revoked or expired: invite again with a fresh window
            row = db_client.table("ai_interview_invites").update({
                "status": "invited", "expires_at": expires, "invited_by": current_user["id"],
                "student_id": student["id"] if student else row.get("student_id"),
                "application_id": app_id or row.get("application_id"),
            }).eq("id", row["id"]).execute().data[0]
            result["reinvited"] += 1
        else:
            row = db_client.table("ai_interview_invites").insert({
                "template_id": template["id"], "company_id": company["id"], "invited_by": current_user["id"],
                "email": email, "student_id": student["id"] if student else None,
                "application_id": app_id, "status": "invited", "expires_at": expires,
            }).execute().data[0]
            result["invited"] += 1
        sent = _send(template, company, row)
        result[{"sent": "emails_sent", "skipped": "emails_skipped"}.get(sent, "emails_failed")] += 1
    return result


def _report_for(room_id: Optional[str]) -> Optional[dict]:
    if not room_id:
        return None
    return _first(db_client.table("ai_voice_interview_reports").select("*").eq("room_id", room_id).limit(1).execute())


def _invite_row(inv: dict, person: Optional[dict], report: Optional[dict]) -> Dict[str, Any]:
    person = person or {}
    name = person.get("name") or " ".join(x for x in (person.get("first_name"), person.get("last_name")) if x) or None
    return {
        "id": inv["id"],
        "email": inv["email"],
        "name": name,
        "has_account": bool(inv.get("student_id")),
        "status": effective_status(inv),
        "expires_at": str(inv.get("expires_at") or ""),
        "started_at": inv.get("started_at"),
        "completed_at": inv.get("completed_at"),
        "last_emailed_at": inv.get("last_emailed_at"),
        "email_status": inv.get("email_status"),
        "decision": inv.get("decision"),
        "overall_score": report.get("overall_score") if report else None,
    }


@router.get("/{template_id}/invites")
def list_invites(template_id: str, current_user: dict = Depends(require_company_role)) -> List[Dict[str, Any]]:
    _, template = _template(template_id, current_user)
    invites = db_client.table("ai_interview_invites").select("*").eq("template_id", template["id"]) \
        .order("created_at", desc=True).execute().data or []
    people = get_profiles_basic([i.get("student_id") for i in invites])
    return [
        _invite_row(i, people.get(i.get("student_id")), _report_for(i.get("room_id")))
        for i in invites
    ]


@router.post("/{template_id}/invites/{invite_id}/resend")
def resend_invite(
    template_id: str, invite_id: str, current_user: dict = Depends(require_company_role),
) -> Dict[str, str]:
    company, template = _template(template_id, current_user)
    inv = _invite(template, invite_id)
    if effective_status(inv) != "invited":
        raise HTTPException(status_code=409, detail="Only an open invitation can be resent.")
    return {"email": _send(template, company, inv, reminder=True)}


@router.delete("/{template_id}/invites/{invite_id}", status_code=204)
def revoke_invite(
    template_id: str, invite_id: str, current_user: dict = Depends(require_company_role),
) -> None:
    _, template = _template(template_id, current_user)
    inv = _invite(template, invite_id)
    if inv["status"] in ("started", "completed"):
        raise HTTPException(status_code=409, detail="The candidate has already started this interview.")
    db_client.table("ai_interview_invites").update({"status": "revoked"}).eq("id", inv["id"]).execute()


# ── Results ─────────────────────────────────────────────────────────

def _integrity_events(room_ids: List[str]) -> Dict[str, List[dict]]:
    out: Dict[str, List[dict]] = {}
    if not room_ids:
        return out
    rows = db_client.table("ai_voice_interview_integrity_events") \
        .select("room_id, kind, offset_seconds, source").in_("room_id", room_ids) \
        .order("created_at").execute().data or []
    for e in rows:
        out.setdefault(e["room_id"], []).append(e)
    return out


def _competencies(report: Optional[dict]) -> List[dict]:
    return [
        {"name": c.get("name"), "score": c.get("score"), "weight": c.get("weight"), "evidence": c.get("evidence", "")}
        for c in ((report or {}).get("competency_scores") or [])
    ]


@router.get("/{template_id}/results")
def results(template_id: str, current_user: dict = Depends(require_company_role)) -> Dict[str, Any]:
    _, template = _template(template_id, current_user)
    invites = [
        i for i in db_client.table("ai_interview_invites").select("*").eq("template_id", template["id"])
        .execute().data or []
        if i["status"] in ("started", "completed")
    ]
    rooms = [i["room_id"] for i in invites if i.get("room_id")]
    events = _integrity_events(rooms)
    people = get_profiles_basic([i.get("student_id") for i in invites])
    rows = []
    for inv in invites:
        report = _report_for(inv.get("room_id"))
        base = _invite_row(inv, people.get(inv.get("student_id")), report)
        rows.append({
            **base,
            "technical_score": report.get("technical_score") if report else None,
            "communication_score": report.get("communication_score") if report else None,
            "recommendation": report.get("final_recommendation") if report else None,
            "partial": bool(report.get("partial")) if report else False,
            "competencies": _competencies(report),
            "integrity": _summarize_integrity(events.get(inv.get("room_id") or "", [])),
        })
    rows.sort(key=lambda r: (r["completed_at"] or r["started_at"] or ""), reverse=True)
    scored = [r["overall_score"] for r in rows if r["overall_score"] is not None]
    return {
        "template": _template_out(template),
        "summary": {
            "taken": len(rows),
            "reported": len(scored),
            "average_score": round(sum(scored) / len(scored), 1) if scored else None,
            "flagged": sum(1 for r in rows if r["integrity"]["total"] > 0),
        },
        "rows": rows,
    }


@router.get("/{template_id}/results/{invite_id}")
def result_detail(
    template_id: str, invite_id: str, current_user: dict = Depends(require_company_role),
) -> Dict[str, Any]:
    _, template = _template(template_id, current_user)
    inv = _invite(template, invite_id)
    if inv["status"] not in ("started", "completed"):
        raise HTTPException(status_code=404, detail="This candidate has not taken the interview.")
    room = inv.get("room_id")
    report = _report_for(room)
    session = _first(
        db_client.table("ai_voice_interview_sessions")
        .select("consent_at, consent_version, audio_consent, video_consent, rubric_snapshot, started_at")
        .eq("room_id", room).limit(1).execute()
    ) if room else None
    events = _integrity_events([room] if room else []).get(room or "", [])
    person = get_profiles_basic([inv.get("student_id")]).get(inv.get("student_id"))
    return {
        "candidate": _invite_row(inv, person, report),
        "rubric": with_percentages((session or {}).get("rubric_snapshot") or template.get("rubric") or []),
        "interview_version_note": "Scored against the rubric as it was when the candidate started.",
        "consent": {
            "accepted_at": (session or {}).get("consent_at"),
            "version": (session or {}).get("consent_version"),
            "audio": bool((session or {}).get("audio_consent")),
            "video": bool((session or {}).get("video_consent")),
        },
        "report": None if not report else {
            "partial": bool(report.get("partial")),
            "overall_score": report.get("overall_score"),
            "technical_score": report.get("technical_score"),
            "communication_score": report.get("communication_score"),
            "competencies": _competencies(report),
            "strengths": report.get("strengths") or [],
            "weaknesses": report.get("weaknesses") or [],
            "red_flags": report.get("red_flags") or [],
            "per_question": report.get("per_question") or [],
            "recommendation": report.get("final_recommendation"),
            "report_markdown": report.get("report_markdown"),
            "transcript": report.get("transcript"),
            "duration_seconds": report.get("duration_seconds"),
        },
        "integrity": _summarize_integrity(events),
        "integrity_events": [
            {"kind": e["kind"], "offset_seconds": e["offset_seconds"], "source": e.get("source") or "browser"}
            for e in events
        ],
        "decision": {
            "decision": inv.get("decision"), "note": inv.get("decision_note") or "",
            "decided_at": inv.get("decided_at"),
        },
    }


@router.put("/{template_id}/results/{invite_id}/decision")
def set_decision(
    template_id: str, invite_id: str, body: DecisionIn, current_user: dict = Depends(require_company_role),
) -> Dict[str, Any]:
    _, template = _template(template_id, current_user)
    inv = _invite(template, invite_id)
    if inv["status"] not in ("started", "completed"):
        raise HTTPException(status_code=409, detail="Record a decision after the candidate has taken the interview.")
    cleared = body.decision is None
    db_client.table("ai_interview_invites").update({
        "decision": body.decision,
        "decision_note": None if cleared else (body.note.strip() or None),
        "decided_by": None if cleared else current_user["id"],
        "decided_at": None if cleared else _iso(_now()),
    }).eq("id", inv["id"]).execute()
    return {"decision": body.decision, "note": "" if cleared else body.note.strip()}
