"""Admin drive performance & company↔college partnerships —
/admin/drives · /admin/partnerships (read-only aggregates)."""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from ...deps import require_admin_role
from ...services.admin.common import (
    DateRange, Page, clean_search, clean_sort, csv_response, date_range, one_of,
    page_params, rpc_all, rpc_page,
)

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
):
    return rpc_page("admin_list_drives", _drive_params(rng, search, status, company_id, college_id, sort, dir), page)


@router.get("/drives/export")
def export_drives(
    rng: DateRange = Depends(date_range),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    company_id: Optional[UUID] = Query(None),
    college_id: Optional[UUID] = Query(None),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
):
    result = rpc_all("admin_list_drives", _drive_params(rng, search, status, company_id, college_id, sort, dir))
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
):
    return rpc_page("admin_list_partnerships", _partner_params(rng, search, company_id, college_id, sort, dir), page)


@router.get("/partnerships/export")
def export_partnerships(
    rng: DateRange = Depends(date_range),
    search: Optional[str] = Query(None),
    company_id: Optional[UUID] = Query(None),
    college_id: Optional[UUID] = Query(None),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
):
    result = rpc_all("admin_list_partnerships", _partner_params(rng, search, company_id, college_id, sort, dir))
    return csv_response(result, _PARTNER_COLUMNS, "company_college_partnerships.csv")
