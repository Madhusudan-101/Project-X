"""Company drives router — /api/drives"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from supabase import Client

from ..deps import get_current_tpo, get_user_supabase
from ..schemas import DriveIn
from ..utils.branch import branch_matches

router = APIRouter(prefix="/api/drives", tags=["drives"])


def _drive_to_out(row: dict) -> dict:
    return {
        "id": row["id"],
        "companyName": row["company_name"],
        "role": row["role"],
        "eligibility": row.get("eligibility") or {},
        "date": row["drive_date"],
        "status": row["status"],
    }


@router.get("/")
def list_drives(
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    try:
        res = sb.table("company_drives").select("*").eq(
            "college_id", tpo["college_id"]
        ).order("drive_date", desc=False).execute()
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)
    return [_drive_to_out(r) for r in (res.data or [])]


@router.post("/", status_code=201)
def create_drive(
    payload: DriveIn,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    # Normalise eligibility.branch to always be a list for downstream consumers.
    elig = payload.eligibility.model_dump(exclude_none=True)
    if isinstance(elig.get("branch"), str):
        elig["branch"] = [elig["branch"]]

    insert = {
        "college_id": tpo["college_id"],
        "company_name": payload.companyName,
        "role": payload.role,
        "eligibility": elig,
        "drive_date": payload.date.isoformat(),
        "status": payload.status,
    }
    try:
        res = sb.table("company_drives").insert(insert).execute()
    except APIError as e:
        raise HTTPException(status_code=400, detail=e.message)

    row = (res.data or [None])[0]
    if not row:
        raise HTTPException(status_code=500, detail="Insert returned no row")
    return {"message": "Company drive created successfully", "drive": _drive_to_out(row)}


@router.get("/{drive_id}/eligible")
def eligible_students(
    drive_id: str,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    try:
        drive_res = (
            sb.table("company_drives")
            .select("*")
            .eq("college_id", tpo["college_id"])
            .eq("id", drive_id)
            .single()
            .execute()
        )
    except APIError as e:
        if e.code == "PGRST116":
            raise HTTPException(status_code=404, detail="Drive not found")
        raise HTTPException(status_code=500, detail=e.message)

    drive = drive_res.data
    eligibility = drive.get("eligibility") or {}

    q = sb.table("students").select("*").eq("college_id", tpo["college_id"])
    if (gy := eligibility.get("graduationYear")) is not None:
        q = q.eq("graduation_year", int(gy))
    if (ms := eligibility.get("minimumScore")) is not None:
        q = q.gte("employability_score", float(ms))
    try:
        student_rows = q.execute().data or []
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)

    allowed_branches = eligibility.get("branch")
    if allowed_branches:
        if isinstance(allowed_branches, str):
            allowed_branches = [allowed_branches]
        student_rows = [
            s for s in student_rows if branch_matches(s.get("branch"), allowed_branches)
        ]

    return {"drive": _drive_to_out(drive), "eligibleStudents": student_rows}
