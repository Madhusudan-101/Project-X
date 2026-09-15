"""Students router — /api/students

Ports collage_backend/routes/studentRoutes.js to FastAPI + Supabase.
Every query is scoped by the TPO's college_id AND runs through an RLS-bound
client, so cross-college access is refused at two layers.
"""

from __future__ import annotations

import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from postgrest.exceptions import APIError
from supabase import Client

from ...deps import get_current_tpo, get_user_supabase
from ...schemas import StudentIn, StudentUpdateIn
from ...utils.college.branch import normalize_branch
from ...utils.college.csv_students import parse_students_csv, dedupe_by_email

router = APIRouter(prefix="/api/students", tags=["students"])

MAX_CSV_BYTES = 5 * 1024 * 1024  # 5 MB

# Mirrors the column set parse_students_csv() accepts on upload, so a full
# roster export can be re-uploaded unchanged (round-trip). Kept local to this
# router, same as shortlist.py's own _EXPORT_FIELDS — that one exports a
# smaller, recruiter-facing subset for a filtered shortlist; this one exports
# every column for the TPO's own record-keeping / bulk-edit-then-reupload use.
_EXPORT_FIELDS = [
    ("name", "name"),
    ("email", "email"),
    ("branch", "branch"),
    ("graduation_year", "graduationYear"),
    ("employability_score", "employabilityScore"),
    ("resume_score", "resumeScore"),
    ("github_score", "githubScore"),
    ("leetcode_score", "leetcodeScore"),
    ("interview_score", "interviewScore"),
    ("assessment_score", "assessmentScore"),
    ("verification_status", "verificationStatus"),
    ("placement_status", "placementStatus"),
]


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


@router.post("/", status_code=201)
def create_student(
    payload: StudentIn,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    insert = {
        "college_id": tpo["college_id"],
        "name": payload.name,
        "email": payload.email.lower(),
        "branch": payload.branch,
        "graduation_year": payload.graduationYear,
    }
    try:
        res = sb.table("students").insert(insert).execute()
    except APIError as e:
        if "duplicate" in (e.message or "").lower():
            raise HTTPException(status_code=409, detail="A student with this email already exists.")
        raise HTTPException(status_code=400, detail=e.message)

    row = (res.data or [None])[0]
    if not row:
        raise HTTPException(status_code=500, detail="Insert returned no row")
    return {"message": "Student added successfully", "student": row}


@router.get("/export")
def export_students_csv(
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    try:
        rows = (
            sb.table("students")
            .select("*")
            .eq("college_id", tpo["college_id"])
            .execute()
            .data
            or []
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([out for _, out in _EXPORT_FIELDS])
    for r in rows:
        writer.writerow([r.get(src, "") for src, _ in _EXPORT_FIELDS])
    buf.seek(0)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="students.csv"'},
    )


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


@router.put("/{student_id}")
def update_student(
    student_id: str,
    payload: StudentUpdateIn,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    patch = {}
    if payload.name is not None:
        patch["name"] = payload.name
    if payload.email is not None:
        patch["email"] = payload.email.lower()
    if payload.branch is not None:
        patch["branch"] = payload.branch
    if payload.graduationYear is not None:
        patch["graduation_year"] = payload.graduationYear

    if not patch:
        row = get_student(student_id, tpo=tpo, sb=sb)
        return {"message": "Student updated successfully", "student": row}

    try:
        res = (
            sb.table("students")
            .update(patch)
            .eq("college_id", tpo["college_id"])
            .eq("id", student_id)
            .execute()
        )
    except APIError as e:
        if "duplicate" in (e.message or "").lower():
            raise HTTPException(status_code=409, detail="A student with this email already exists.")
        raise HTTPException(status_code=400, detail=e.message)

    row = (res.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="Student not found")
    return {"message": "Student updated successfully", "student": row}


@router.delete("/{student_id}", status_code=200)
def delete_student(
    student_id: str,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    try:
        res = (
            sb.table("students")
            .delete()
            .eq("college_id", tpo["college_id"])
            .eq("id", student_id)
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)

    if not res.data:
        raise HTTPException(status_code=404, detail="Student not found")
    return {"message": "Student deleted successfully"}


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
