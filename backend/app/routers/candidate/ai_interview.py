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
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from postgrest.exceptions import APIError

from ...crud import get_company_names
from ...deps import db_client, require_candidate_role
from ...services.ai_interview.invites import effective_status, parse_ts
from ...services.ai_interview.people import company_owner_email
from ...services.notifications import ai_interview_emails

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
CONSENT_VERSION = "2026-10-av-v3"

# Signals the browser may report. "tab_hidden" and "window_blur" both mean the
# candidate left the interview page; camera_* and mic_* track the mandatory
# camera and microphone dropping out and coming back.
INTEGRITY_KINDS = (
    "tab_hidden",
    "window_blur",
    "camera_lost",
    "camera_restored",
    "mic_lost",
    "mic_restored",
)
TAB_LEFT_KINDS = ("tab_hidden", "window_blur")
# Signals only the AI interviewer's video check may report (via the internal
# webhook), and only for candidates who consented to video analysis. Objective
# observations only: no judgement of gaze, emotion or appearance.
VIDEO_KINDS = ("no_face", "multiple_faces", "camera_blocked")
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
    # Exactly one of these: a practice track (domain) or an invitation from a company.
    domain: Optional[str] = None
    inviteId: Optional[str] = None
    # The candidate must explicitly accept the rules (and camera supervision).
    consent: bool
    # Separate, explicit permission for the AI interviewer to listen through the
    # microphone and transcribe the candidate's voice.
    audioConsent: bool
    # Separate, explicit permission for the AI interviewer to view the camera feed.
    videoConsent: bool
    consentVersion: str

    @model_validator(mode="after")
    def _one_mode(self) -> "StartSessionIn":
        if bool(self.domain) == bool(self.inviteId):
            raise ValueError("Send either a practice domain or an inviteId, not both or neither.")
        return self


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
    source: str = "browser"


class IntegritySummary(BaseModel):
    tab_switches: int = 0
    camera_lost: int = 0
    mic_lost: int = 0
    video_flags: int = 0
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
            .is_("invite_id", "null")  # company interviews do not use up practice attempts
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
    mic = sum(1 for e in events if e.get("kind") == "mic_lost")
    vid = sum(1 for e in events if e.get("kind") in VIDEO_KINDS)
    return {
        "tab_switches": tab,
        "camera_lost": cam,
        "mic_lost": mic,
        "video_flags": vid,
        "total": tab + cam + mic + vid,
    }


