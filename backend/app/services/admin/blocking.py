"""Block / unblock a user account.

Hard delete is intentionally NOT offered anywhere in the Admin Portal: this
platform's applications, round results and drives reference `profiles.id`,
so deleting a row (or the auth user it cascades from) would silently corrupt
placement history and every report derived from it. Blocking — temporary or
permanent — is the safe equivalent of "deactivate": it is enforced on every
request (see deps.get_current_user), fully reversible, and leaves all
historical data intact. If a genuine hard-delete need ever comes up, add it
deliberately with its own confirmation flow, a transaction, and an explicit
carve-out for rows with placement history — not by extending this module.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import HTTPException
from postgrest.exceptions import APIError

from ...crud import get_profile_by_id, update_profile
from ...deps import db_client, is_currently_blocked
from ...schemas import BlockUserIn, UnblockUserIn
from .events import log_event

_DURATIONS = {"1h": timedelta(hours=1), "24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
_MAX_CUSTOM = timedelta(days=3650)  # 10 years — bounds a fat-fingered custom date without banning long blocks


def _other_active_admins(exclude_id: str) -> int:
    """How many Admin accounts, other than `exclude_id`, are not currently
    blocked. Used to refuse an operation that would leave zero active admins."""
    try:
        rows = db_client.table("profiles").select("id, blocked_permanent, blocked_until").eq("role", "admin").execute().data or []
    except APIError:
        # Fail closed: if we can't verify, don't risk locking every admin out.
        return 0
    return sum(1 for r in rows if r["id"] != exclude_id and not is_currently_blocked(r))


def _get_target(user_id: str) -> Dict[str, Any]:
    profile = get_profile_by_id(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found.")
    return profile


def block_user(user_id: str, payload: BlockUserIn, admin: Dict[str, Any]) -> Dict[str, Any]:
    if user_id == admin["id"]:
        raise HTTPException(status_code=409, detail="You cannot block your own account.")
    target = _get_target(user_id)
    if target.get("role") == "admin" and _other_active_admins(user_id) == 0:
        raise HTTPException(
            status_code=409,
            detail="This is the only active Admin account — blocking it would lock every admin out of the platform.",
        )

    blocked_until = None
    if not payload.permanent:
        if payload.duration == "custom":
            try:
                until = datetime.fromisoformat(payload.until.replace("Z", "+00:00"))  # type: ignore[union-attr]
            except ValueError:
                raise HTTPException(status_code=422, detail="'until' must be an ISO 8601 instant.")
            if until.tzinfo is None:
                until = until.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            if until <= now:
                raise HTTPException(status_code=422, detail="'until' must be in the future.")
            if until - now > _MAX_CUSTOM:
                raise HTTPException(status_code=422, detail="A custom block cannot be more than 10 years.")
            blocked_until = until.isoformat()
        else:
            blocked_until = (datetime.now(timezone.utc) + _DURATIONS[payload.duration]).isoformat()  # type: ignore[index]

    now_iso = datetime.now(timezone.utc).isoformat()
    updated = update_profile(user_id, {
        "blocked_permanent": payload.permanent,
        "blocked_until": blocked_until,
        "blocked_at": now_iso,
        "blocked_by": admin["id"],
        "blocked_reason": payload.reason.strip(),
    })
    if not updated:
        raise HTTPException(status_code=500, detail="Could not update this account.")

    log_event(
        "user_blocked", actor_user_id=admin["id"], actor_role=admin["profile_role"], actor_label=admin["email"],
        target_type="user", target_id=user_id, target_label=target.get("email"),
        metadata={"permanent": payload.permanent, "until": blocked_until, "reason": payload.reason.strip()},
    )
    return {"user_id": user_id, "is_blocked": True, "permanent": payload.permanent, "blocked_until": blocked_until}


def unblock_user(user_id: str, payload: UnblockUserIn, admin: Dict[str, Any]) -> Dict[str, Any]:
    target = _get_target(user_id)
    was_blocked = is_currently_blocked(target)

    updated = update_profile(user_id, {
        "blocked_permanent": False,
        "blocked_until": None,
        "blocked_at": None,
        "blocked_by": None,
        "blocked_reason": None,
    })
    if not updated:
        raise HTTPException(status_code=500, detail="Could not update this account.")

    log_event(
        "user_unblocked", actor_user_id=admin["id"], actor_role=admin["profile_role"], actor_label=admin["email"],
        target_type="user", target_id=user_id, target_label=target.get("email"),
        metadata={"was_blocked": was_blocked, "reason": (payload.reason or "").strip() or None},
    )
    return {"user_id": user_id, "is_blocked": False}
