"""Admin Department analytics — /admin/departments

Candidates grouped by the RAW branch text they entered, optionally scoped to
one college. See admin_department_breakdown() for why this is not resolved
through the College Portal's branch-alias table or joined to
public.departments (a college-scoped roster concept with no platform-wide
analogue) — both documented limitations, not oversights.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from ...deps import require_admin_role
from ...services.admin.common import DateRange, date_range, rpc
from ...services.admin.permissions import require_permission

router = APIRouter(prefix="/admin/departments", tags=["admin-departments"], dependencies=[Depends(require_admin_role)])


@router.get("")
def department_breakdown(
    rng: DateRange = Depends(date_range), college_id: Optional[UUID] = Query(None),
    admin: dict = Depends(require_permission("analytics.view")),
):
    rows = rpc("admin_department_breakdown", {**rng.params(), "p_college_id": str(college_id) if college_id else None}) or []
    return {"items": rows}
