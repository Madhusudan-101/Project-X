"""Admin candidate analytics — /admin/candidates (+ filter options)

Read-only. Exposes only what the College Portal's roster view already
shows an authorised viewer (name, email, college, branch, batch) plus
funnel counts — no scores, CGPA, gender or resume data.
"""

from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from postgrest.exceptions import APIError

from ...deps import db_client, require_admin_role
from ...services.admin.common import (
    DateRange, Page, clean_search, clean_sort, csv_response, date_range, one_of,
    page_params, rpc, rpc_all, rpc_page,
)
from ...services.admin.events import log_event

log = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin-candidates"], dependencies=[Depends(require_admin_role)])

_SORTS = ("name", "college", "applications", "shortlisted", "selected", "registered_at")
_STATUSES = ("not_applied", "applied", "in_process", "rejected", "placed")
_OPTION_LIMIT = 1000
_DRIVE_OPTION_LIMIT = 200

_EXPORT_COLUMNS = [
    ("name", "Name"), ("email", "Email"), ("college_name", "College"), ("branch", "Branch"),
    ("graduation_year", "Graduation year"), ("registered_at", "Registered"),
    ("applications", "Applications (period)"), ("shortlisted", "Shortlisted (period)"),
    ("selected", "Selected (period)"), ("placement_status", "Placement status"),
]


def _list_params(
    rng: DateRange, search: Optional[str], college_id: Optional[UUID], company_id: Optional[UUID],
    drive_id: Optional[UUID], status: Optional[str], registered_in_range: bool,
    sort: Optional[str], direction: str,
) -> dict:
    key, direction = clean_sort(sort, direction, _SORTS, "registered_at")
    return {
        **rng.params(),
        "p_search": clean_search(search),
        "p_college_id": str(college_id) if college_id else None,
        "p_company_id": str(company_id) if company_id else None,
        "p_drive_id": str(drive_id) if drive_id else None,
        "p_status": one_of(status, _STATUSES, "status"),
        "p_registered_in_range": registered_in_range,
        "p_sort": key,
        "p_dir": direction,
    }


@router.get("/candidates")
def list_candidates(
    rng: DateRange = Depends(date_range),
    page: Page = Depends(page_params),
    search: Optional[str] = Query(None),
    college_id: Optional[UUID] = Query(None),
    company_id: Optional[UUID] = Query(None),
    drive_id: Optional[UUID] = Query(None),
    status: Optional[str] = Query(None),
    registered_in_range: bool = Query(False),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
):
    params = _list_params(rng, search, college_id, company_id, drive_id, status, registered_in_range, sort, dir)
    return rpc_page("admin_list_candidates", params, page)


@router.get("/candidates/export")
def export_candidates(
    rng: DateRange = Depends(date_range),
    search: Optional[str] = Query(None),
    college_id: Optional[UUID] = Query(None),
    company_id: Optional[UUID] = Query(None),
    drive_id: Optional[UUID] = Query(None),
    status: Optional[str] = Query(None),
    registered_in_range: bool = Query(False),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
    admin: dict = Depends(require_admin_role),
):
    params = _list_params(rng, search, college_id, company_id, drive_id, status, registered_in_range, sort, dir)
    result = rpc_all("admin_list_candidates", params)
    log_event("csv_exported", actor_user_id=admin["id"], actor_role=admin["profile_role"], actor_label=admin["email"],
              target_type="candidates", metadata={"rows": len(result.rows), "total": result.total, "truncated": result.truncated})
    return csv_response(result, _EXPORT_COLUMNS, "candidates.csv")


@router.get("/options")
def filter_options():
    """Id/label lists for the admin filter dropdowns (colleges, companies,
    recent drives). Capped — a search box takes over if these outgrow a select."""
    try:
        colleges = db_client.table("colleges").select("id, name").order("name").limit(_OPTION_LIMIT).execute().data or []
        companies = db_client.table("companies").select("id, name").order("name").limit(_OPTION_LIMIT).execute().data or []
    except APIError as e:
        log.error("Admin filter options failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to load filter options.")
    drives = rpc("admin_list_drives", {
        "p_from": None, "p_to": None, "p_search": None, "p_status": None,
        "p_company_id": None, "p_college_id": None,
        "p_sort": "created_at", "p_dir": "desc", "p_limit": _DRIVE_OPTION_LIMIT, "p_offset": 0,
    }) or []
    return {
        "colleges": colleges,
        "companies": companies,
        "drives": [
            {"id": d["drive_id"], "label": f'{d["job_title"]} · {d["company_name"]} · {d["college_name"]}'}
            for d in drives
        ],
    }
