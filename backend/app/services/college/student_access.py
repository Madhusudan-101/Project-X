"""Student access control + onboarding invites — TPO-facing.

The roster row (public.students) is the TPO's own record and is what
list/export/dashboard already read. When a roster student's email also
belongs to a candidate platform account at the SAME college, blocking or
restricting is mirrored onto that profiles row (blocked_permanent /
blocked_until — see db/admin_portal_migration.sql, 6.0) so it is actually
enforced by deps.get_current_user on every request that candidate makes,
not just hidden in the College Portal's UI. A roster row with no matching
account yet still records the status, so it is skipped by the onboarding
invite (see invite_students) rather than inviting someone the TPO just
restricted.

Every write here is scoped by `tpo["college_id"]` (derived from the
authenticated session, never the client) exactly like the rest of
routers/college/students.py; a student_id from another college 404s.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException
from postgrest.exceptions import APIError
from supabase import Client

from ...crud import update_profile
from ...deps import admin_client, db_client
from ...schemas import StudentBlockIn, StudentOnboardIn, StudentRestrictIn, StudentUnblockIn
from ...services.admin.events import log_event
from ...utils.email_rules import is_valid_email_format

_DURATIONS = {"1h": timedelta(hours=1), "24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
_MAX_CUSTOM = timedelta(days=3650)  # bounds a fat-fingered custom date without banning long blocks


def _get_student(sb: Client, college_id: str, student_id: str) -> Dict[str, Any]:
    try:
        res = (
            sb.table("students").select("*")
            .eq("college_id", college_id).eq("id", student_id)
            .single().execute()
        )
    except APIError as e:
        if e.code == "PGRST116":
            raise HTTPException(status_code=404, detail="Student not found")
        raise HTTPException(status_code=500, detail=e.message)
    return res.data


def _find_linked_profile(college_id: str, email: str) -> Optional[Dict[str, Any]]:
    """The candidate platform account this roster row belongs to, if the
    student has signed up at this SAME college. Uses db_client (service
    role): public.profiles has no RLS, so this must never go through the
    RLS-bound client the rest of the College Portal uses."""
    try:
        rows = (
            db_client.table("profiles")
            .select("id, email")
            .eq("role", "candidate")
            .eq("college_id", college_id)
            .ilike("email", email)
            .limit(1)
            .execute()
        ).data
    except APIError:
        return None
    return rows[0] if rows else None


def _resolve_until(payload: StudentBlockIn) -> str:
    if payload.duration == "custom":
        try:
            until = datetime.fromisoformat(payload.until.replace("Z", "+00:00"))  # type: ignore[union-attr]
        except ValueError:
            raise HTTPException(status_code=422, detail="'until' must be an ISO 8601 instant.")
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        if until <= now:
            raise HTTPException(status_code=422, detail="'until' must be in the future.")
        if until - now > _MAX_CUSTOM:
            raise HTTPException(status_code=422, detail="A custom block cannot be more than 10 years.")
        return until.isoformat()
    return (datetime.now(timezone.utc) + _DURATIONS[payload.duration]).isoformat()


def _apply(sb: Client, tpo: dict, student_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    try:
        updated = (
            sb.table("students").update(patch)
            .eq("college_id", tpo["college_id"]).eq("id", student_id)
            .execute()
        ).data
    except APIError as e:
        raise HTTPException(status_code=400, detail=e.message)
    if not updated:
        raise HTTPException(status_code=404, detail="Student not found")
    return updated[0]


def block_student(sb: Client, tpo: dict, student_id: str, payload: StudentBlockIn) -> Dict[str, Any]:
    student = _get_student(sb, tpo["college_id"], student_id)
    until_iso = _resolve_until(payload)
    now_iso = datetime.now(timezone.utc).isoformat()
    reason = payload.reason.strip()

    row = _apply(sb, tpo, student_id, {
        "status": "temporarily_blocked", "blocked_until": until_iso, "blocked_reason": reason,
        "blocked_at": now_iso, "blocked_by": tpo["id"],
    })

    profile = _find_linked_profile(tpo["college_id"], student["email"])
    if profile:
        update_profile(profile["id"], {
            "blocked_permanent": False, "blocked_until": until_iso, "blocked_at": now_iso,
            "blocked_by": tpo["id"], "blocked_reason": reason,
        })
        log_event(
            "user_blocked", actor_user_id=tpo["id"], actor_role="college", actor_label=tpo.get("email"),
            target_type="user", target_id=profile["id"], target_label=student["email"],
            metadata={"permanent": False, "until": until_iso, "reason": reason},
        )

    return {"message": "Student temporarily blocked.", "student": row, "accountRestricted": bool(profile)}


def restrict_student(sb: Client, tpo: dict, student_id: str, payload: StudentRestrictIn) -> Dict[str, Any]:
    student = _get_student(sb, tpo["college_id"], student_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    reason = payload.reason.strip()

    row = _apply(sb, tpo, student_id, {
        "status": "restricted", "blocked_until": None, "blocked_reason": reason,
        "blocked_at": now_iso, "blocked_by": tpo["id"],
    })

    profile = _find_linked_profile(tpo["college_id"], student["email"])
    if profile:
        update_profile(profile["id"], {
            "blocked_permanent": True, "blocked_until": None, "blocked_at": now_iso,
            "blocked_by": tpo["id"], "blocked_reason": reason,
        })
        log_event(
            "user_blocked", actor_user_id=tpo["id"], actor_role="college", actor_label=tpo.get("email"),
            target_type="user", target_id=profile["id"], target_label=student["email"],
            metadata={"permanent": True, "reason": reason},
        )

    return {"message": "Student restricted.", "student": row, "accountRestricted": bool(profile)}


def unblock_student(sb: Client, tpo: dict, student_id: str, payload: StudentUnblockIn) -> Dict[str, Any]:
    student = _get_student(sb, tpo["college_id"], student_id)

    row = _apply(sb, tpo, student_id, {
        "status": "active", "blocked_until": None, "blocked_reason": None,
        "blocked_at": None, "blocked_by": None,
    })

    profile = _find_linked_profile(tpo["college_id"], student["email"])
    if profile:
        update_profile(profile["id"], {
            "blocked_permanent": False, "blocked_until": None, "blocked_at": None,
            "blocked_by": None, "blocked_reason": None,
        })
        log_event(
            "user_unblocked", actor_user_id=tpo["id"], actor_role="college", actor_label=tpo.get("email"),
            target_type="user", target_id=profile["id"], target_label=student["email"],
            metadata={"reason": (payload.reason or "").strip() or None},
        )

    return {"message": "Student access restored.", "student": row, "accountRestricted": bool(profile)}


def invite_students(sb: Client, tpo: dict, payload: StudentOnboardIn) -> Dict[str, Any]:
    """Send onboarding invites — Supabase's own invite-by-email (a secure,
    single-use link; no password is ever generated or emailed) — to the
    subset of this college's roster that is active, has a usable email,
    doesn't already have a platform account, and hasn't been invited before.
    Never crashes on one student's failure; every skip/failure is counted so
    the TPO sees exactly what happened, and a failed invite (invited_at left
    unset) is retried simply by calling this again."""
    college_id = tpo["college_id"]
    q = sb.table("students").select("id, name, email, status, invited_at").eq("college_id", college_id)
    if payload.studentIds:
        q = q.in_("id", payload.studentIds)
    try:
        rows = q.execute().data or []
    except APIError as e:
        raise HTTPException(status_code=500, detail=e.message)

    try:
        college = sb.table("colleges").select("plan, name").eq("id", college_id).single().execute().data or {}
    except APIError:
        college = {}
    plan = college.get("plan") or "standard"

    counters = {
        "considered": len(rows), "invited": 0, "skippedBlocked": 0, "skippedInvalidEmail": 0,
        "skippedAlreadyRegistered": 0, "skippedAlreadyInvited": 0, "failed": 0,
    }
    now_iso = datetime.now(timezone.utc).isoformat()

    for row in rows:
        email = (row.get("email") or "").strip()
        if row.get("status") != "active":
            counters["skippedBlocked"] += 1
            continue
        if not email or not is_valid_email_format(email):
            counters["skippedInvalidEmail"] += 1
            continue
        if _find_linked_profile(college_id, email):
            counters["skippedAlreadyRegistered"] += 1
            continue
        if row.get("invited_at"):
            counters["skippedAlreadyInvited"] += 1
            continue

        try:
            admin_client.auth.admin.invite_user_by_email(email, {
                "data": {"role": "candidate", "collegeId": college_id, "name": row.get("name") or "", "plan": plan},
            })
        except Exception:  # noqa: BLE001 — one student's failure must never abort the batch
            counters["failed"] += 1
            continue

        try:
            sb.table("students").update({"invited_at": now_iso, "invited_by": tpo["id"]}) \
                .eq("college_id", college_id).eq("id", row["id"]).execute()
        except APIError:
            pass  # the invite was already sent; leaving invited_at unset only risks a harmless re-invite later
        counters["invited"] += 1

    return {
        "message": f"{counters['invited']} onboarding invite{'s' if counters['invited'] != 1 else ''} sent.",
        "collegeName": college.get("name") or "", "plan": plan, **counters,
    }
