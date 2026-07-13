"""Roles router — /company/roles

Feature 2: Role Posting. Companies can create, edit, delete, archive and
publish job roles. All routes are protected: require a valid Bearer token
AND role == "company", and every role is scoped to the caller's own
company (never another company's rows).

Uses the service-role db_client, so RLS is bypassed on the backend —
RLS policies in db/role_migration.sql still protect any direct client access.
"""

import logging
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError

from ..deps import require_company_role
from ..schemas import RoleCreateIn, RoleOut, RoleUpdateIn, VALID_ROLE_STATUSES
from ..crud import (
    create_role,
    delete_role,
    get_company_by_owner_id,
    get_role_by_id,
    list_roles_by_company,
    update_role,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/company/roles", tags=["roles"])


# ── Helpers ────────────────────────────────────────────────────────────

def map_role(row: dict) -> dict:
    """Convert a DB job_roles row to the RoleOut shape."""
    return {
        "id": row["id"],
        "company_id": row["company_id"],
        "title": row["title"],
        "description": row["description"],
        "required_skills": row.get("required_skills") or [],
        "experience_level": row["experience_level"],
        "deadline": str(row["deadline"]),
        "minimum_employability_score": int(row.get("minimum_employability_score", 0)),
        "status": row["status"],
        "created_at": str(row.get("created_at", "")),
        "updated_at": str(row.get("updated_at", "")),
    }


def _get_owned_company(current_user: dict) -> dict:
    """Fetch the caller's company row, or 404 if they haven't completed onboarding."""
    company = get_company_by_owner_id(current_user["id"])
    if not company:
        raise HTTPException(
            status_code=404,
            detail="Company profile not found. Please complete onboarding.",
        )
    return company


def _get_owned_role(role_id: str, company_id: str) -> dict:
    role = get_role_by_id(role_id, company_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found.")
    return role


# ── POST /company/roles ─────────────────────────────────────────────────

@router.post("", response_model=RoleOut, status_code=201)
def create_role_route(
    payload: RoleCreateIn,
    current_user: dict = Depends(require_company_role),
) -> dict:
    """Create a new role in 'draft' status."""
    company = _get_owned_company(current_user)
    try:
        row = create_role(company["id"], {
            "title": payload.title,
            "description": payload.description,
            "required_skills": payload.required_skills,
            "experience_level": payload.experience_level,
            "deadline": payload.deadline.isoformat(),
            "minimum_employability_score": payload.minimum_employability_score,
            "status": "draft",
        })
    except APIError as e:
        log.error("DB error creating role for company %s: %s", company["id"], e)
        raise HTTPException(status_code=400, detail=f"Failed to create role: {e.message}")

    if not row:
        raise HTTPException(status_code=400, detail="Failed to create role.")
    return map_role(row)


# ── GET /company/roles ──────────────────────────────────────────────────

@router.get("", response_model=List[RoleOut])
def list_roles_route(
    status: Optional[str] = None,
    current_user: dict = Depends(require_company_role),
) -> list:
    """List all roles for the authenticated company, newest first."""
    if status is not None and status not in VALID_ROLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status filter. Must be one of: {', '.join(VALID_ROLE_STATUSES)}",
        )
    company = _get_owned_company(current_user)
    try:
        rows = list_roles_by_company(company["id"], status)
    except APIError as e:
        log.error("DB error listing roles for company %s: %s", company["id"], e)
        raise HTTPException(status_code=500, detail="Failed to fetch roles.")
    return [map_role(r) for r in rows]


# ── GET /company/roles/{role_id} ─────────────────────────────────────────

@router.get("/{role_id}", response_model=RoleOut)
def get_role_route(
    role_id: str,
    current_user: dict = Depends(require_company_role),
) -> dict:
    """Fetch a single role owned by the authenticated company."""
    company = _get_owned_company(current_user)
    try:
        role = _get_owned_role(role_id, company["id"])
    except APIError as e:
        log.error("DB error fetching role %s: %s", role_id, e)
        raise HTTPException(status_code=500, detail="Failed to fetch role.")
    return map_role(role)


# ── PATCH /company/roles/{role_id} ───────────────────────────────────────

@router.patch("/{role_id}", response_model=RoleOut)
def update_role_route(
    role_id: str,
    payload: RoleUpdateIn,
    current_user: dict = Depends(require_company_role),
) -> dict:
    """Partially update a role owned by the authenticated company."""
    company = _get_owned_company(current_user)
    _get_owned_role(role_id, company["id"])  # 404 guard before attempting update

    update_data: dict = {}
    if payload.title is not None:
        update_data["title"] = payload.title
    if payload.description is not None:
        update_data["description"] = payload.description
    if payload.required_skills is not None:
        update_data["required_skills"] = payload.required_skills
    if payload.experience_level is not None:
        update_data["experience_level"] = payload.experience_level
    if payload.deadline is not None:
        update_data["deadline"] = payload.deadline.isoformat()
    if payload.minimum_employability_score is not None:
        update_data["minimum_employability_score"] = payload.minimum_employability_score

    try:
        row = update_role(role_id, company["id"], update_data)
    except APIError as e:
        log.error("DB error updating role %s: %s", role_id, e)
        raise HTTPException(status_code=400, detail=f"Update failed: {e.message}")

    if not row:
        raise HTTPException(status_code=404, detail="Role not found.")
    return map_role(row)


# ── DELETE /company/roles/{role_id} ──────────────────────────────────────

@router.delete("/{role_id}", status_code=204)
def delete_role_route(
    role_id: str,
    current_user: dict = Depends(require_company_role),
) -> None:
    """Delete a role owned by the authenticated company."""
    company = _get_owned_company(current_user)
    try:
        deleted = delete_role(role_id, company["id"])
    except APIError as e:
        log.error("DB error deleting role %s: %s", role_id, e)
        raise HTTPException(status_code=500, detail="Failed to delete role.")

    if not deleted:
        raise HTTPException(status_code=404, detail="Role not found.")
    return None


# ── POST /company/roles/{role_id}/publish ────────────────────────────────

@router.post("/{role_id}/publish", response_model=RoleOut)
def publish_role_route(
    role_id: str,
    current_user: dict = Depends(require_company_role),
) -> dict:
    """Transition a role to 'published'. Blocked if the deadline has already passed."""
    company = _get_owned_company(current_user)
    role = _get_owned_role(role_id, company["id"])

    if date.fromisoformat(str(role["deadline"])) < date.today():
        raise HTTPException(
            status_code=400,
            detail="Cannot publish a role with a deadline in the past. Update the deadline first.",
        )

    row = update_role(role_id, company["id"], {"status": "published"})
    if not row:
        raise HTTPException(status_code=404, detail="Role not found.")
    return map_role(row)


# ── POST /company/roles/{role_id}/archive ────────────────────────────────

@router.post("/{role_id}/archive", response_model=RoleOut)
def archive_role_route(
    role_id: str,
    current_user: dict = Depends(require_company_role),
) -> dict:
    """Transition a role to 'archived'."""
    company = _get_owned_company(current_user)
    _get_owned_role(role_id, company["id"])

    row = update_role(role_id, company["id"], {"status": "archived"})
    if not row:
        raise HTTPException(status_code=404, detail="Role not found.")
    return map_role(row)
