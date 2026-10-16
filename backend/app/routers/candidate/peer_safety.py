"""Peer safety for candidates: report the person you met, block them, see your own reports.

  POST   /candidate/peer-safety/reports        report the other person in a room you were in
  GET    /candidate/peer-safety/reports        my reports (status only; never who I reported)
  GET    /candidate/peer-safety/blocks         people I blocked (anonymity-preserving labels)
  POST   /candidate/peer-safety/blocks         block the other person from a room
  DELETE /candidate/peer-safety/blocks/{id}    unblock
  GET    /candidate/peer-safety/status         am I currently suspended from peer interviews?

A report names a ROOM, not a person. The server works out who the partner was, so anonymity holds and
nobody can report a stranger they never met.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from postgrest.exceptions import APIError

from ...deps import get_current_user, db_client
from ...services import peer_safety as safety

router = APIRouter(prefix="/candidate/peer-safety", tags=["peer-safety"])


class ReportIn(BaseModel):
    room_id: str = Field(min_length=3, max_length=64)
    reason: str
    details: str = Field(default="", max_length=1000)
    block: bool = False


class AcceptIn(BaseModel):
    version: str = Field(min_length=3, max_length=40)
    rules: bool = False
    media: bool = False
    ai: bool = False


class FeedbackIn(BaseModel):
    room_id: str = Field(min_length=3, max_length=64)
    rating: int = Field(ge=1, le=5)
    tags: list[str] = Field(default_factory=list, max_length=9)
    comment: str = Field(default="", max_length=500)


class BlockIn(BaseModel):
    room_id: str = Field(min_length=3, max_length=64)


@router.post("/reports", status_code=201)
def create_report(body: ReportIn, current_user: dict = Depends(get_current_user)) -> dict:
    try:
        return safety.file_report(
            reporter_id=current_user["id"], room_id=body.room_id, reason=body.reason,
            details=body.details, block=body.block, source="dashboard",
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Could not save the report: {e.message}")


@router.get("/reports")
def my_reports(current_user: dict = Depends(get_current_user)) -> list[dict]:
    rows = (
        db_client.table("peer_user_reports").select("id, room_id, reason, status, created_at")
        .eq("reporter_id", current_user["id"]).order("created_at", desc=True).limit(100).execute().data or []
    )
    # Project explicitly: never leak who was reported (or the evidence) even if the query widens.
    return [{k: r.get(k) for k in ("id", "room_id", "reason", "status", "created_at")} for r in rows]


@router.get("/blocks")
def my_blocks(current_user: dict = Depends(get_current_user)) -> list[dict]:
    rows = (
        db_client.table("peer_blocks").select("id, label, created_at")
        .eq("blocker_id", current_user["id"]).order("created_at", desc=True).execute().data or []
    )
    # Only the anonymity-preserving label is shown, never the blocked person's id.
    return [{k: r.get(k) for k in ("id", "label", "created_at")} for r in rows]


@router.post("/blocks", status_code=201)
def block_from_room(body: BlockIn, current_user: dict = Depends(get_current_user)) -> dict:
    partner = safety.partner_in_room(current_user["id"], body.room_id)
    if not partner:
        raise HTTPException(status_code=422, detail="You can only block someone from a meeting you were in.")
    try:
        safety.add_block(current_user["id"], partner["id"], partner["label"], body.room_id)
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Could not block: {e.message}")
    return {"ok": True}


@router.delete("/blocks/{block_id}", status_code=204)
def unblock(block_id: str = Path(..., min_length=8), current_user: dict = Depends(get_current_user)) -> None:
    # Scoped to the caller: you can only remove your own blocks.
    db_client.table("peer_blocks").delete().eq("id", block_id).eq("blocker_id", current_user["id"]).execute()


@router.get("/guidelines")
def guidelines_state(current_user: dict = Depends(get_current_user)) -> dict:
    """The current guidelines version and whether this person has accepted it."""
    return safety.consent_state(current_user["id"])


@router.post("/guidelines/accept")
def accept_guidelines(body: AcceptIn, current_user: dict = Depends(get_current_user)) -> dict:
    return safety.accept_guidelines(
        current_user["id"], body.version, rules=body.rules, media=body.media, ai=body.ai
    )


@router.post("/feedback")
def save_feedback(body: FeedbackIn, current_user: dict = Depends(get_current_user)) -> dict:
    """Rate a meeting you were in (1-5, optional tags and a short note). The partner never sees it."""
    return safety.save_feedback(current_user["id"], body.room_id, body.rating, body.tags, body.comment)


@router.get("/feedback")
def my_feedback(current_user: dict = Depends(get_current_user)) -> list[dict]:
    """Which meetings I already rated, so the UI does not ask twice."""
    rows = db_client.table("peer_feedback").select("room_id, rating").eq("student_id", current_user["id"]).execute().data or []
    return [{"room_id": r["room_id"], "rating": r["rating"]} for r in rows]


@router.get("/status")
def my_status(current_user: dict = Depends(get_current_user)) -> dict:
    s = safety.active_suspension(current_user["id"])
    return {"suspended": bool(s), "suspended_until": s.get("ends_at") if s else None}
