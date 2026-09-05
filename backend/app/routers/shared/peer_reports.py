"""
Internal Peer Reports Webhook — /internal/peer-reports
────────────────────────────────────────────────────────
Server-to-server endpoint called by PeerMeet's signaling server after each
`generateReport()` succeeds. Persists the report into
`public.peer_interview_reports` via the service-role db_client (bypasses RLS
so the write always lands; SELECT is still gated by the student-scoped RLS
policy on the table).

Authentication
    Shared-secret bearer token — the SAME PEERMEET_SHARED_SECRET used to
    sign the dashboard→PeerMeet handoff token. This is a single trusted
    server-to-server caller; a plain shared secret compared with
    `hmac.compare_digest` is the simplest secure fit and avoids introducing
    a second config knob.
"""

from __future__ import annotations

import hmac
import logging
import os
from typing import Any, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ...deps import db_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])

PEERMEET_SHARED_SECRET = os.getenv("PEERMEET_SHARED_SECRET")


class PeerReportPayload(BaseModel):
    """Mirrors the existing PeerMeet report shape verbatim; every score/list
    field is optional so a fallback report (all-nulls) still persists."""
    overall_score: Optional[float] = None
    technical_score: Optional[float] = None
    communication_score: Optional[float] = None
    confidence_score: Optional[float] = None
    problem_solving_score: Optional[float] = None
    topics_covered: List[str] = Field(default_factory=list)
    strengths: List[str] = Field(default_factory=list)
    weaknesses: List[str] = Field(default_factory=list)
    question_timeline: List[Any] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)
    final_recommendation: Optional[str] = None


class PeerReportIn(BaseModel):
    room_id: str
    student_id: str
    partner_student_id: Optional[str] = None
    role: str  # 'candidate' | 'interviewer'
    report: PeerReportPayload


def _verify_secret(authorization: Optional[str]) -> None:
    if not PEERMEET_SHARED_SECRET:
        raise HTTPException(status_code=503, detail="PeerMeet integration is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    supplied = authorization.split(" ", 1)[1]
    if not hmac.compare_digest(supplied, PEERMEET_SHARED_SECRET):
        raise HTTPException(status_code=401, detail="Invalid bearer token")


@router.post("/peer-reports", status_code=201)
def ingest_peer_report(
    body: PeerReportIn,
    authorization: Optional[str] = Header(None),
) -> dict:
    _verify_secret(authorization)

    if body.role not in ("candidate", "interviewer"):
        raise HTTPException(status_code=422, detail="role must be candidate or interviewer")

    r = body.report
    row = {
        "room_id": body.room_id,
        "student_id": body.student_id,
        "partner_student_id": body.partner_student_id,
        "role": body.role,
        "overall_score": r.overall_score,
        "technical_score": r.technical_score,
        "communication_score": r.communication_score,
        "confidence_score": r.confidence_score,
        "problem_solving_score": r.problem_solving_score,
        "topics_covered": r.topics_covered,
        "strengths": r.strengths,
        "weaknesses": r.weaknesses,
        "question_timeline": r.question_timeline,
        "suggestions": r.suggestions,
        "final_recommendation": r.final_recommendation,
    }

    try:
        res = db_client.table("peer_interview_reports").insert(row).execute()
    except Exception as e:
        logger.exception("peer_interview_reports insert failed")
        raise HTTPException(status_code=500, detail=f"Insert failed: {e}")

    inserted = (res.data or [{}])[0]
    return {"ok": True, "id": inserted.get("id")}
