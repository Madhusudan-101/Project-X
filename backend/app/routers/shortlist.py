"""Shortlist router — /api/shortlist"""

from __future__ import annotations

import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from postgrest.exceptions import APIError
from supabase import Client

from ..deps import get_current_tpo, get_user_supabase
from ..schemas import ShortlistFilterIn
from ..utils.branch import normalize_branch

router = APIRouter(prefix="/api/shortlist", tags=["shortlist"])

_EXPORT_FIELDS = [
    ("name", "name"),
    ("email", "email"),
    ("branch", "branch"),
    ("graduation_year", "graduationYear"),
    ("employability_score", "employabilityScore"),
    ("verification_status", "verificationStatus"),
]


def _apply_filters(sb: Client, college_id: str, filters: ShortlistFilterIn) -> list[dict]:
    q = sb.table("students").select("*").eq("college_id", college_id)
    if filters.graduationYear is not None:
        q = q.eq("graduation_year", filters.graduationYear)
    if filters.minimumScore is not None:
        q = q.gte("employability_score", filters.minimumScore)
    if filters.verificationStatus is not None:
        q = q.eq("verification_status", filters.verificationStatus.lower())
    try:
        rows = q.execute().data or []
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)

    if filters.branch:
        needle = normalize_branch(filters.branch)
        if needle:
            rows = [r for r in rows if needle in normalize_branch(r.get("branch"))]
    return rows


@router.post("/filter")
def filter_shortlist(
    payload: ShortlistFilterIn,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    rows = _apply_filters(sb, tpo["college_id"], payload)
    return {"total": len(rows), "students": rows}


@router.get("/export")
def export_shortlist_csv(
    branch: Optional[str] = Query(None),
    graduationYear: Optional[int] = Query(None),
    minimumScore: Optional[float] = Query(None),
    verificationStatus: Optional[str] = Query(None),
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    payload = ShortlistFilterIn(
        branch=branch,
        graduationYear=graduationYear,
        minimumScore=minimumScore,
        verificationStatus=verificationStatus,
    )
    rows = _apply_filters(sb, tpo["college_id"], payload)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([out for _, out in _EXPORT_FIELDS])
    for r in rows:
        writer.writerow([r.get(src, "") for src, _ in _EXPORT_FIELDS])
    buf.seek(0)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="shortlisted_students.csv"'},
    )
