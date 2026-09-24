"""Admin college management — /admin/colleges

List / detail / CSV export are read-only aggregates from `admin_list_colleges`.
POST provisions a College account (there is no public College signup).
"""

from __future__ import annotations

import logging
from typing import Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from postgrest.exceptions import APIError

from ...crud import create_college, find_college_id_by_name
from ...deps import db_client, require_admin_role
from ...schemas import CollegeProvisionIn
from ...services.admin.common import (
    DateRange, Page, clean_search, clean_sort, csv_response, date_range, one_of,
    page_params, rpc_all, rpc_one, rpc_page,
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
    try:
        accounts = (
            db_client.table("profiles")
            .select("id, email, name, created_at, onboarded")
            .eq("role", "college").eq("college_id", str(college_id))
            .order("created_at").execute()
        ).data or []
    except APIError as e:
        log.error("College accounts lookup failed for %s: %s", college_id, e)
        raise HTTPException(status_code=500, detail="Failed to load college accounts.")
    return {"college": row, "accounts": accounts}


def _resolve_college(payload: CollegeProvisionIn) -> Tuple[str, bool]:
    """(college_id, created_by_us). Existing colleges are found without being
    written to; a new directory row is created only when none exists."""
    try:
        if payload.college_id:
            college_id = str(payload.college_id)
            found = db_client.table("colleges").select("id").eq("id", college_id).limit(1).execute().data
            if not found:
                raise HTTPException(status_code=404, detail="College not found.")
            return college_id, False
        name = (payload.college_name or "").strip()
        existing = find_college_id_by_name(name)
        if existing:
            return existing, False
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
    college_id, created_college = _resolve_college(payload)
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
