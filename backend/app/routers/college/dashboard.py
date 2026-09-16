"""Dashboard router — /api/dashboard"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from supabase import Client

from ...deps import get_current_tpo, get_user_supabase

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats")
def dashboard_stats(
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    college_id = tpo["college_id"]
    try:
        students = (
            sb.table("students")
            .select("employability_score, verification_status, placement_status")
            .eq("college_id", college_id)
            .execute()
        ).data or []

        drives = (
            sb.table("company_drives")
            .select("status")
            .eq("college_id", college_id)
            .execute()
        ).data or []
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)

    total = len(students)
    total_score = sum(float(s.get("employability_score") or 0) for s in students)
    avg = round(total_score / total, 2) if total else 0.0
    verified = sum(
        1 for s in students
        if (s.get("verification_status") or "").lower() == "verified"
    )
    placed = sum(1 for s in students if (s.get("placement_status") or "") == "placed")
    not_placed = sum(1 for s in students if (s.get("placement_status") or "") == "not_placed")
    offer_declined = sum(
        1 for s in students if (s.get("placement_status") or "") == "offer_declined"
    )
    placement_percentage = round((placed / total) * 100, 1) if total else 0.0

    active_drives = sum(1 for d in drives if d.get("status") == "Active")
    draft_drives = sum(1 for d in drives if d.get("status") == "Draft")
    closed_drives = sum(1 for d in drives if d.get("status") == "Closed")

    return {
        "totalStudents": total,
        "averageEmployabilityScore": avg,
        "activeCompanyDrives": active_drives,
        "totalDrives": len(drives),
        "draftDrives": draft_drives,
        "closedDrives": closed_drives,
        "verifiedStudents": verified,
        "placedStudents": placed,
        "notPlacedStudents": not_placed,
        "offerDeclinedStudents": offer_declined,
        "placementPercentage": placement_percentage,
    }


@router.get("/score-distribution")
def score_distribution(
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    try:
        students = (
            sb.table("students")
            .select("employability_score")
            .eq("college_id", tpo["college_id"])
            .execute()
        ).data or []
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)

    # Buckets are half-open [lo, hi) with the top bucket closed on both ends.
    buckets = {"0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80-100": 0}
    for s in students:
        score = float(s.get("employability_score") or 0)
        if score < 20:
            buckets["0-20"] += 1
        elif score < 40:
            buckets["20-40"] += 1
        elif score < 60:
            buckets["40-60"] += 1
        elif score < 80:
            buckets["60-80"] += 1
        else:
            buckets["80-100"] += 1
    return buckets
