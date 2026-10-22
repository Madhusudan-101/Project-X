"""Admin college management — /admin/colleges

List / detail / CSV export are read-only aggregates from `admin_list_colleges`.
POST provisions a College account (there is no public College signup).
"""

from __future__ import annotations

import logging
from typing import List, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from postgrest.exceptions import APIError

from ...crud import create_college, find_college_id_by_name
from ...deps import db_client, is_currently_blocked, require_admin_role
from ...schemas import CollegeProvisionIn
from ...services.admin.common import (
    DateRange, Page, clean_search, clean_sort, csv_response, date_range, one_of,
    page_params, rpc_all, rpc_one, rpc_page,
)
from ...services.admin.college_lifecycle import (
    CollegeReactivateIn, CollegeSuspendIn, reactivate_college, suspend_college, suspension_state, tpo_accounts,
)
from ...services.admin.events import log_event
from ...services.admin.permissions import require_permission, scope_college_ids
from ...services.admin.provisioning import provision_account

log = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/colleges", tags=["admin-colleges"], dependencies=[Depends(require_admin_role)])

_SORTS = ("name", "city", "candidates", "drives", "companies", "applications",
          "shortlisted", "selected", "placement_rate", "registered_at", "last_activity")
_REGISTRATION = ("registered", "directory", "all")
_ACTIVITY = ("active", "inactive")

# Two separate datasets, labelled as such: the platform pipeline (candidates who
# signed up, companies' drives, applications) vs what the college's own TPO
# entered in the College Portal (roster, campus drives).
_EXPORT_COLUMNS = [
    ("name", "College"), ("city", "City"), ("state", "State"), ("has_account", "Has account"),
    ("registered_at", "Registered"),
    ("candidates", "Candidates on Platform"), ("companies", "Companies (platform)"),
    ("drives", "Company drives (platform)"), ("applications", "Applications (period)"),
    ("applicants", "Applicants (period)"), ("shortlisted", "Shortlisted (period)"),
    ("selected", "Selected applications (period)"), ("selected_applicants", "Selected candidates (period)"),
    ("roster_students", "College roster students"), ("roster_placed", "College roster placed (TPO-marked)"),
    ("portal_drives", "College Portal campus drives"),
    ("last_activity", "Last activity"), ("is_active", "Active in period"),
]


def _list_params(
    rng: DateRange,
    search: Optional[str], registration: str, activity: Optional[str], sort: Optional[str], direction: str,
) -> dict:
    key, direction = clean_sort(sort, direction, _SORTS, "applications")
    return {
        **rng.params(),
        "p_search": clean_search(search),
        "p_registration": one_of(registration, _REGISTRATION, "registration") or "registered",
        "p_activity": one_of(activity, _ACTIVITY, "activity"),
        "p_college_id": None,
        "p_sort": key,
        "p_dir": direction,
    }


@router.get("")
def list_colleges(
    rng: DateRange = Depends(date_range),
    page: Page = Depends(page_params),
    search: Optional[str] = Query(None),
    registration: str = Query("registered"),
    activity: Optional[str] = Query(None),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
    admin: dict = Depends(require_permission("colleges.view")),
):
    params = _list_params(rng, search, registration, activity, sort, dir)
    scoped = scope_college_ids(admin)
    if scoped:
        params["p_college_ids"] = scoped
    return rpc_page("admin_list_colleges", params, page)


@router.get("/export")
def export_colleges(
    rng: DateRange = Depends(date_range),
    search: Optional[str] = Query(None),
    registration: str = Query("registered"),
    activity: Optional[str] = Query(None),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
    admin: dict = Depends(require_permission("colleges.export")),
):
    params = _list_params(rng, search, registration, activity, sort, dir)
    scoped = scope_college_ids(admin)
    if scoped:
        params["p_college_ids"] = scoped
    result = rpc_all("admin_list_colleges", params)
    log_event("csv_exported", actor_user_id=admin["id"], actor_role=admin["profile_role"], actor_label=admin["email"],
              target_type="colleges", metadata={"rows": len(result.rows), "total": result.total, "truncated": result.truncated})
    return csv_response(result, _EXPORT_COLUMNS, "colleges.csv")


# Registered after /export so "export" is never captured as a college id.
@router.get("/{college_id}")
def college_detail(
    college_id: UUID, rng: DateRange = Depends(date_range),
    admin: dict = Depends(require_permission("colleges.view", scope_param="college_id")),
):
    row = rpc_one("admin_list_colleges", {
        **rng.params(), "p_search": None, "p_registration": "all", "p_activity": None,
        "p_college_id": str(college_id), "p_sort": "name", "p_dir": "asc",
    })
    if not row:
        raise HTTPException(status_code=404, detail="College not found.")
    accounts = tpo_accounts(str(college_id))
    try:
        profile = db_client.table("colleges").select("onboarding_completed").eq("id", str(college_id)).limit(1).execute().data
        onboarding_completed = bool(profile[0].get("onboarding_completed")) if profile else None
    except APIError:
        onboarding_completed = None  # the onboarding migration is not applied on this project: say "unknown", not "no"
    return {
        "college": row,
        "accounts": [
            {**{k: a.get(k) for k in ("id", "email", "name", "created_at", "onboarded")},
             "is_blocked": is_currently_blocked(a), "blocked_reason": a.get("blocked_reason") if is_currently_blocked(a) else None}
            for a in accounts
        ],
        "suspension": suspension_state(accounts),
        "onboarding_completed": onboarding_completed,
    }


