"""
AI Voice Interview Router — /candidate/ai-interview/*
──────────────────────────────────────────────────────────────────────────────
Backs the in-dashboard AI mock interviewer (a LiveKit voice agent that runs as
its own deployable, see /ai-interviewer).

  POST /candidate/ai-interview/session          start an interview: validates
        the domain and the candidate's acceptance of the rules, enforces the
        daily quota, creates the LiveKit room with the
        student's identity in its metadata, and returns a join token.
  GET  /candidate/ai-interview/config           duration, daily limit and attempts left,
        plus the version of the rules the candidate must accept.
  POST /candidate/ai-interview/session/{room}/integrity-events
        supervision signals from the browser (tab left, camera lost...), saved
        against the caller's own live session.
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
# db/ai_voice_interview_migration.sql.
DOMAIN_LABELS = {
    "ai_ml": "AI/ML",
    "web_dev": "Web Development",
    "dsa": "Data Structures & Algorithms",
}

ROOM_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
REPORTS_LIMIT = 50

# Bump when the rules shown on the briefing screen change materially. Candidates
# must accept the current version to start; the version is stored with the session.
CONSENT_VERSION = "2026-10-camera-v1"

# Signals the browser may report. "tab_hidden" and "window_blur" both mean the
# candidate left the interview page; camera_* track the mandatory camera.
INTEGRITY_KINDS = ("tab_hidden", "window_blur", "camera_lost", "camera_restored")
TAB_LEFT_KINDS = ("tab_hidden", "window_blur")
MAX_EVENTS_PER_REQUEST = 20
MAX_EVENTS_PER_SESSION = 200
# Events are only accepted while the interview could still be running.
EVENT_GRACE_MINUTES = 10


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
    # The candidate must explicitly accept the rules (and camera supervision).
    consent: bool
    consentVersion: str


class InterviewConfigOut(BaseModel):
    maxMinutes: int
    dailyLimit: int
    usedToday: int
    remainingToday: int
    consentVersion: str


class IntegrityEventIn(BaseModel):
    kind: str
    offsetSeconds: int = Field(ge=0, le=24 * 3600)


class IntegrityEventsIn(BaseModel):
    events: List[IntegrityEventIn] = Field(min_length=1, max_length=MAX_EVENTS_PER_REQUEST)


class IntegrityEventsOut(BaseModel):
    accepted: int


class IntegrityEventOut(BaseModel):
    kind: str
    offset_seconds: int


class IntegritySummary(BaseModel):
    tab_switches: int = 0
    camera_lost: int = 0
    total: int = 0


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
    integrity: IntegritySummary = Field(default_factory=IntegritySummary)


class AiInterviewReportDetailOut(AiInterviewReportOut):
    report_markdown: Optional[str] = None
    transcript: Optional[str] = None
    integrity_events: List[IntegrityEventOut] = Field(default_factory=list)


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


def _used_today(user_id: str) -> int:
    """Interviews the student started since 00:00 UTC (the daily quota counter)."""
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        used = (
            db_client.table("ai_voice_interview_sessions")
            .select("id", count="exact")
            .eq("student_id", user_id)
            .gte("started_at", day_start.isoformat())
            .execute()
        )
    except APIError as e:
        logger.exception("ai_voice_interview_sessions quota query failed")
        raise HTTPException(status_code=500, detail=f"Quota check failed: {e.message}")
    return used.count or 0


def _summarize_integrity(events: list[dict]) -> dict:
    tab = sum(1 for e in events if e.get("kind") in TAB_LEFT_KINDS)
    cam = sum(1 for e in events if e.get("kind") == "camera_lost")
    return {"tab_switches": tab, "camera_lost": cam, "total": tab + cam}


def _integrity_by_room(room_ids: list[str], student_id: str) -> dict[str, list[dict]]:
    """Integrity events for the given rooms, grouped by room, oldest first."""
    if not room_ids:
        return {}
    try:
        res = (
            db_client.table("ai_voice_interview_integrity_events")
            .select("room_id, kind, offset_seconds")
            .eq("student_id", student_id)
            .in_("room_id", room_ids)
            .order("created_at")
            .execute()
        )
    except APIError:
        logger.exception("integrity events lookup failed")
        return {}
    out: dict[str, list[dict]] = {}
    for e in res.data or []:
        out.setdefault(e["room_id"], []).append(e)
    return out


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.get("/config", response_model=InterviewConfigOut)
def get_interview_config(current_user: dict = Depends(require_candidate_role)):
    """Real limits for the briefing screen, so it never promises what the
    backend would refuse (duration, attempts left today, rules version)."""
    used = _used_today(current_user["id"])
    limit = _daily_limit()
    return InterviewConfigOut(
        maxMinutes=_max_minutes(),
        dailyLimit=limit,
        usedToday=used,
        remainingToday=max(0, limit - used),
        consentVersion=CONSENT_VERSION,
    )


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
    if not body.consent:
        raise HTTPException(
            status_code=400,
            detail="You must accept the interview rules and camera supervision to start.",
        )
    if body.consentVersion != CONSENT_VERSION:
        raise HTTPException(
            status_code=409,
            detail="The interview rules were updated. Reload the page and accept them again.",
        )
    url, key, secret = _livekit_creds()
    user_id = current_user["id"]

    # Daily quota: counts every interview the student started since 00:00 UTC.
    if _used_today(user_id) >= _daily_limit():
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

    agent_name = _cfg("AI_INTERVIEW_AGENT_NAME", "mirracle-interviewer")
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
        await lkapi.aclose()
        raise HTTPException(status_code=502, detail="Could not start the interview room")

    try:
        db_client.table("ai_voice_interview_sessions").insert({
            "room_id": room_name,
            "student_id": user_id,
            "domain": body.domain,
            "consent_at": datetime.now(timezone.utc).isoformat(),
            "consent_version": CONSENT_VERSION,
        }).execute()
    except APIError as e:
        await lkapi.aclose()
        logger.exception("ai_voice_interview_sessions insert failed")
        raise HTTPException(status_code=500, detail=f"Could not record session: {e.message}")

    # Explicit dispatch. A RoomConfiguration inside the join token is only
    # honoured when the token's join CREATES the room; we pre-create it (to
    # stamp the student/domain into its metadata), so the token route would
    # silently never start the agent.
    try:
        await lkapi.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(agent_name=agent_name, room=room_name)
        )
    except Exception:
        logger.exception("LiveKit create_dispatch failed")
        # Do not charge the student's daily quota for an interview that never started.
        try:
            db_client.table("ai_voice_interview_sessions").delete().eq("room_id", room_name).execute()
        except Exception:  # noqa: BLE001
            logger.exception("could not remove failed session row")
        raise HTTPException(status_code=502, detail="Could not start the AI interviewer")
    finally:
        await lkapi.aclose()

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
    )

    return StartSessionOut(
        serverUrl=url,
        roomName=room_name,
        participantToken=token.to_jwt(),
        maxMinutes=max_minutes,
    )


@router.post("/session/{room_id}/integrity-events", response_model=IntegrityEventsOut)
def post_integrity_events(
    room_id: str,
    body: IntegrityEventsIn,
    current_user: dict = Depends(require_candidate_role),
) -> IntegrityEventsOut:
    """Record supervision signals for the caller's own live interview. Events for
    someone else's room, a finished interview, or a stale session are refused,
    and a session can hold only MAX_EVENTS_PER_SESSION events."""
    if not ROOM_ID_RE.match(room_id):
        raise HTTPException(status_code=400, detail="Invalid room id")
    bad = sorted({e.kind for e in body.events if e.kind not in INTEGRITY_KINDS})
    if bad:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown event kind. Must be one of: {', '.join(INTEGRITY_KINDS)}",
        )
    user_id = current_user["id"]
    try:
        sess = (
            db_client.table("ai_voice_interview_sessions")
            .select("room_id, status, started_at")
            .eq("room_id", room_id)
            .eq("student_id", user_id)
            .limit(1)
            .execute()
        ).data
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Session lookup failed: {e.message}")
    if not sess:
        raise HTTPException(status_code=404, detail="Interview session not found")
    row = sess[0]
    if row.get("status") != "started":
        raise HTTPException(status_code=409, detail="This interview has already finished")
    try:
        started = datetime.fromisoformat(str(row["started_at"]).replace("Z", "+00:00"))
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        deadline = started + timedelta(minutes=_max_minutes() + EVENT_GRACE_MINUTES)
        if datetime.now(timezone.utc) > deadline:
            raise HTTPException(status_code=409, detail="This interview has already finished")
    except (KeyError, ValueError):
        pass  # unparseable timestamp: fall back to the status check above

    try:
        existing = (
            db_client.table("ai_voice_interview_integrity_events")
            .select("id", count="exact")
            .eq("room_id", room_id)
            .execute()
        )
        room_left = MAX_EVENTS_PER_SESSION - (existing.count or 0)
        batch = body.events[: max(0, room_left)]
        if batch:
            db_client.table("ai_voice_interview_integrity_events").insert([
                {
                    "room_id": room_id,
                    "student_id": user_id,
                    "kind": e.kind,
                    "offset_seconds": e.offsetSeconds,
                }
                for e in batch
            ]).execute()
    except APIError as e:
        logger.exception("integrity events insert failed")
        raise HTTPException(status_code=500, detail=f"Could not record events: {e.message}")
    return IntegrityEventsOut(accepted=len(batch))


@router.get("/reports", response_model=list[AiInterviewReportOut])
def list_my_reports(current_user: dict = Depends(require_candidate_role)):
    """Caller's own reports. The service-role client bypasses RLS, so the
    student_id filter is explicit and must stay."""
    try:
        res = (
            db_client.table("ai_voice_interview_reports")
            .select(_LIST_COLUMNS)
            .eq("student_id", current_user["id"])
            .order("created_at", desc=True)
            .limit(REPORTS_LIMIT)
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Reports list failed: {e.message}")
    rows = res.data or []
    events = _integrity_by_room([r["room_id"] for r in rows], current_user["id"])
    return [
        {**_row_to_out(r), "integrity": _summarize_integrity(events.get(r["room_id"], []))}
        for r in rows
    ]


@router.get("/reports/{room_id}", response_model=AiInterviewReportDetailOut)
def get_my_report(room_id: str, current_user: dict = Depends(require_candidate_role)):
    """One report for the caller. 404 while the agent has not posted it yet
    (the frontend polls this), and also for another student's room id."""
    if not ROOM_ID_RE.match(room_id):
        raise HTTPException(status_code=400, detail="Invalid room id")
    try:
        res = (
            db_client.table("ai_voice_interview_reports")
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
    events = _integrity_by_room([room_id], current_user["id"]).get(room_id, [])
    return {
        **_row_to_out(rows[0]),
        "integrity": _summarize_integrity(events),
        "integrity_events": [
            {"kind": e["kind"], "offset_seconds": e["offset_seconds"]} for e in events
        ],
    }
