"""
Internal Peer Reports Webhook — /internal/peer-reports
────────────────────────────────────────────────────────
Server-to-server endpoint called by PeerMeet's signaling server after each
`generateReport()` succeeds. Persists the report into
`public.peer_interview_reports` via the service-role db_client (bypasses RLS
so the write always lands; SELECT is still gated by the student-scoped RLS
policy on the table).

Authentication
    Bearer secret (PEERMEET_WEBHOOK_SECRET, falling back to the older shared
    PEERMEET_SHARED_SECRET so existing deployments keep working), compared with
    `hmac.compare_digest`. When the sender also supplies X-Peer-Timestamp and
    X-Peer-Signature (HMAC-SHA256 of "<timestamp>.<raw body>") the signature must
    verify and the timestamp must be within 5 minutes, which blocks tampering and
    replay. Set PEERMEET_REQUIRE_SIGNATURE=1 to make the signature mandatory.

Idempotency
    A report is unique per (room, student, role, phase): a retry updates the
    same row instead of creating a duplicate.
"""

from __future__ import annotations

import hmac
import hashlib
import logging
import os
import time
from typing import Any, List, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from ...deps import db_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])

SIGNATURE_MAX_AGE_SECONDS = 5 * 60


def _webhook_secret() -> Optional[str]:
    return os.getenv("PEERMEET_WEBHOOK_SECRET") or os.getenv("PEERMEET_SHARED_SECRET")


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
    # Which turn of the interview this report covers (a role switch starts phase 2).
    phase: int = Field(default=1, ge=1, le=10)
    # False for a mid-interview role-switch report; the meeting only completes on the final one.
    final: bool = True
    # True for the placeholder report PeerMeet produces when the AI could not run.
    unavailable: bool = False
    # True when the candidate said too little to judge: no scores, just an honest note.
    insufficient: bool = False
    # Did the partner ask to stay anonymous? Unknown (None) is treated as private when displayed.
    partner_private: Optional[bool] = None


def _verify_secret(authorization: Optional[str]) -> None:
    secret = _webhook_secret()
    if not secret:
        raise HTTPException(status_code=503, detail="PeerMeet integration is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    supplied = authorization.split(" ", 1)[1]
    if not hmac.compare_digest(supplied, secret):
        raise HTTPException(status_code=401, detail="Invalid bearer token")


def _verify_signature(raw: bytes, timestamp: Optional[str], signature: Optional[str]) -> None:
    """Optional body signature (mandatory with PEERMEET_REQUIRE_SIGNATURE=1)."""
    required = os.getenv("PEERMEET_REQUIRE_SIGNATURE", "").lower() in ("1", "true", "yes")
    if not timestamp and not signature:
        if required:
            raise HTTPException(status_code=401, detail="Missing request signature")
        return
    try:
        ts = int(timestamp or "")
    except ValueError:
        raise HTTPException(status_code=401, detail="Bad signature timestamp")
    if abs(time.time() - ts) > SIGNATURE_MAX_AGE_SECONDS:
        raise HTTPException(status_code=401, detail="Signature expired")
    expected = hmac.new(_webhook_secret().encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    if not signature or not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Invalid signature")


@router.post("/peer-reports", status_code=201)
async def ingest_peer_report(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_peer_timestamp: Optional[str] = Header(None),
    x_peer_signature: Optional[str] = Header(None),
) -> dict:
    _verify_secret(authorization)
    raw = await request.body()
    _verify_signature(raw, x_peer_timestamp, x_peer_signature)
    try:
        body = PeerReportIn.model_validate_json(raw)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=f"Invalid report: {e.errors()[0].get('msg', 'bad payload')}")

    if body.role not in ("candidate", "interviewer"):
        raise HTTPException(status_code=422, detail="role must be candidate or interviewer")

    # Both people must be real accounts; a bad id used to surface as a 500 foreign-key error.
    wanted = {body.student_id} | ({body.partner_student_id} if body.partner_student_id else set())
    known = {
        r["id"] for r in (
            db_client.table("profiles").select("id").in_("id", list(wanted)).execute().data or []
        )
    }
    if wanted - known:
        raise HTTPException(status_code=422, detail="Unknown student in report")

    # A session that ended as a no-show never gets a score or a feedback report.
    ns = db_client.table("peer_scheduled_meetings").select("status").eq("room_id", body.room_id).maybe_single().execute()
    if (getattr(ns, "data", None) or {}).get("status") == "no_show":
        raise HTTPException(status_code=409, detail="This session was a no-show: no report is created.")

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
        "phase": body.phase,
        "partner_private": body.partner_private,
        "unavailable": body.unavailable,
        "insufficient": body.insufficient,
    }

    try:
        # Upsert on the natural key, so a retried delivery updates the row instead of duplicating it.
        res = db_client.table("peer_interview_reports").upsert(
            row, on_conflict="room_id,student_id,role,phase"
        ).execute()
    except Exception as e:
        logger.exception("peer_interview_reports upsert failed")
        raise HTTPException(status_code=500, detail=f"Insert failed: {e}")

    # If this room is tied to a scheduled meeting, mark it completed. Report
    # arrival is the AUTHORITATIVE end-of-interview signal (never the clock,
    # never a first-participant join). No-op for matchmaking rooms with no
    # scheduled row. Failure here MUST NOT prevent the report row above from
    # being reported as inserted -- the report is what matters most.
    # A mid-interview role-switch report (final=false) must NOT end the meeting.
    if body.final:
        try:
            from ..candidate.peer import _complete_scheduled_meeting_for_room, complete_matchmaking_for_room
            _complete_scheduled_meeting_for_room(body.room_id)
            complete_matchmaking_for_room(body.room_id)
        except Exception:  # noqa: BLE001
            logger.exception("scheduled-meeting completion flip failed")

    inserted = (res.data or [{}])[0]
    return {"ok": True, "id": inserted.get("id")}


class MeetingReportIn(BaseModel):
    room_id: str
    reporter_student_id: str
    reason: str
    details: str = Field(default="", max_length=1000)
    block: bool = False
    # Captured by the PeerMeet server (not the browser) so it cannot be forged by the reporter.
    evidence: Optional[dict] = None


@router.post("/peer-safety/report", status_code=201)
async def ingest_meeting_report(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_peer_timestamp: Optional[str] = Header(None),
    x_peer_signature: Optional[str] = Header(None),
) -> dict:
    """A report raised from inside a PeerMeet room. Same auth as the report webhook."""
    _verify_secret(authorization)
    raw = await request.body()
    _verify_signature(raw, x_peer_timestamp, x_peer_signature)
    try:
        body = MeetingReportIn.model_validate_json(raw)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=f"Invalid report: {e.errors()[0].get('msg', 'bad payload')}")
    from ...services import peer_safety
    evidence = body.evidence
    if evidence is not None:
        # Bound what we store: a few hundred short lines at most.
        lines = [str(x)[:400] for x in (evidence.get("transcript") or [])][-200:]
        evidence = {"transcript": lines, "captured_at": evidence.get("captured_at")}
    return peer_safety.file_report(
        reporter_id=body.reporter_student_id, room_id=body.room_id, reason=body.reason,
        details=body.details, block=body.block, evidence=evidence, source="meeting",
    )


@router.post("/peer/maintenance")
def peer_maintenance(authorization: Optional[str] = Header(None)) -> dict:
    """Scheduled upkeep: expire stale matches and scheduled meetings nobody finished.
    Call every few minutes from any scheduler with the webhook secret."""
    _verify_secret(authorization)
    from ..candidate.peer import run_maintenance
    return run_maintenance()
