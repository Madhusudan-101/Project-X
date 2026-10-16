"""
Internal AI Interview Reports Webhook — /internal/ai-interview-reports
───────────────────────────────────────────────────────────────────────
Server-to-server endpoint called by the AI interview agent (ai-interviewer/)
once it has graded an interview. Authenticated with a shared secret, compared
in constant time. Persists into public.ai_voice_interview_reports via the
service-role client and marks the matching session completed.

The student is NEVER taken from the payload: it is looked up from the session
row the backend created in POST /candidate/ai-interview/session, so a leaked
secret still cannot attribute a report to an arbitrary student.
"""

from __future__ import annotations

import hmac
import logging
import os
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ...deps import db_client
from ..candidate.ai_interview import MAX_EVENTS_PER_SESSION, VIDEO_KINDS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])


def _verify_secret(authorization: Optional[str]) -> None:
    secret = os.getenv("AI_INTERVIEW_SHARED_SECRET")
    if not secret:
        raise HTTPException(status_code=503, detail="AI interview integration is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    if not hmac.compare_digest(authorization.split(" ", 1)[1], secret):
        raise HTTPException(status_code=401, detail="Invalid bearer token")


def _score(v: Optional[float]) -> Optional[float]:
    return None if v is None else max(0.0, min(100.0, float(v)))


class CompetencyScoreIn(BaseModel):
    """One rubric competency as graded by the agent. Lenient on purpose: a model that
    answers on a 0-10 scale or leaves a score out must not make the whole report fail."""
    name: str = Field(default="", max_length=60)
    score: Optional[float] = None  # 0-100
    weight: Optional[float] = None
    evidence: str = Field(default="", max_length=2000)


class AiInterviewReportIn(BaseModel):
    room_id: str = Field(min_length=1, max_length=64)
    partial: bool = False
    overall_score: Optional[float] = None
    technical_score: Optional[float] = None
    communication_score: Optional[float] = None
    strengths: List[str] = Field(default_factory=list)
    weaknesses: List[str] = Field(default_factory=list)
    red_flags: List[str] = Field(default_factory=list)
    per_question: List[Any] = Field(default_factory=list)
    final_recommendation: Optional[str] = None
    report_markdown: Optional[str] = None
    transcript: Optional[str] = None
    duration_seconds: Optional[int] = None
    competency_scores: List[CompetencyScoreIn] = Field(default_factory=list, max_length=8)


@router.post("/ai-interview-reports", status_code=201)
def ingest_ai_interview_report(
    body: AiInterviewReportIn,
    authorization: Optional[str] = Header(None),
) -> dict:
    _verify_secret(authorization)

    sess = (
        db_client.table("ai_voice_interview_sessions")
        .select("student_id, domain, invite_id")
        .eq("room_id", body.room_id)
        .limit(1)
        .execute()
    ).data
    if not sess:
        raise HTTPException(status_code=404, detail="Unknown interview session")

    row = {
        "room_id": body.room_id,
        "student_id": sess[0]["student_id"],
        "domain": sess[0]["domain"],
        "partial": body.partial,
        "overall_score": _score(body.overall_score),
        "technical_score": _score(body.technical_score),
        "communication_score": _score(body.communication_score),
        "strengths": body.strengths,
        "weaknesses": body.weaknesses,
        "red_flags": body.red_flags,
        "per_question": body.per_question,
        "final_recommendation": body.final_recommendation,
        "report_markdown": body.report_markdown,
        "transcript": body.transcript,
        "duration_seconds": body.duration_seconds,
        "competency_scores": [
            {"name": c.name, "score": _score(c.score), "weight": c.weight, "evidence": c.evidence}
            for c in body.competency_scores
        ],
        # A company interview belongs to the hiring team: the candidate does not see its report.
        "candidate_visible": not sess[0].get("invite_id"),
    }

    try:
        # room_id is unique, so the agent retrying the webhook updates in place.
        res = db_client.table("ai_voice_interview_reports").upsert(row, on_conflict="room_id").execute()
    except Exception as e:
        logger.exception("ai_interview_reports upsert failed")
        raise HTTPException(status_code=500, detail=f"Insert failed: {e}")

    # Best effort: the report row above is what matters.
    try:
        db_client.table("ai_voice_interview_sessions").update({
            "status": "abandoned" if body.partial else "completed",
            "ended_at": datetime.now(timezone.utc).isoformat(),
        }).eq("room_id", body.room_id).execute()
    except Exception:  # noqa: BLE001
        logger.exception("ai_voice_interview_sessions status update failed")

    invite_id = sess[0].get("invite_id")
    if invite_id:
        try:
            db_client.table("ai_interview_invites").update({
                "status": "completed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", invite_id).execute()
        except Exception:  # noqa: BLE001
            logger.exception("ai_interview_invites completion update failed")

    return {"ok": True, "id": (res.data or [{}])[0].get("id")}


class VideoEventIn(BaseModel):
    kind: str
    offset_seconds: int = Field(ge=0, le=24 * 3600)


class VideoEventsIn(BaseModel):
    room_id: str = Field(min_length=1, max_length=64)
    events: List[VideoEventIn] = Field(min_length=1, max_length=20)


@router.post("/ai-interview-integrity", status_code=201)
def ingest_video_integrity(
    body: VideoEventsIn,
    authorization: Optional[str] = Header(None),
) -> dict:
    """Video-check observations from the interviewer agent (no face, more than one
    person, camera blocked). Stored only if the candidate consented to video
    analysis when starting, and only while the interview is live. The student is
    taken from the session row, never from the payload."""
    _verify_secret(authorization)
    bad = sorted({e.kind for e in body.events if e.kind not in VIDEO_KINDS})
    if bad:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown event kind. Must be one of: {', '.join(VIDEO_KINDS)}",
        )

    sess = (
        db_client.table("ai_voice_interview_sessions")
        .select("student_id, status, video_consent")
        .eq("room_id", body.room_id)
        .limit(1)
        .execute()
    ).data
    if not sess:
        raise HTTPException(status_code=404, detail="Unknown interview session")
    row = sess[0]
    if not row.get("video_consent"):
        raise HTTPException(status_code=403, detail="Candidate did not consent to video analysis")
    if row.get("status") != "started":
        raise HTTPException(status_code=409, detail="This interview has already finished")

    existing = (
        db_client.table("ai_voice_interview_integrity_events")
        .select("id", count="exact")
        .eq("room_id", body.room_id)
        .execute()
    )
    room_left = MAX_EVENTS_PER_SESSION - (existing.count or 0)
    batch = body.events[: max(0, room_left)]
    if batch:
        try:
            db_client.table("ai_voice_interview_integrity_events").insert([
                {
                    "room_id": body.room_id,
                    "student_id": row["student_id"],
                    "kind": e.kind,
                    "offset_seconds": e.offset_seconds,
                    "source": "agent",
                }
                for e in batch
            ]).execute()
        except Exception as e:  # noqa: BLE001
            logger.exception("video integrity insert failed")
            raise HTTPException(status_code=500, detail=f"Insert failed: {e}")
    return {"accepted": len(batch)}
