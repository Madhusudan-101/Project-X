"""Admin Reports — /admin/reports/*

Most "reports" the spec asks for are already the CSV export on each entity's
own page (Colleges, Companies, Candidates, Drives, Partnerships, Users, Audit
Log) — this module does not duplicate those; the frontend's Reports page
links to them. Only the three aggregate views with no existing export live
here: a funnel-shaped college export (the Colleges export's own columns,
reshaped, covering ALL colleges rather than registered-only), a compensation
report, and a platform-usage summary. Every download here is logged as
`report_generated`, distinct from the plain `csv_exported` a table page logs.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ...deps import require_admin_role
from ...services.admin.common import DateRange, ExportResult, csv_response, date_range, rpc, rpc_all
from ...services.admin.events import log_event

router = APIRouter(prefix="/admin/reports", tags=["admin-reports"], dependencies=[Depends(require_admin_role)])

_FUNNEL_COLUMNS = [
    ("name", "College"), ("has_account", "Has account"),
    ("applications", "Applications"), ("applicants", "Applicants"),
    ("shortlisted", "Shortlisted"), ("selected", "Selected applications"),
    ("selected_applicants", "Selected candidates"),
]
_CTC_COLUMNS = [
    ("company_name", "Company"),
    ("posted_roles", "Posted roles"), ("posted_average", "Posted average CTC"),
    ("posted_highest", "Posted highest CTC"), ("posted_lowest", "Posted lowest CTC"),
    ("filled_roles", "Filled roles (selected candidates)"), ("filled_average", "Filled average CTC"),
    ("filled_highest", "Filled highest CTC"), ("filled_lowest", "Filled lowest CTC"),
]


def _log_report(admin: dict, report: str, rows: int, total: int, truncated: bool) -> None:
    log_event("report_generated", actor_user_id=admin["id"], actor_role=admin["profile_role"], actor_label=admin["email"],
               target_type=report, metadata={"rows": rows, "total": total, "truncated": truncated})


@router.get("/application-funnel/export")
def export_application_funnel_report(rng: DateRange = Depends(date_range), admin: dict = Depends(require_admin_role)):
    """Every college in the directory (not registered-only — see
    admin_list_colleges' p_registration='all'), so a gap in participation is
    visible rather than hidden by filtering it out."""
    result = rpc_all("admin_list_colleges", {
        **rng.params(), "p_search": None, "p_registration": "all", "p_activity": None,
        "p_college_id": None, "p_sort": "applications", "p_dir": "desc",
    })
    _log_report(admin, "application_funnel", len(result.rows), result.total, result.truncated)
    return csv_response(result, _FUNNEL_COLUMNS, "application_funnel_report.csv")


@router.get("/compensation/export")
def export_compensation_report(rng: DateRange = Depends(date_range), admin: dict = Depends(require_admin_role)):
    rows = rpc("admin_ctc_by_company", rng.params()) or []
    result = ExportResult(rows=rows, total=len(rows), truncated=False)
    _log_report(admin, "compensation", len(rows), len(rows), False)
    return csv_response(result, _CTC_COLUMNS, "compensation_report.csv")


@router.get("/platform-usage")
def platform_usage_report(rng: DateRange = Depends(date_range)):
    return rpc("admin_platform_usage", rng.params())
