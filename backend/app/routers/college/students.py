"""Students router — /api/students

Ports collage_backend/routes/studentRoutes.js to FastAPI + Supabase.
Every query is scoped by the TPO's college_id AND runs through an RLS-bound
client, so cross-college access is refused at two layers.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from postgrest.exceptions import APIError
from supabase import Client

from ...deps import get_current_tpo, get_user_supabase
from ...schemas import (
    StudentBlockIn, StudentBulkPlacementIn, StudentIn, StudentOnboardIn,
    StudentRestrictIn, StudentUnblockIn, StudentUpdateIn,
)
from ...services.college.audit import log_college_action
from ...services.college.student_access import block_student, invite_students, restrict_student, unblock_student
from ...utils.college.branch import normalize_branch
from ...utils.csv_safe import safe_cell
from ...utils.college.csv_students import CsvFormatError, merge_duplicate_rows, parse_students_csv_with_warnings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/students", tags=["students"])

MAX_CSV_BYTES = 5 * 1024 * 1024  # 5 MB
_EMAIL_LOOKUP_CHUNK = 100  # keeps the in.(...) URL short, and each page well under PostgREST's row cap


def _existing_by_email(sb: Client, college_id: str, emails: list[str]) -> dict[str, dict]:
    """This college's stored students for the given emails, keyed by email."""
    found: dict[str, dict] = {}
    for i in range(0, len(emails), _EMAIL_LOOKUP_CHUNK):
        chunk = emails[i:i + _EMAIL_LOOKUP_CHUNK]
        try:
            rows = (
                sb.table("students").select("*")
                .eq("college_id", college_id).in_("email", chunk)
                .execute()
            ).data or []
        except APIError as e:
            raise HTTPException(status_code=500, detail=e.message)
        found.update({r["email"]: r for r in rows})
    return found


def _filter_by_branch(rows: list[dict], branch: Optional[str]) -> list[dict]:
    """Shared by list_students and export_students_csv — branch isn't a plain
    equality match (normalize_branch tolerates casing/abbreviation variants),
    so this can't be a `.eq()` on the query itself."""
    if not branch:
        return rows
    needle = normalize_branch(branch)
    return [r for r in rows if needle and needle in normalize_branch(r.get("branch"))]

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

    return _filter_by_branch(rows, branch)


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
    log_college_action("student_created", tpo, target_type="student", target_id=row["id"], target_label=row["email"])
    return {"message": "Student added successfully", "student": row}


@router.put("/bulk-placement-status")
def bulk_update_placement_status(
    payload: StudentBulkPlacementIn,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    """Registered before PUT /{student_id} — otherwise that route's
    {student_id} wildcard would swallow this literal path (same class of
    bug as GET /export vs GET /{student_id})."""
    try:
        res = (
            sb.table("students")
            .update({"placement_status": payload.placementStatus})
            .eq("college_id", tpo["college_id"])
            .in_("id", payload.studentIds)
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=400, detail=e.message)

    updated = res.data or []
    if updated:
        log_college_action(
            "students_placement_updated", tpo, target_type="roster", target_id=tpo["college_id"],
            metadata={"placement_status": payload.placementStatus, "updated": len(updated),
                      "requested": len(payload.studentIds)},
        )
    return {
        "message": f"Updated placement status for {len(updated)} student{'' if len(updated) == 1 else 's'}",
        "updatedCount": len(updated),
        "students": updated,
    }


@router.get("/export")
def export_students_csv(
    branch: Optional[str] = Query(None),
    graduationYear: Optional[int] = Query(None),
    minimumScore: Optional[float] = Query(None),
    placementStatus: Optional[str] = Query(None),
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    q = sb.table("students").select("*").eq("college_id", tpo["college_id"])
    if graduationYear is not None:
        q = q.eq("graduation_year", graduationYear)
    if minimumScore is not None:
        q = q.gte("employability_score", minimumScore)
    if placementStatus:
        q = q.eq("placement_status", placementStatus)
    try:
        rows = q.execute().data or []
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)

    rows = _filter_by_branch(rows, branch)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([out for _, out in _EXPORT_FIELDS])
    for r in rows:
        writer.writerow([safe_cell(r.get(src, "")) for src, _ in _EXPORT_FIELDS])
    buf.seek(0)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="students.csv"'},
    )


