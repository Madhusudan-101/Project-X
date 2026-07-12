"""Company router — GET /company/me · PATCH /company/me

All routes are protected: require a valid Bearer token AND role == "company".
Uses the service-role db_client, so RLS is bypassed on the backend.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError

from ..deps import get_current_user
from ..schemas import CompanyOut, CompanyUpdateIn
from ..crud import get_company_by_owner_id, update_company

log = logging.getLogger(__name__)
router = APIRouter(prefix="/company", tags=["company"])


# ── Helpers ────────────────────────────────────────────────────────────

def map_company(row: dict) -> dict:
    """Convert a DB companies row to the CompanyOut shape."""
    return {
        "id": row["id"],
        "owner_id": row["owner_id"],
        "name": row["name"],
        "industry": row["industry"],
        "size": row["size"],
        "hiring_domains": row.get("hiring_domains") or [],
        "website": row.get("website"),
        "logo_url": row.get("logo_url"),
        "is_verified": bool(row.get("is_verified", False)),
        "created_at": str(row.get("created_at", "")),
    }


def _require_company_role(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependency: raises 403 if the authenticated user is not a company HR."""
    if current_user.get("role") != "company":
        raise HTTPException(
            status_code=403,
            detail="This endpoint is restricted to Company accounts.",
        )
    return current_user


# ── GET /company/me ────────────────────────────────────────────────────

@router.get("/me", response_model=CompanyOut)
def get_my_company(
    current_user: dict = Depends(_require_company_role),
) -> dict:
    """Return the company profile for the authenticated HR user."""
    owner_id = current_user["id"]
    try:
        company = get_company_by_owner_id(owner_id)
    except APIError as e:
        log.error("DB error fetching company for owner %s: %s", owner_id, e)
        raise HTTPException(status_code=500, detail="Failed to fetch company profile.")

    if not company:
        raise HTTPException(
            status_code=404,
            detail="Company profile not found. Please complete onboarding.",
        )
    return map_company(company)


# ── PATCH /company/me ──────────────────────────────────────────────────

@router.patch("/me", response_model=CompanyOut)
def update_my_company(
    payload: CompanyUpdateIn,
    current_user: dict = Depends(_require_company_role),
) -> dict:
    """Partially update the company profile (website, logo, domains, etc.)."""
    owner_id = current_user["id"]

    # Build the DB update dict — only include provided fields
    update_data: dict = {}
    if payload.name is not None:
        update_data["name"] = payload.name
    if payload.industry is not None:
        update_data["industry"] = payload.industry
    if payload.size is not None:
        update_data["size"] = payload.size
    if payload.hiring_domains is not None:
        update_data["hiring_domains"] = payload.hiring_domains
    if payload.website is not None:
        update_data["website"] = payload.website
    if payload.logo_url is not None:
        update_data["logo_url"] = payload.logo_url

    try:
        company = update_company(owner_id, update_data)
    except APIError as e:
        log.error("DB error updating company for owner %s: %s", owner_id, e)
        raise HTTPException(status_code=400, detail=f"Update failed: {e.message}")

    if not company:
        raise HTTPException(status_code=404, detail="Company profile not found.")

    return map_company(company)
