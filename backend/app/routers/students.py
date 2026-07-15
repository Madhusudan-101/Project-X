"""Students router — /api/students

Ports collage_backend/routes/studentRoutes.js to FastAPI + Supabase.
Every query is scoped by the TPO's college_id AND runs through an RLS-bound
client, so cross-college access is refused at two layers.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from postgrest.exceptions import APIError
from supabase import Client

from ..deps import get_current_tpo, get_user_supabase
from ..utils.branch import normalize_branch
from ..utils.csv_students import parse_students_csv, dedupe_by_email

router = APIRouter(prefix="/api/students", tags=["students"])

MAX_CSV_BYTES = 5 * 1024 * 1024  # 5 MB


@router.get("/")
def list_students(
    branch: Optional[str] = Query(None),
    graduationYear: Optional[int] = Query(None),
    minimumScore: Optional[float] = Query(None),
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    q = sb.table("students").select("*").eq("college_id", tpo["college_id"])
    if graduationYear is not None:
        q = q.eq("graduation_year", graduationYear)
    if minimumScore is not None:
        q = q.gte("employability_score", minimumScore)
    try:
        rows = q.execute().data or []
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)

    if branch:
        needle = normalize_branch(branch)
        rows = [r for r in rows if needle and needle in normalize_branch(r.get("branch"))]
    return rows


@router.get("/{student_id}")
def get_student(
    student_id: str,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    try:
        res = (
            sb.table("students")
            .select("*")
            .eq("college_id", tpo["college_id"])
            .eq("id", student_id)
            .single()
            .execute()
        )
    except APIError as e:
        if e.code == "PGRST116":
            raise HTTPException(status_code=404, detail="Student not found")
        raise HTTPException(status_code=500, detail=e.message)
    return res.data


@router.post("/upload", status_code=201)
async def upload_students_csv(
    file: UploadFile = File(...),
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    raw = await file.read()
    if len(raw) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="CSV too large (max 5 MB)")

    parsed, invalid = parse_students_csv(raw)
    if invalid:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "CSV file has missing or invalid required fields",
                "requiredFields": ["name", "email", "branch", "graduationYear"],
                "invalidRows": invalid[:20],
            },
        )
    if not parsed:
        raise HTTPException(status_code=400, detail="CSV contained no rows")

    parsed = dedupe_by_email(parsed)
    for row in parsed:
        row["college_id"] = tpo["college_id"]

    try:
        res = (
            sb.table("students")
            .upsert(parsed, on_conflict="college_id,email")
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=400, detail=f"Insert failed: {e.message}")

    added = res.data or []
    return {
        "message": "Students uploaded successfully",
        "addedStudents": len(added),
        "students": added,
    }