def _integrity_by_room(room_ids: list[str], student_id: str) -> dict[str, list[dict]]:
    """Integrity events for the given rooms, grouped by room, oldest first."""
    if not room_ids:
        return {}
    try:
        res = (
            db_client.table("ai_voice_interview_integrity_events")
            .select("room_id, kind, offset_seconds, source")
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


INVITE_ID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")

# A candidate may cancel a session only this soon after it began, and only if the interviewer
# never joined. Rejoining after a dropped connection is allowed until the time limit plus grace.
ABORT_WINDOW = timedelta(minutes=5)
REJOIN_GRACE = timedelta(minutes=2)


def _mint_token(key: str, secret: str, user_id: str, name: str, room: str, ttl_minutes: int) -> str:
    from livekit import api

    return (
        api.AccessToken(key, secret)
        .with_identity(user_id)
        .with_name(name)
        .with_ttl(timedelta(minutes=max(1, ttl_minutes)))
        .with_grants(api.VideoGrants(
            room_join=True,
            room=room,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=False,
        ))
        .to_jwt()
    )


def _my_session(room_id: str, user: dict) -> dict:
    """The caller's own live session, or a clear error. Never reveals another student's room."""
    if not ROOM_ID_RE.match(room_id):
        raise HTTPException(status_code=400, detail="Invalid room id")
    rows = (
        db_client.table("ai_voice_interview_sessions").select("*")
        .eq("room_id", room_id).eq("student_id", user["id"]).limit(1).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Interview session not found")
    sess = rows[0]
    reports = db_client.table("ai_voice_interview_reports").select("id").eq("room_id", room_id).limit(1).execute().data
    if sess.get("status") != "started" or reports:
        raise HTTPException(status_code=409, detail="This interview has already finished.")
    return sess


def _limit_minutes(sess: dict) -> int:
    """How long this session may run: the company's duration, or the practice default."""
    if sess.get("template_id"):
        rows = db_client.table("ai_interview_templates").select("duration_minutes")             .eq("id", sess["template_id"]).limit(1).execute().data or []
        if rows:
            return int(rows[0]["duration_minutes"])
    return _max_minutes()


def _my_invite(invite_id: str, user: dict) -> dict:
    """An invitation that belongs to the caller (by account or email), or 404."""
    if not INVITE_ID_RE.match(invite_id or ""):
        raise HTTPException(status_code=404, detail="Interview invitation not found.")
    rows = db_client.table("ai_interview_invites").select("*").eq("id", invite_id).limit(1).execute().data or []
    inv = rows[0] if rows else None
    email = (user.get("email") or "").strip().lower()
    if not inv or not (inv.get("student_id") == user["id"] or (inv.get("email") or "").lower() == email):
        raise HTTPException(status_code=404, detail="Interview invitation not found.")
    return inv


def _claim_invite(invite_id: str, user: dict) -> tuple[dict, dict, str]:
    """Check that this invitation is the caller's and still usable, then mark it started
    (one attempt per invitation). Returns (invite, template, company name). The claim is a
    conditional update, so two tabs cannot both start the same interview."""
    inv = _my_invite(invite_id, user)
    status = effective_status(inv)
    if status == "revoked":
        raise HTTPException(status_code=409, detail="This invitation was withdrawn by the company.")
    if status in ("started", "completed"):
        raise HTTPException(status_code=409, detail="You have already taken this interview.")
    if status == "expired":
        raise HTTPException(status_code=410, detail="This invitation has expired.")
    trows = db_client.table("ai_interview_templates").select("*").eq("id", inv["template_id"]).limit(1).execute().data or []
    template = trows[0] if trows else None
    if not template or template.get("status") != "active":
        raise HTTPException(status_code=409, detail="This interview is no longer available.")
    claimed = db_client.table("ai_interview_invites").update({
        "status": "started",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "student_id": user["id"],
    }).eq("id", inv["id"]).eq("status", "invited").execute().data or []
    if not claimed:
        raise HTTPException(status_code=409, detail="This interview was just started in another window.")
    company = get_company_names([inv["company_id"]]).get(inv["company_id"], "the company")
    return claimed[0], template, company


def _release_invite(invite_id: Optional[str]) -> None:
    """Give the candidate their attempt back when the interview could not start."""
    if not invite_id:
        return
    try:
        db_client.table("ai_interview_invites").update(
            {"status": "invited", "started_at": None, "room_id": None}
        ).eq("id", invite_id).eq("status", "started").execute()
    except Exception:  # noqa: BLE001
        logger.exception("could not release invite %s", invite_id)


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.get("/assignments")
def my_assignments(current_user: dict = Depends(require_candidate_role)) -> list[dict]:
    """Interviews companies have sent me (matched by my account or my email), safe for the
    candidate to see: no rubric and no scoring details."""
    uid = current_user["id"]
    email = (current_user.get("email") or "").strip().lower()
    found: dict[str, dict] = {}
    for r in db_client.table("ai_interview_invites").select("*").eq("student_id", uid).execute().data or []:
        found[r["id"]] = r
    if email:
        for r in db_client.table("ai_interview_invites").select("*").eq("email", email).execute().data or []:
            if r.get("student_id") in (None, uid):
                found[r["id"]] = r
                if r.get("student_id") is None:  # first sign-in: attach the invitation to the account
                    try:
                        db_client.table("ai_interview_invites").update({"student_id": uid}).eq("id", r["id"]).execute()
                    except Exception:  # noqa: BLE001
                        logger.exception("could not attach invite to account")
    invites = [i for i in found.values() if i.get("status") != "revoked"]
    if not invites:
        return []
    templates = {
        t["id"]: t for t in db_client.table("ai_interview_templates").select("*")
        .in_("id", list({i["template_id"] for i in invites})).execute().data or []
    }
    companies = get_company_names(list({i["company_id"] for i in invites}))
    out = []
    for i in invites:
        t = templates.get(i["template_id"])
        status = effective_status(i)
        if not t or (t["status"] == "archived" and status in ("invited", "expired")):
            continue
        out.append({
            "id": i["id"],
            "company_name": companies.get(i["company_id"], "A company"),
            "role_title": t["role_title"],
            "level": t.get("level", "junior"),
            "duration_minutes": t["duration_minutes"],
            "instructions": t.get("instructions") or "",
            "expires_at": str(i.get("expires_at") or ""),
            "status": status,
            "accommodation_requested": bool(i.get("accommodation_request")),
        })
    order = {"invited": 0, "started": 1, "completed": 2, "expired": 3}
    out.sort(key=lambda r: (order.get(r["status"], 9), r["expires_at"]))
    return out


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
    """Start an interview. Two modes:

    * practice: `domain` (one of the three tracks). Daily quota applies and the candidate
      sees their own report.
    * company: `inviteId`. One attempt per invitation, no daily quota, scored against the
      company's rubric, and the report goes to the hiring team (not the candidate).
    """
    if body.inviteId is None and body.domain not in DOMAIN_LABELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid domain. Must be one of: {', '.join(DOMAIN_LABELS)}",
        )
    if not body.consent:
        raise HTTPException(
            status_code=400,
            detail="You must accept the interview rules and camera supervision to start.",
        )
    if not body.audioConsent:
        raise HTTPException(
            status_code=400,
            detail="You must allow the AI interviewer to listen through your microphone to start.",
        )
    if not body.videoConsent:
        raise HTTPException(
            status_code=400,
            detail="You must allow the AI interviewer to view your camera to start.",
        )
    if body.consentVersion != CONSENT_VERSION:
        raise HTTPException(
            status_code=409,
            detail="The interview rules were updated. Reload the page and accept them again.",
        )
    url, key, secret = _livekit_creds()
    user_id = current_user["id"]

    invite: Optional[dict] = None
    template: Optional[dict] = None
    company_name = ""
    if body.inviteId is not None:
        invite, template, company_name = _claim_invite(body.inviteId, current_user)
        domain, max_minutes = "custom", int(template["duration_minutes"])
    else:
        # Practice: counts every interview the student started since 00:00 UTC.
        if _used_today(user_id) >= _daily_limit():
            raise HTTPException(
                status_code=429,
                detail=f"Daily limit of {_daily_limit()} AI interviews reached. Try again tomorrow.",
            )
        domain, max_minutes = body.domain, _max_minutes()
    invite_id = invite["id"] if invite else None

    room_name = f"ai-{uuid.uuid4().hex[:12]}"
    display_name = (
        current_user.get("name")
        or (current_user.get("email") or "").split("@")[0]
        or "Candidate"
    )
    metadata: dict = {
        "domain": domain,
        "user_id": user_id,
        "display_name": display_name,
        "max_minutes": max_minutes,
        # The agent listens only when audio_consent is true, and analyses
        # video only when video_consent is true.
        "audio_consent": True,
        "video_consent": True,
    }
    if template is not None:
        metadata.update({
            "invite_id": invite_id,
            "role_title": template["role_title"],
            "level": template.get("level", "junior"),
            "company_name": company_name,
            # Frozen now: editing the template later never changes this interview.
            "rubric": template.get("rubric") or [],
        })

    try:
        from livekit import api  # imported lazily so the app boots without the package

        agent_name = _cfg("AI_INTERVIEW_AGENT_NAME", "mirracle-interviewer")
        lkapi = api.LiveKitAPI(url, key, secret)
    except Exception:
        _release_invite(invite_id)
        raise
    try:
        # Unlike the standalone prototype, a room-creation failure is fatal:
        # the agent reads user_id/domain from this metadata and would otherwise
        # produce reports that cannot be attributed to the student.
        await lkapi.room.create_room(
            api.CreateRoomRequest(
                name=room_name,
                # Long enough to cover the agent's reconnect grace, so a dropped candidate can rejoin.
                empty_timeout=180,
                max_participants=2,  # the candidate + the agent
                metadata=json.dumps(metadata),
            )
        )
    except Exception:
        logger.exception("LiveKit create_room failed")
        await lkapi.aclose()
        _release_invite(invite_id)
        raise HTTPException(status_code=502, detail="Could not start the interview room")

    session_row: dict = {
        "room_id": room_name,
        "student_id": user_id,
        "domain": domain,
        "consent_at": datetime.now(timezone.utc).isoformat(),
        "audio_consent": True,
        "video_consent": True,
        "consent_version": CONSENT_VERSION,
    }
    if template is not None:
        session_row.update({
            "invite_id": invite_id,
            "template_id": template["id"],
            "role_title": template["role_title"],
            "rubric_snapshot": template.get("rubric") or [],
        })
    try:
        db_client.table("ai_voice_interview_sessions").insert(session_row).execute()
    except APIError as e:
        await lkapi.aclose()
        _release_invite(invite_id)
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
        # Do not charge the student's daily quota (or use up their one attempt)
        # for an interview that never started.
        try:
            db_client.table("ai_voice_interview_sessions").delete().eq("room_id", room_name).execute()
        except Exception:  # noqa: BLE001
            logger.exception("could not remove failed session row")
        _release_invite(invite_id)
        raise HTTPException(status_code=502, detail="Could not start the AI interviewer")
    finally:
        await lkapi.aclose()

    if invite_id:
        try:
            db_client.table("ai_interview_invites").update({"room_id": room_name}).eq("id", invite_id).execute()
        except Exception:  # noqa: BLE001
            logger.exception("could not link invite to room")

    return StartSessionOut(
        serverUrl=url,
        roomName=room_name,
        participantToken=_mint_token(key, secret, user_id, display_name, room_name, max_minutes + 5),
        maxMinutes=max_minutes,
    )


class AbortIn(BaseModel):
    reason: Literal["interviewer_missing"]


@router.post("/session/{room_id}/abort")
async def abort_session(
    room_id: str,
    body: AbortIn,
    current_user: dict = Depends(require_candidate_role),
) -> dict:
    """Cancel a session whose AI interviewer never joined, and give the attempt back.

    Allowed only in the first few minutes, and only after the backend has checked with LiveKit that
    nobody but the candidate is in the room. So it cannot be used to see the questions and retry.
    """
    sess = _my_session(room_id, current_user)
    started = parse_ts(sess.get("started_at"))
    if started is not None and datetime.now(timezone.utc) - started > ABORT_WINDOW:
        raise HTTPException(status_code=409, detail="It is too late to cancel this interview.")

    url, key, secret = _livekit_creds()
    from livekit import api

    lkapi = api.LiveKitAPI(url, key, secret)
    try:
        try:
            listed = await lkapi.room.list_participants(api.ListParticipantsRequest(room=room_id))
            others = [p for p in listed.participants if p.identity != current_user["id"]]
        except Exception:  # noqa: BLE001 - the room is already gone: nobody is in it
            others = []
        if others:
            raise HTTPException(status_code=409, detail="The interviewer is in the room, so this interview cannot be cancelled.")
        try:
            await lkapi.room.delete_room(api.DeleteRoomRequest(room=room_id))
        except Exception:  # noqa: BLE001
            logger.warning("could not delete room %s while aborting", room_id)
    finally:
        await lkapi.aclose()

    invite_id = sess.get("invite_id")
    if invite_id:
        db_client.table("ai_voice_interview_sessions").update({
            "status": "abandoned",
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "ended_reason": "interviewer_unavailable",
        }).eq("room_id", room_id).execute()
        _release_invite(invite_id)
    else:
        # Practice: remove the row so it does not count against today's limit.
        db_client.table("ai_voice_interview_sessions").delete().eq("room_id", room_id).execute()
    return {"released": True, "kind": "company" if invite_id else "practice"}


@router.post("/session/{room_id}/rejoin", response_model=StartSessionOut)
async def rejoin_session(
    room_id: str,
    current_user: dict = Depends(require_candidate_role),
) -> StartSessionOut:
    """A fresh join token for the candidate's own live interview after a dropped connection.
    Only while the interview is unfinished, the room still exists, and time remains."""
    sess = _my_session(room_id, current_user)
    started = parse_ts(sess.get("started_at")) or datetime.now(timezone.utc)
    limit = _limit_minutes(sess)
    now = datetime.now(timezone.utc)
    if now > started + timedelta(minutes=limit) + REJOIN_GRACE:
        raise HTTPException(status_code=410, detail="The interview time is over.")

    url, key, secret = _livekit_creds()
    from livekit import api

    lkapi = api.LiveKitAPI(url, key, secret)
    try:
        try:
            rooms = (await lkapi.room.list_rooms(api.ListRoomsRequest(names=[room_id]))).rooms
        except Exception:  # noqa: BLE001
            logger.exception("LiveKit list_rooms failed")
            raise HTTPException(status_code=502, detail="Could not reach the interview room.")
    finally:
        await lkapi.aclose()
    if not rooms:
        raise HTTPException(status_code=410, detail="The interview has ended.")

    left = started + timedelta(minutes=limit) - now
    minutes_left = max(1, int(-(-left.total_seconds() // 60)))
    display_name = current_user.get("name") or (current_user.get("email") or "").split("@")[0] or "Candidate"
    return StartSessionOut(
        serverUrl=url,
        roomName=room_id,
        participantToken=_mint_token(key, secret, current_user["id"], display_name, room_id, minutes_left + 5),
        maxMinutes=minutes_left,
    )


class AccommodationIn(BaseModel):
    message: str = Field(min_length=5, max_length=1000)


@router.post("/assignments/{invite_id}/accommodation")
def request_accommodation(
    invite_id: str,
    body: AccommodationIn,
    current_user: dict = Depends(require_candidate_role),
) -> dict:
    """Ask the hiring team for an accommodation (extra time, no camera, another format) before starting.
    The request is saved on the invitation and emailed to the company, who can extend the deadline."""
    inv = _my_invite(invite_id, current_user)
    if effective_status(inv) not in ("invited", "expired"):
        raise HTTPException(status_code=409, detail="You can only ask before you start the interview.")
    message = body.message.strip()
    db_client.table("ai_interview_invites").update({
        "accommodation_request": message,
        "accommodation_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", inv["id"]).execute()
    emailed = "skipped"
    to = company_owner_email(inv["company_id"])
    if to:
        trows = db_client.table("ai_interview_templates").select("role_title").eq("id", inv["template_id"]).limit(1).execute().data or []
        emailed = ai_interview_emails.send_accommodation_request(
            to=to,
            company=get_company_names([inv["company_id"]]).get(inv["company_id"], "your company"),
            role=(trows[0]["role_title"] if trows else "the role"),
            candidate_email=inv["email"],
            message=message,
        )
    return {"ok": True, "company_emailed": emailed == "sent"}


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
                    "source": "browser",
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
            .eq("candidate_visible", True)
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
            .eq("candidate_visible", True)
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
            {
                "kind": e["kind"],
                "offset_seconds": e["offset_seconds"],
                "source": e.get("source") or "browser",
            }
            for e in events
        ],
    }
