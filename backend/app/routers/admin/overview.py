"""Admin overview & placement analytics — /admin/overview · trends · activity · placements

Counts come from `admin_*` SQL functions; this module only derives ratios
(N/A — None — when the denominator is zero, never a fake 0%) and shapes the
response. Every /admin route is protected by the router-level
`require_admin_role` dependency.
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, Query

from ...deps import require_admin_role
from ...services.admin.common import DateRange, date_range, ratio, rpc

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin_role)])


def _range_out(rng: DateRange) -> Dict[str, Any]:
    return {"from": rng.start.isoformat() if rng.start else None,
            "to": rng.end.isoformat() if rng.end else None}


def _derived(totals: Dict[str, Any], period: Dict[str, Any]) -> Dict[str, Any]:
    return {
        # distinct candidates selected / distinct candidates who applied
        "placement_rate": ratio(period["selected_applicants"], period["applicants"]),
        "shortlist_rate": ratio(period["shortlisted"], period["applications"]),
        "applications_per_applicant": ratio(period["applications"], period["applicants"], 2),
        # per drive that received at least one application in the period
        "applications_per_drive": ratio(period["applications"], period["drives_with_applications"], 2),
        "college_participation": ratio(totals["colleges_with_drives"], totals["colleges"]),
        "company_participation": ratio(totals["companies_with_drives"], totals["companies"]),
    }


@router.get("/overview")
def platform_overview(rng: DateRange = Depends(date_range)):
    raw = rpc("admin_overview", rng.params())
    return {
        "range": _range_out(rng),
        "totals": raw["totals"],
        "period": raw["period"],
        "derived": _derived(raw["totals"], raw["period"]),
    }


@router.get("/trends")
def platform_trends(
    rng: DateRange = Depends(date_range),
    tz: str = Query("UTC", max_length=64, description="IANA time zone used to bucket days"),
):
    points = rpc("admin_trends", {**rng.params(), "p_bucket": rng.bucket, "p_tz": tz}) or []
    return {"bucket": rng.bucket, "points": points}


@router.get("/activity")
def recent_activity(limit: int = Query(20, ge=1, le=50)):
    return {"items": rpc("admin_activity", {"p_limit": limit}) or []}


@router.get("/placements")
def placement_summary(rng: DateRange = Depends(date_range)):
    """Funnel, drive status mix and CTC statistics. Drive-, college- and
    company-level breakdowns come from their own paged endpoints."""
    raw = rpc("admin_overview", rng.params())
    totals, period = raw["totals"], raw["period"]
    return {
        "range": _range_out(rng),
        "drives": {
            "total": totals["drives"],
            "live": totals["drives_live"],
            "draft": totals["drives_draft"],
            "closed": totals["drives_closed"],
            "created_in_period": period["drives_created"],
        },
        "funnel": {
            "applications": period["applications"],
            "applicants": period["applicants"],
            "shortlisted": period["shortlisted"],
            "selected": period["selected"],
            "selected_applicants": period["selected_applicants"],
            **{k: v for k, v in _derived(totals, period).items()
               if k in ("placement_rate", "shortlist_rate", "applications_per_drive")},
        },
        "ctc": rpc("admin_ctc_stats", rng.params()),
    }
