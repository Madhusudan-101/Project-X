"""Internal endpoints the PeerMeet server calls for the pre-call flow.

Same authentication as the report webhooks (bearer secret plus a signed, time-limited body).
They take a person id because the PeerMeet server has already verified that person's room token;
nothing here is reachable by a browser.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from .peer_reports import _verify_secret, _verify_signature
from ...services import peer_precall

router = APIRouter(prefix="/internal/peer", tags=["internal"])


class ConsentIn(BaseModel):
    room_id: str = Field(min_length=6, max_length=64)
    student_id: str
    answer: bool
    version: str


class ConsentCheckIn(BaseModel):
    room_id: str = Field(min_length=6, max_length=64)
    student_ids: List[str] = Field(max_length=2)


class PersonIn(BaseModel):
    student_id: str


class NoShowIn(BaseModel):
    room_id: str = Field(min_length=6, max_length=64)
    reporter_student_id: str


async def _body(request: Request, model, authorization, ts, sig):
    _verify_secret(authorization)
    raw = await request.body()
    _verify_signature(raw, ts, sig)
    try:
        return model.model_validate_json(raw)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=f"Invalid request: {e.errors()[0].get('msg', 'bad payload')}")


@router.post("/session-consent")
async def store_consent(request: Request, authorization: Optional[str] = Header(None),
                        x_peer_timestamp: Optional[str] = Header(None), x_peer_signature: Optional[str] = Header(None)) -> dict:
    b = await _body(request, ConsentIn, authorization, x_peer_timestamp, x_peer_signature)
    return peer_precall.record_session_consent(b.student_id, b.room_id, b.answer, b.version)


@router.post("/session-consent/check")
async def check_consent(request: Request, authorization: Optional[str] = Header(None),
                        x_peer_timestamp: Optional[str] = Header(None), x_peer_signature: Optional[str] = Header(None)) -> dict:
    b = await _body(request, ConsentCheckIn, authorization, x_peer_timestamp, x_peer_signature)
    return peer_precall.everyone_said_yes(b.room_id, b.student_ids)


@router.post("/onboarding/status")
async def onboarding_status(request: Request, authorization: Optional[str] = Header(None),
                            x_peer_timestamp: Optional[str] = Header(None), x_peer_signature: Optional[str] = Header(None)) -> dict:
    b = await _body(request, PersonIn, authorization, x_peer_timestamp, x_peer_signature)
    return {"seen": peer_precall.onboarding_seen(b.student_id)}


@router.post("/onboarding/seen")
async def onboarding_seen(request: Request, authorization: Optional[str] = Header(None),
                          x_peer_timestamp: Optional[str] = Header(None), x_peer_signature: Optional[str] = Header(None)) -> dict:
    b = await _body(request, PersonIn, authorization, x_peer_timestamp, x_peer_signature)
    peer_precall.mark_onboarding_seen(b.student_id)
    return {"ok": True}


@router.post("/no-show")
async def mark_no_show(request: Request, authorization: Optional[str] = Header(None),
                       x_peer_timestamp: Optional[str] = Header(None), x_peer_signature: Optional[str] = Header(None)) -> dict:
    b = await _body(request, NoShowIn, authorization, x_peer_timestamp, x_peer_signature)
    return peer_precall.mark_partner_no_show(b.room_id, b.reporter_student_id)
