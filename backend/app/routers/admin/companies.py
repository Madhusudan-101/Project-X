"""Admin company analytics — /admin/companies (read-only aggregates)."""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from ...deps import require_admin_role
from ...services.admin.common import (
    DateRange, Page, clean_search, clean_sort, csv_response, date_range, one_of,
    page_params, rpc_all, rpc_one, rpc_page,
)
from ...services.admin.events import log_event
from ...services.admin.permissions import require_permission, scope_company_ids

router = APIRouter(prefix="/admin/companies", tags=["admin-companies"], dependencies=[Depends(require_admin_role)])

_SORTS = ("name", "industry", "jobs", "drives", "colleges", "applications",
          "shortlisted", "selected", "registered_at", "last_activity")
_ACTIVITY = ("active", "inactive")

_EXPORT_COLUMNS = [
    ("name", "Company"), ("industry", "Industry"), ("size", "Size"), ("is_verified", "Verified"),
    ("owner_email", "Owner email"), ("registered_at", "Registered"), ("jobs", "Jobs"),
    ("drives", "Drives"), ("colleges", "Colleges"), ("applications", "Applications (period)"),
    ("applicants", "Applicants (period)"), ("shortlisted", "Shortlisted (period)"),
    ("selected", "Selected (period)"), ("last_activity", "Last activity"), ("is_active", "Active in period"),
]


def _list_params(
    rng: DateRange, search: Optional[str], activity: Optional[str],
    verified: Optional[bool], sort: Optional[str], direction: str,
) -> dict:
    key, direction = clean_sort(sort, direction, _SORTS, "applications")
    return {
        **rng.params(),
        "p_search": clean_search(search),
        "p_activity": one_of(activity, _ACTIVITY, "activity"),
        "p_verified": verified,
        "p_company_id": None,
        "p_sort": key,
        "p_dir": direction,
    }


@router.get("")
def list_companies(
    rng: DateRange = Depends(date_range),
    page: Page = Depends(page_params),
    search: Optional[str] = Query(None),
    activity: Optional[str] = Query(None),
    verified: Optional[bool] = Query(None),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
    admin: dict = Depends(require_permission("companies.view")),
):
    params = _list_params(rng, search, activity, verified, sort, dir)
    scoped = scope_company_ids(admin)
    if scoped:
        params["p_company_ids"] = scoped
    return rpc_page("admin_list_companies", params, page)


@router.get("/export")
def export_companies(
    rng: DateRange = Depends(date_range),
    search: Optional[str] = Query(None),
    activity: Optional[str] = Query(None),
    verified: Optional[bool] = Query(None),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
    admin: dict = Depends(require_permission("companies.export")),
):
    params = _list_params(rng, search, activity, verified, sort, dir)
    scoped = scope_company_ids(admin)
    if scoped:
        params["p_company_ids"] = scoped
    result = rpc_all("admin_list_companies", params)
    log_event("csv_exported", actor_user_id=admin["id"], actor_role=admin["profile_role"], actor_label=admin["email"],
              target_type="companies", metadata={"rows": len(result.rows), "total": result.total, "truncated": result.truncated})
    return csv_response(result, _EXPORT_COLUMNS, "companies.csv")


# Registered after /export so "export" is never captured as a company id.
@router.get("/{company_id}")
def company_detail(
    company_id: UUID, rng: DateRange = Depends(date_range),
    admin: dict = Depends(require_permission("companies.view", scope_param="company_id")),
):
    row = rpc_one("admin_list_companies", {
        **rng.params(), "p_search": None, "p_activity": None, "p_verified": None,
        "p_company_id": str(company_id), "p_sort": "name", "p_dir": "asc",
    })
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")
    return {"company": row}
