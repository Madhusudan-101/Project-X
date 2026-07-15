"""Departments router — /api/departments

Departments are a college-scoped roster of academic departments. Each
department's `code` is matched against students.branch (via the same
normalize_branch() used by drives/shortlist) to compute live stats —
there is no FK from students to departments, so this never risks
breaking existing student data.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from supabase import Client

from ..deps import get_current_tpo, get_user_supabase
from ..schemas import DepartmentIn, DepartmentUpdateIn
from ..utils.branch import normalize_branch

router = APIRouter(prefix="/api/departments", tags=["departments"])


def _dept_to_out(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "code": row.get("code"),
        "hodName": row.get("hod_name"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def _matches_department(student_branch: str, dept_name: str, dept_code: str | None) -> bool:
    sb = normalize_branch(student_branch)
    if not sb:
        return False
    if dept_code and normalize_branch(dept_code) == sb:
        return True
    return normalize_branch(dept_name) == sb


def _compute_stats(department: dict, students: list[dict]) -> dict:
    matched = [
        s for s in students
        if _matches_department(s.get("branch"), department["name"], department.get("code"))
    ]
    total = len(matched)
    avg_score = (
        round(sum(float(s.get("employability_score") or 0) for s in matched) / total, 2)
        if total
        else 0.0
    )
    placed = sum(1 for s in matched if (s.get("placement_status") or "") == "placed")
    placement_rate = round((placed / total) * 100, 1) if total else 0.0
    return {
        "studentCount": total,
        "avgEmployabilityScore": avg_score,
        "placedStudents": placed,
        "placementRate": placement_rate,
    }


def _fetch_students(sb: Client, college_id: str) -> list[dict]:
    try:
        return (
            sb.table("students")
            .select("id, name, email, branch, employability_score, placement_status")
            .eq("college_id", college_id)
            .execute()
        ).data or []
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)


@router.get("/")
def list_departments(
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    try:
        depts = (
            sb.table("departments")
            .select("*")
            .eq("college_id", tpo["college_id"])
            .order("name")
            .execute()
        ).data or []
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)

    students = _fetch_students(sb, tpo["college_id"])
    return [
        {**_dept_to_out(d), **_compute_stats(d, students)}
        for d in depts
    ]


@router.post("/", status_code=201)
def create_department(
    payload: DepartmentIn,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    insert = {
        "college_id": tpo["college_id"],
        "name": payload.name,
        "code": payload.code,
        "hod_name": payload.hodName,
    }
    try:
        res = sb.table("departments").insert(insert).execute()
    except APIError as e:
        status = 409 if "duplicate" in (e.message or "").lower() else 400
        raise HTTPException(status_code=status, detail=e.message)

    row = (res.data or [None])[0]
    if not row:
        raise HTTPException(status_code=500, detail="Insert returned no row")
    return {"message": "Department created successfully", "department": _dept_to_out(row)}


@router.get("/{department_id}")
def get_department(
    department_id: str,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    try:
        res = (
            sb.table("departments")
            .select("*")
            .eq("college_id", tpo["college_id"])
            .eq("id", department_id)
            .single()
            .execute()
        )
    except APIError as e:
        if e.code == "PGRST116":
            raise HTTPException(status_code=404, detail="Department not found")
        raise HTTPException(status_code=500, detail=e.message)

    department = res.data
    students = _fetch_students(sb, tpo["college_id"])
    matched = [
        s for s in students
        if _matches_department(s.get("branch"), department["name"], department.get("code"))
    ]
    return {
        **_dept_to_out(department),
        **_compute_stats(department, students),
        "students": matched,
    }


@router.put("/{department_id}")
def update_department(
    department_id: str,
    payload: DepartmentUpdateIn,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    patch = {}
    if payload.name is not None:
        patch["name"] = payload.name
    if payload.code is not None:
        patch["code"] = payload.code
    if payload.hodName is not None:
        patch["hod_name"] = payload.hodName

    if not patch:
        return get_department(department_id, tpo=tpo, sb=sb)

    try:
        res = (
            sb.table("departments")
            .update(patch)
            .eq("college_id", tpo["college_id"])
            .eq("id", department_id)
            .execute()
        )
    except APIError as e:
        status = 409 if "duplicate" in (e.message or "").lower() else 400
        raise HTTPException(status_code=status, detail=e.message)

    row = (res.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="Department not found")
    return {"message": "Department updated successfully", "department": _dept_to_out(row)}


@router.delete("/{department_id}", status_code=200)
def delete_department(
    department_id: str,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    try:
        res = (
            sb.table("departments")
            .delete()
            .eq("college_id", tpo["college_id"])
            .eq("id", department_id)
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)

    if not res.data:
        raise HTTPException(status_code=404, detail="Department not found")
    return {"message": "Department deleted successfully"}
