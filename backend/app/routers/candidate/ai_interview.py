"""
AI Voice Interview Router — /candidate/ai-interview/*
──────────────────────────────────────────────────────────────────────────────
Backs the in-dashboard AI mock interviewer (a LiveKit voice agent that runs as
its own deployable, see /ai-interviewer).

  POST /candidate/ai-interview/session          start an interview: validates
        the domain, enforces the daily quota, creates the LiveKit room with the
        student's identity in its metadata, and returns a join token.
  GET  /candidate/ai-interview/reports          caller's own reports, newest first.
  GET  /candidate/ai-interview/reports/{room}   one report, incl. full markdown.

Reports are written by the agent through /internal/ai-interview-reports (see
routers/shared/ai_interview_reports.py), never by the browser.
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from postgrest.exceptions import APIError

from ...deps import db_client, require_candidate_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/candidate/ai-interview", tags=["ai-interview"])

# Keep in sync with ai-interviewer/domains.py and the CHECK constraints in
# db/ai_interview_migration.sql.
DOMAIN_LABELS = {
    "ai_ml": "AI/ML",
    "web_dev": "Web Development",
    "dsa": "Data Structures & Algorithms",
}

ROOM_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
REPORTS_LIMIT = 50


def _cfg(name: str, default: str) -> str:
    return os.getenv(name) or default


def _livekit_creds() -> tuple[str, str, str]:
    url = os.getenv("LIVEKIT_URL")
    key = os.getenv("LIVEKIT_API_KEY")
    secret = os.getenv("LIVEKIT_API_SECRET")
    if not (url and key and secret):
        raise HTTPException(status_code=503, detail="AI interview is not configured")
    return url, key, secret


def _daily_limit() -> int:
    try:
        return max(1, int(_cfg("AI_INTERVIEW_DAILY_LIMIT", "3")))
    except ValueError:
        return 3


def _max_minutes() -> int:
    try:
        return max(5, int(_cfg("AI_INTERVIEW_MAX_MINUTES", "20")))
    except ValueError:
        return 20


# ─── Schemas ──────────────────────────────────────────────────────────────────

class StartSessionIn(BaseModel):
    domain: str


class StartSessionOut(BaseModel):
    serverUrl: str
    roomName: str
    participantToken: str
    maxMinutes: int


class AiInterviewReportOut(BaseModel):
    id: str
    room_id: str
    domain: str
    partial: bool = False
    overall_score: Optional[float] = None
    technical_score: Optional[float] = None
    communication_score: Optional[float] = None
    strengths: List[str] = Field(default_factory=list)
    weaknesses: List[str] = Field(default_factory=list)
    red_flags: List[str] = Field(default_factory=list)
    per_question: List[Any] = Field(default_factory=list)
    final_recommendation: Optional[str] = None
    duration_seconds: Optional[int] = None
    created_at: datetime


class AiInterviewReportDetailOut(AiInterviewReportOut):
    report_markdown: Optional[str] = None
    transcript: Optional[str] = None


_LIST_COLUMNS = (
    "id, room_id, domain, partial, overall_score, technical_score, "
    "communication_score, strengths, weaknesses, red_flags, per_question, "
    "final_recommendation, duration_seconds, created_at"
)


def _row_to_out(r: dict) -> dict:
    return {
        **r,
        "strengths": r.get("strengths") or [],
        "weaknesses": r.get("weaknesses") or [],
        "red_flags": r.get("red_flags") or [],
        "per_question": r.get("per_question") or [],
        "partial": bool(r.get("partial")),
    }


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/session", response_model=StartSessionOut)
async def start_session(
    body: StartSessionIn,
    current_user: dict = Depends(require_candidate_role),
) -> StartSessionOut:
    if body.domain not in DOMAIN_LABELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid domain. Must be one of: {', '.join(DOMAIN_LABELS)}",
        )
    url, key, secret = _livekit_creds()
    user_id = current_user["id"]

    # Daily quota: counts every interview the student started since 00:00 UTC.
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        used = (
            db_client.table("ai_interview_sessions")
            .select("id", count="exact")
            .eq("student_id", user_id)
            .gte("started_at", day_start.isoformat())
            .execute()
        )
    except APIError as e:
        logger.exception("ai_interview_sessions quota query failed")
        raise HTTPException(status_code=500, detail=f"Quota check failed: {e.message}")
    if (used.count or 0) >= _daily_limit():
        raise HTTPException(
            status_code=429,
            detail=f"Daily limit of {_daily_limit()} AI interviews reached. Try again tomorrow.",
        )

    room_name = f"ai-{uuid.uuid4().hex[:12]}"
    max_minutes = _max_minutes()
    display_name = (
        current_user.get("name")
        or (current_user.get("email") or "").split("@")[0]
        or "Candidate"
    )

    from livekit import api  # imported lazily so the app boots without the package

    lkapi = api.LiveKitAPI(url, key, secret)
    try:
        # Unlike the standalone prototype, a room-creation failure is fatal:
        # the agent reads user_id/domain from this metadata and would otherwise
        # produce reports that cannot be attributed to the student.
        await lkapi.room.create_room(
            api.CreateRoomRequest(
                name=room_name,
                empty_timeout=60,
                max_participants=2,  # the candidate + the agent
                metadata=json.dumps({
                    "domain": body.domain,
                    "user_id": user_id,
                    "display_name": display_name,
                    "max_minutes": max_minutes,
                }),
            )
        )
    except Exception:
        logger.exception("LiveKit create_room failed")
        raise HTTPException(status_code=502, detail="Could not start the interview room")
    finally:
        await lkapi.aclose()

    try:
        db_client.table("ai_interview_sessions").insert({
            "room_id": room_name,
            "student_id": user_id,
            "domain": body.domain,
        }).execute()
    except APIError as e:
        logger.exception("ai_interview_sessions insert failed")
        raise HTTPException(status_code=500, detail=f"Could not record session: {e.message}")

    token = (
        api.AccessToken(key, secret)
        .with_identity(user_id)
        .with_name(display_name)
        .with_ttl(timedelta(minutes=max_minutes + 5))
        .with_grants(api.VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=False,
        ))
        .with_room_config(api.RoomConfiguration(
            agents=[api.RoomAgentDispatch(
                agent_name=_cfg("AI_INTERVIEW_AGENT_NAME", "mirracle-interviewer"),
            )],
        ))
    )

    return StartSessionOut(
        serverUrl=url,
        roomName=room_name,
        participantToken=token.to_jwt(),
        maxMinutes=max_minutes,
    )


@router.get("/reports", response_model=list[AiInterviewReportOut])
def list_my_reports(current_user: dict = Depends(require_candidate_role)):
    """Caller's own reports. The service-role client bypasses RLS, so the
    student_id filter is explicit and must stay."""
    try:
        res = (
            db_client.table("ai_interview_reports")
            .select(_LIST_COLUMNS)
            .eq("student_id", current_user["id"])
            .order("created_at", desc=True)
            .limit(REPORTS_LIMIT)
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Reports list failed: {e.message}")
    return [_row_to_out(r) for r in (res.data or [])]


@router.get("/reports/{room_id}", response_model=AiInterviewReportDetailOut)
def get_my_report(room_id: str, current_user: dict = Depends(require_candidate_role)):
    """One report for the caller. 404 while the agent has not posted it yet
    (the frontend polls this), and also for another student's room id."""
    if not ROOM_ID_RE.match(room_id):
        raise HTTPException(status_code=400, detail="Invalid room id")
    try:
        res = (
            db_client.table("ai_interview_reports")
            .select(_LIST_COLUMNS + ", report_markdown, transcript")
            .eq("room_id", room_id)
            .eq("student_id", current_user["id"])
            .limit(1)
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Report lookup failed: {e.message}")
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Report not ready yet")
    return _row_to_out(rows[0])
