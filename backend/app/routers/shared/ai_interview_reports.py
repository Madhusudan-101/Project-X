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


@router.post("/ai-interview-reports", status_code=201)
def ingest_ai_interview_report(
    body: AiInterviewReportIn,
    authorization: Optional[str] = Header(None),
) -> dict:
    _verify_secret(authorization)

    sess = (
        db_client.table("ai_voice_interview_sessions")
        .select("student_id, domain")
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

    return {"ok": True, "id": (res.data or [{}])[0].get("id")}
