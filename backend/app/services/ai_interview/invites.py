"""Invite status rules shared by the company and candidate routers (pure)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional


def now() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(ts: Any) -> Optional[datetime]:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def effective_status(invite: dict) -> str:
    """An unused invite past its expiry reads as 'expired'. Nothing has to run to make it so."""
    if invite.get("status") == "invited":
        exp = parse_ts(invite.get("expires_at"))
        if exp and exp < now():
            return "expired"
    return invite.get("status") or "invited"
