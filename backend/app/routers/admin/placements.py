"""Admin drive performance & company↔college partnerships —
/admin/drives · /admin/partnerships (read-only aggregates)."""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from ...deps import require_admin_role
from ...services.admin.common import (
    DateRange, Page, clean_search, clean_sort, csv_response, date_range, one_of,
    page_params, rpc, rpc_all, rpc_page,
)
from ...services.admin.events import log_event
from ...services.admin.permissions import require_permission, scope_college_ids, scope_company_ids

router = APIRouter(prefix="/admin", tags=["admin-placements"], dependencies=[Depends(require_admin_role)])

_DRIVE_SORTS = ("job", "company", "college", "applications", "applicants", "shortlisted",
                "selected", "created_at", "apply_deadline")
_DRIVE_STATUSES = ("draft", "live", "closed")
_PARTNER_SORTS = ("company", "college", "drives", "applications", "shortlisted", "selected", "last_drive_at")

_DRIVE_COLUMNS = [
    ("job_title", "Role"), ("company_name", "Company"), ("college_name", "College"), ("status", "Status"),
    ("is_on_campus", "On campus"), ("employment_type", "Employment type"), ("apply_deadline", "Apply deadline"),
    ("created_at", "Created"), ("applications", "Applications (period)"), ("applicants", "Applicants (period)"),
    ("shortlisted", "Shortlisted (period)"), ("selected", "Selected (period)"),
]
_PARTNER_COLUMNS = [
    ("company_name", "Company"), ("college_name", "College"), ("drives", "Drives"),
    ("first_drive_at", "First drive"), ("last_drive_at", "Latest drive"),
    ("applications", "Applications (period)"), ("applicants", "Applicants (period)"),
    ("shortlisted", "Shortlisted (period)"), ("selected", "Selected (period)"),
]


def _drive_params(
    rng: DateRange, search: Optional[str], status: Optional[str], company_id: Optional[UUID],
    college_id: Optional[UUID], sort: Optional[str], direction: str,
) -> dict:
    key, direction = clean_sort(sort, direction, _DRIVE_SORTS, "applications")
    return {
        **rng.params(),
        "p_search": clean_search(search),
        "p_status": one_of(status, _DRIVE_STATUSES, "status"),
        "p_company_id": str(company_id) if company_id else None,
        "p_college_id": str(college_id) if college_id else None,
        "p_sort": key,
        "p_dir": direction,
    }


def _partner_params(
    rng: DateRange, search: Optional[str], company_id: Optional[UUID],
    college_id: Optional[UUID], sort: Optional[str], direction: str,
) -> dict:
    key, direction = clean_sort(sort, direction, _PARTNER_SORTS, "applications")
    return {
        **rng.params(),
        "p_search": clean_search(search),
        "p_company_id": str(company_id) if company_id else None,
        "p_college_id": str(college_id) if college_id else None,
        "p_sort": key,
        "p_dir": direction,
    }


def _apply_scope(params: dict, admin: dict) -> dict:
    college_ids = scope_college_ids(admin)
    company_ids = scope_company_ids(admin)
    if college_ids:
        params["p_college_ids"] = college_ids
    if company_ids:
        params["p_company_ids"] = company_ids
    return params


@router.get("/drives")
def list_drives(
    rng: DateRange = Depends(date_range),
    page: Page = Depends(page_params),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    company_id: Optional[UUID] = Query(None),
    college_id: Optional[UUID] = Query(None),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
    admin: dict = Depends(require_permission("drives.view")),
):
    params = _apply_scope(_drive_params(rng, search, status, company_id, college_id, sort, dir), admin)
    return rpc_page("admin_list_drives", params, page)


@router.get("/drives/export")
def export_drives(
    rng: DateRange = Depends(date_range),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    company_id: Optional[UUID] = Query(None),
    college_id: Optional[UUID] = Query(None),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
    admin: dict = Depends(require_permission("drives.export")),
):
    params = _apply_scope(_drive_params(rng, search, status, company_id, college_id, sort, dir), admin)
    result = rpc_all("admin_list_drives", params)
    log_event("csv_exported", actor_user_id=admin["id"], actor_role=admin["profile_role"], actor_label=admin["email"],
              target_type="drives", metadata={"rows": len(result.rows), "total": result.total, "truncated": result.truncated})
    return csv_response(result, _DRIVE_COLUMNS, "drives.csv")


@router.get("/partnerships")
def list_partnerships(
    rng: DateRange = Depends(date_range),
    page: Page = Depends(page_params),
    search: Optional[str] = Query(None),
    company_id: Optional[UUID] = Query(None),
    college_id: Optional[UUID] = Query(None),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
    admin: dict = Depends(require_permission("partnerships.view")),
):
    params = _apply_scope(_partner_params(rng, search, company_id, college_id, sort, dir), admin)
    return rpc_page("admin_list_partnerships", params, page)


@router.get("/partnerships/export")
def export_partnerships(
    rng: DateRange = Depends(date_range),
    search: Optional[str] = Query(None),
    company_id: Optional[UUID] = Query(None),
    college_id: Optional[UUID] = Query(None),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
    admin: dict = Depends(require_permission("partnerships.export")),
):
    params = _apply_scope(_partner_params(rng, search, company_id, college_id, sort, dir), admin)
    result = rpc_all("admin_list_partnerships", params)
    log_event("csv_exported", actor_user_id=admin["id"], actor_role=admin["profile_role"], actor_label=admin["email"],
              target_type="partnerships", metadata={"rows": len(result.rows), "total": result.total, "truncated": result.truncated})
    return csv_response(result, _PARTNER_COLUMNS, "company_college_partnerships.csv")


@router.get("/ctc-by-company")
def ctc_by_company(rng: DateRange = Depends(date_range), admin: dict = Depends(require_permission("analytics.view"))):
    """Advertised (posted) vs actual-offer (filled) CTC per company — see
    admin_ctc_stats for the same advertised-vs-actual distinction platform-wide."""
    return {"items": rpc("admin_ctc_by_company", rng.params()) or []}
