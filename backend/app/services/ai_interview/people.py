"""Who to tell: lookups for notification emails. Best effort, never raises."""

from __future__ import annotations

import logging
from typing import Optional

from ...crud import get_profiles_basic
from ...deps import db_client

log = logging.getLogger(__name__)


def company_owner_email(company_id: str) -> Optional[str]:
    """The email of the account that owns the company (where hiring-team notices go)."""
    try:
        rows = db_client.table("companies").select("owner_id").eq("id", company_id).limit(1).execute().data or []
        if not rows:
            return None
        return (get_profiles_basic([rows[0]["owner_id"]]).get(rows[0]["owner_id"]) or {}).get("email")
    except Exception:  # noqa: BLE001
        log.exception("company owner lookup failed")
        return None


def display_name(profile: Optional[dict], fallback: str) -> str:
    p = profile or {}
    name = p.get("name") or " ".join(x for x in (p.get("first_name"), p.get("last_name")) if x)
    return name or fallback
