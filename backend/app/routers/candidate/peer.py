"""
Peer Interview Router — /candidate/peer-session-token
──────────────────────────────────────────────────────
Mints a short-lived JWT the dashboard hands to PeerMeet (separately deployed)
so PeerMeet's signaling server can attach the caller's student identity to
their participant slot without redesigning PeerMeet's room model.

The token is signed with PEERMEET_SHARED_SECRET (dedicated to this
integration; NOT the Supabase JWT secret). PeerMeet's server verifies it
synchronously — no network round trip back to FastAPI.
"""

from __future__ import annotations

import os
import time
import logging

import jwt
from fastapi import APIRouter, Depends, HTTPException

from ...deps import get_current_user, db_client
from postgrest.exceptions import APIError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/candidate", tags=["peer-interview"])

PEERMEET_SHARED_SECRET = os.getenv("PEERMEET_SHARED_SECRET")
PEERMEET_TOKEN_TTL_SECONDS = 10 * 60  # 10 minutes


@router.post("/peer-session-token")
def mint_peer_session_token(current_user: dict = Depends(get_current_user)) -> dict:
    """Return a short-lived signed token PeerMeet can verify offline."""
    if not PEERMEET_SHARED_SECRET:
        # Fail loudly here rather than silently issuing an unsigned/weak token.
        raise HTTPException(status_code=503, detail="PeerMeet integration is not configured")

    # Resolve the caller's display name from profiles — kept small so the
    # token stays a tight identity blob and never carries the full session.
    name = None
    try:
        res = (
            db_client.table("profiles")
            .select("name, first_name, last_name, email")
            .eq("id", current_user["id"])
            .single()
            .execute()
        )
        row = res.data or {}
        name = row.get("name") or (
            " ".join(filter(None, [row.get("first_name"), row.get("last_name")])).strip()
            or row.get("email")
        )
    except APIError:
        name = current_user.get("email")

    now = int(time.time())
    payload = {
        "student_id": current_user["id"],
        "name": name or "Peer",
        "iat": now,
        "exp": now + PEERMEET_TOKEN_TTL_SECONDS,
    }
    token = jwt.encode(payload, PEERMEET_SHARED_SECRET, algorithm="HS256")
    return {"token": token, "expires_in": PEERMEET_TOKEN_TTL_SECONDS}