@router.post("/onboard")
def onboard_students(
    payload: StudentOnboardIn,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    """Send onboarding invites — see services/college/student_access.py.
    Registered before GET /{student_id} for the same reason /export is:
    otherwise that route's {student_id} wildcard would swallow this path."""
    result = invite_students(sb, tpo, payload)
    if result["invited"] or result["failed"]:
        log_college_action(
            "students_invited", tpo, target_type="roster", target_id=tpo["college_id"],
            metadata={k: result[k] for k in ("considered", "invited", "failed", "skippedBlocked", "skippedInvalidEmail",
                                             "skippedAlreadyRegistered", "skippedAlreadyInvited")},
        )
    return result


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


@router.post("/{student_id}/block")
def block_student_route(
    student_id: str,
    payload: StudentBlockIn,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    """Temporary block. Enforced immediately for any linked candidate
    account, not just hidden in the UI — see student_access.py."""
    return block_student(sb, tpo, student_id, payload)


@router.post("/{student_id}/restrict")
def restrict_student_route(
    student_id: str,
    payload: StudentRestrictIn,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    """Permanent restriction/deactivation."""
    return restrict_student(sb, tpo, student_id, payload)


@router.post("/{student_id}/unblock")
def unblock_student_route(
    student_id: str,
    payload: StudentUnblockIn,
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    """Reverses either block or restrict — restores full access."""
    return unblock_student(sb, tpo, student_id, payload)


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
    if payload.placementStatus is not None:
        patch["placement_status"] = payload.placementStatus

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
    log_college_action("student_updated", tpo, target_type="student", target_id=row["id"], target_label=row["email"],
                       metadata={"fields": sorted(patch)})  # which fields, never their values
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
    # The row is gone, so the audit entry is the only record of who it was (id + email, nothing else).
    log_college_action("student_deleted", tpo, target_type="student", target_id=res.data[0]["id"],
                       target_label=res.data[0].get("email"))
    return {"message": "Student deleted successfully"}


@router.post("/upload", status_code=201)
async def upload_students_csv(
    response: Response,
    file: UploadFile = File(...),
    dry_run: bool = Query(False, alias="dryRun"),
    expected_plan: Optional[str] = Query(None, alias="expectedPlan"),
    tpo: dict = Depends(get_current_tpo),
    sb: Client = Depends(get_user_supabase),
):
    """Import a roster CSV.

    With ?dryRun=true the file is parsed and compared with the stored roster exactly
    as a real import would, and the created / updated / unchanged counts are returned
    without writing anything. Both responses carry `planId`, a fingerprint of what
    would be written. A real import that passes ?expectedPlan=<planId from the
    preview> is refused with 409 (nothing written) if the file or the roster no
    longer produces that same plan, so a stale preview can never be confirmed.

    A dry run cannot see database constraints, so it predicts the outcome but does
    not guarantee the real import will succeed. `addedStudents` is created + updated,
    the students that were (or would be) written; students already up to date are
    counted in `unchanged`, not in `addedStudents`.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    raw = await file.read()
    if len(raw) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="CSV too large (max 5 MB)")

    try:
        parsed, invalid, warnings = parse_students_csv_with_warnings(raw)
    except CsvFormatError as e:
        raise HTTPException(status_code=400, detail=str(e))
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

    merged, duplicates = merge_duplicate_rows(parsed)
    conflicts = [d for d in duplicates if d["conflicts"]]
    if conflicts:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "CSV file repeats an email with different values — fix it so each student appears once",
                "duplicates": conflicts[:20],
            },
        )
    for d in duplicates:  # agreeing repeats are merged, but never silently
        warnings.append({
            "line": d["lines"][-1], "column": "email", "value": d["email"],
            "reason": f"repeats line {d['lines'][0]} with the same values — counted once",
        })

    college_id = tpo["college_id"]
    existing = _existing_by_email(sb, college_id, [r["email"] for r in merged])

    # A row only needs writing when it is new or differs from what is stored. A new
    # student is written in full. For an existing one only the fields that differ
    # are written (plus the required columns, which the database insists on even
    # when the row already exists), so a value the file merely repeats from an older
    # export can never overwrite a newer edit made since. Fields the file does not
    # supply are absent from the row, so they are never touched either (see
    # utils/college/csv_students.py).
    created = updated = unchanged = 0
    pending: list[dict] = []
    plan: list[list] = []
    for row in sorted(merged, key=lambda r: r["email"]):
        stored = existing.get(row["email"])
        if stored is None:
            created += 1
            payload = {**row, "college_id": college_id}
            plan.append([row["email"], "created", sorted(row.items())])
        else:
            changed = {k: v for k, v in row.items() if stored.get(k) != v}
            if not changed:
                unchanged += 1
                plan.append([row["email"], "unchanged"])
                continue
            updated += 1
            required = {k: row[k] for k in ("email", "name", "branch", "graduation_year")}
            payload = {**required, **changed, "college_id": college_id}
            plan.append([row["email"], "updated", sorted(changed.items())])
        pending.append(payload)
    plan_id = hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()[:32]

    summary = {
        "addedStudents": created + updated,
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
        "warnings": warnings[:20],
        "warningsTotal": len(warnings),
        "planId": plan_id,
        "dryRun": dry_run,
    }
    if dry_run:
        response.status_code = 200  # nothing was created
        return {"message": "Preview only — nothing was saved.", **summary, "students": []}

    if expected_plan is not None and expected_plan != plan_id:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "The file or the roster has changed since the preview, so nothing was imported. "
                           "Check the file again to see the current result.",
                "planId": plan_id,
            },
        )

    # PostgREST fills a column a bulk row omits with NULL, not its default, so
    # rows are written in groups that share one set of columns. Each group is one
    # request, so one transaction: it is saved completely or not at all.
    groups: dict[frozenset, list[dict]] = {}
    for row in pending:
        groups.setdefault(frozenset(row), []).append(row)

    written: list[dict] = []
    try:
        for group in groups.values():
            res = sb.table("students").upsert(group, on_conflict="college_id,email").execute()
            written.extend(res.data or [])
    except APIError as e:
        if written:
            message = (f"The import stopped part-way: {len(written)} of {len(pending)} changed students were saved "
                       f"before the database refused the next batch ({e.message}). Upload the same file again to "
                       "finish — students already saved will show as unchanged.")
        else:
            message = f"Nothing was saved: the database refused the import ({e.message})."
        raise HTTPException(
            status_code=400,
            detail={"message": message, "saved": len(written), "notSaved": len(pending) - len(written)},
        )
    except Exception:  # noqa: BLE001 — a dropped connection or timeout: the last batch may or may not have committed
        log.exception("Roster import for college %s did not get a confirmation from the database", college_id)
        raise HTTPException(
            status_code=502,
            detail={
                "message": "The database did not confirm the import, so it is unknown how much was saved "
                           f"({len(written)} students were confirmed before this). Reload the roster and upload "
                           "the same file again — students already saved will show as unchanged.",
                "saved": len(written),
                "notSaved": None,
            },
        )

    log_college_action(
        "roster_imported", tpo, target_type="roster", target_id=college_id,
        metadata={"created": created, "updated": updated, "unchanged": unchanged, "rows_in_file": len(parsed)},
    )
    return {"message": "Students uploaded successfully", **summary, "students": written}