@router.post("/{college_id}/suspend")
def suspend(
    college_id: UUID, payload: CollegeSuspendIn,
    admin: dict = Depends(require_permission("colleges.suspend", scope_param="college_id")),
):
    """Block every TPO account of the college (see services/admin/college_lifecycle.py for exactly what
    that does and does not do). 409 when it is already suspended or has no TPO account."""
    return suspend_college(str(college_id), payload.reason, admin)


@router.post("/{college_id}/reactivate")
def reactivate(
    college_id: UUID, payload: CollegeReactivateIn,
    admin: dict = Depends(require_permission("colleges.suspend", scope_param="college_id")),
):
    """Restore the TPO accounts that a suspension blocked — and only those. 409 when not suspended."""
    return reactivate_college(str(college_id), payload.reason, admin)


def _resolve_college(payload: CollegeProvisionIn, allowed_ids: Optional[List[str]] = None) -> Tuple[str, bool]:
    """(college_id, created_by_us). Existing colleges are found without being
    written to; a new directory row is created only when none exists.

    `allowed_ids` is the caller's college scope (None = unrestricted). A scoped
    admin may only attach a TPO to a college inside that scope and may not
    create new colleges — checked on the RESOLVED id, so passing a different
    college's name instead of its id gets no way around it."""
    scope_error = HTTPException(status_code=403, detail="Missing permission: colleges.create for this college")
    try:
        if payload.college_id:
            college_id = str(payload.college_id)
            if allowed_ids is not None and college_id not in allowed_ids:
                raise scope_error
            found = db_client.table("colleges").select("id").eq("id", college_id).limit(1).execute().data
            if not found:
                raise HTTPException(status_code=404, detail="College not found.")
            return college_id, False
        name = (payload.college_name or "").strip()
        existing = find_college_id_by_name(name)
        if existing:
            if allowed_ids is not None and str(existing) not in allowed_ids:
                raise scope_error
            return existing, False
        if allowed_ids is not None:
            raise scope_error  # a scoped admin cannot create new colleges
        created = create_college(name)
        if not created:
            raise HTTPException(status_code=502, detail="Could not create the college record.")
        return created, True
    except APIError as e:
        log.error("College lookup/create failed: %s", e)
        raise HTTPException(status_code=502, detail="Could not create the college record.")


def _discard_college(college_id: str) -> None:
    """Undo a directory row we created for an account that then failed to create."""
    try:
        db_client.table("colleges").delete().eq("id", college_id).execute()
    except APIError as e:
        log.warning("Could not discard college %s after a failed provisioning: %s", college_id, e)


def _fill_college_details(college_id: str, payload: CollegeProvisionIn) -> None:
    """Fill BLANK directory fields (city / state / type) from the form — never
    overwrite what the directory already holds. Best-effort: the account exists
    by now, so a failure here is logged, not surfaced."""
    wanted = {k: v.strip() for k, v in
              (("city", payload.city), ("state", payload.state), ("type", payload.type)) if v and v.strip()}
    if not wanted:
        return
    try:
        rows = db_client.table("colleges").select("city, state, type").eq("id", college_id).limit(1).execute().data
        current = rows[0] if rows else {}
        patch = {k: v for k, v in wanted.items() if not (current.get(k) or "").strip()}
        if patch:
            db_client.table("colleges").update(patch).eq("id", college_id).execute()
    except APIError as e:
        log.warning("Could not save directory details for college %s: %s", college_id, e)


@router.post("", status_code=201)
def provision_college(payload: CollegeProvisionIn, admin: dict = Depends(require_permission("colleges.create"))):
    """Create a College account and link it to its college.

    Order matters: the account is created BEFORE any college details are
    written, and a college row created only for this request is removed again
    if the account cannot be created, so a failure leaves nothing half-done.
    """
    college_id, created_college = _resolve_college(payload, scope_college_ids(admin))
    try:
        result = provision_account(
            email=payload.email, role="college",
            first_name=payload.first_name.strip(), last_name=payload.last_name.strip(),
            college_id=college_id, actor=admin,
        )
    except Exception:
        if created_college:
            _discard_college(college_id)
        raise
    _fill_college_details(college_id, payload)
    return {"college_id": college_id, **result}
