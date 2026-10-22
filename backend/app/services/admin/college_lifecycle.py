"""Suspending and reactivating a college — Super Admin / delegated admin with `colleges.suspend`.

There is deliberately NO new status column and NO new enforcement path. A college is suspended by
blocking its TPO accounts through the mechanism that already exists and is already enforced everywhere:

  * deps.get_current_user rejects a blocked profile (403) on EVERY request, so a suspended TPO is refused
    on their very next call — API calls, refresh and sign-in alike;
  * public.current_college_id() ignores a blocked account (db/tpo_access_hardening_migration.sql), so the
    tenant tables refuse them even when the browser talks to Supabase directly;
  * nothing is deleted: the roster, drives, departments and history are all still there, and
    reactivating restores access exactly as it was.

A suspension is recognised by the reason text the account was blocked with ("College suspended: …"),
so reactivating restores ONLY the accounts this action blocked. A TPO who was blocked individually
(for any other reason) before — or while — the college was suspended stays blocked.

What suspension does NOT do (stated here so nobody assumes it): it does not hide the college from
students, stop companies publishing drives at it, or touch any student or company account. Those belong
to the Candidate and Company portals and would need their cooperation.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field, field_validator

from ...crud import update_profile
from ...deps import db_client, is_currently_blocked
from .events import log_event

log = logging.getLogger(__name__)

SUSPENSION_PREFIX = "College suspended: "
_UNBLOCKED = {
    "blocked_permanent": False, "blocked_until": None, "blocked_at": None, "blocked_by": None, "blocked_reason": None,
}


class CollegeSuspendIn(BaseModel):
    reason: str = Field(min_length=1, max_length=450)

    @field_validator("reason", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v


class CollegeReactivateIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


def tpo_accounts(college_id: str) -> List[Dict[str, Any]]:
    try:
        return (
            db_client.table("profiles")
            .select("id, email, name, created_at, onboarded, blocked_permanent, blocked_until, blocked_reason")
            .eq("role", "college").eq("college_id", college_id).order("created_at").execute()
        ).data or []
    except APIError as e:
        log.error("College accounts lookup failed for %s: %s", college_id, e)
        raise HTTPException(status_code=500, detail="Failed to load college accounts.")


def _suspended_by_us(account: Dict[str, Any]) -> bool:
    return is_currently_blocked(account) and (account.get("blocked_reason") or "").startswith(SUSPENSION_PREFIX)


def suspension_state(accounts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """active | suspended | partial | no_accounts — computed from the accounts, never stored."""
    suspended = [a for a in accounts if _suspended_by_us(a)]
    live = [a for a in accounts if not is_currently_blocked(a)]
    if not accounts:
        state = "no_accounts"
    elif suspended and not live:
        state = "suspended"
    elif suspended:
        state = "partial"   # e.g. a TPO account was added after the suspension
    else:
        state = "active"
    return {"state": state, "accounts_total": len(accounts), "accounts_suspended": len(suspended), "accounts_active": len(live)}


def _college(college_id: str) -> Dict[str, Any]:
    try:
        rows = db_client.table("colleges").select("id, name").eq("id", college_id).limit(1).execute().data
    except APIError as e:
        log.error("College lookup failed for %s: %s", college_id, e)
        raise HTTPException(status_code=500, detail="Could not load this college.")
    if not rows:
        raise HTTPException(status_code=404, detail="College not found.")
    return rows[0]


def _actor(admin: Dict[str, Any]) -> Dict[str, Any]:
    return {"actor_user_id": admin["id"], "actor_role": admin["profile_role"], "actor_label": admin["email"]}


def suspend_college(college_id: str, reason: str, admin: Dict[str, Any]) -> Dict[str, Any]:
    college = _college(college_id)
    accounts = tpo_accounts(college_id)
    before = suspension_state(accounts)
    if before["state"] == "no_accounts":
        raise HTTPException(status_code=409, detail="This college has no TPO account to suspend.")
    if before["state"] == "suspended":
        raise HTTPException(status_code=409, detail="This college is already suspended.")
    targets = [a for a in accounts if not is_currently_blocked(a)]
    if not targets:
        raise HTTPException(status_code=409, detail="Every TPO account of this college is already blocked.")

    now = datetime.now(timezone.utc).isoformat()
    done: List[Dict[str, Any]] = []
    try:
        for a in targets:
            updated = update_profile(a["id"], {
                "blocked_permanent": True, "blocked_until": None, "blocked_at": now,
                "blocked_by": admin["id"], "blocked_reason": SUSPENSION_PREFIX + reason,
            })
            if not updated:
                raise RuntimeError(f"profile {a['id']} was not updated")
            done.append(a)
    except Exception:  # noqa: BLE001 — undo what this call already did, so a failure never leaves half a suspension
        log.exception("Suspending college %s failed after %d of %d accounts; rolling back", college_id, len(done), len(targets))
        for a in done:
            try:
                update_profile(a["id"], dict(_UNBLOCKED))
            except Exception:  # noqa: BLE001
                log.exception("Could not roll back the suspension of account %s", a["id"])
        raise HTTPException(
            status_code=500,
            detail="The suspension could not be completed, so it was undone. No account was changed. Please try again.",
        )

    log_event(
        "college_suspended", **_actor(admin), target_type="college", target_id=college_id, target_label=college["name"],
        metadata={"accounts_suspended": len(done), "accounts_already_blocked": len(accounts) - len(done), "reason": reason},
    )
    return {"college_id": college_id, "suspension": suspension_state(tpo_accounts(college_id)), "accounts_suspended": len(done)}


def reactivate_college(college_id: str, reason: str | None, admin: Dict[str, Any]) -> Dict[str, Any]:
    college = _college(college_id)
    accounts = tpo_accounts(college_id)
    before = suspension_state(accounts)
    if before["accounts_suspended"] == 0:
        raise HTTPException(status_code=409, detail="This college is not suspended.")

    restored = 0
    failed = 0
    for a in [a for a in accounts if _suspended_by_us(a)]:
        try:
            if update_profile(a["id"], dict(_UNBLOCKED)):
                restored += 1
            else:
                failed += 1
        except Exception:  # noqa: BLE001 — keep going: every account that CAN be restored should be
            log.exception("Could not reactivate account %s", a["id"])
            failed += 1

    still_blocked = len(accounts) - before["accounts_active"] - restored
    log_event(
        "college_reactivated", **_actor(admin), target_type="college", target_id=college_id, target_label=college["name"],
        result="failure" if failed else "success",
        metadata={"accounts_restored": restored, "accounts_failed": failed, "accounts_left_blocked": still_blocked - failed,
                  "reason": (reason or "").strip() or None},
    )
    if failed:
        raise HTTPException(
            status_code=500,
            detail=f"{restored} of {restored + failed} TPO accounts were reactivated; the rest could not be. "
                   "Reactivate again to finish.",
        )
    return {"college_id": college_id, "suspension": suspension_state(tpo_accounts(college_id)), "accounts_restored": restored,
            "accounts_left_blocked": still_blocked}
