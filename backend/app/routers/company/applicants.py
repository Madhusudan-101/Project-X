"""Applicants router — /company/jobs/{job_id}/applicants

Step 5: the company's ranked-candidates view for one job. Every read is
double-scoped: the job must belong to the caller's company, and the
application must belong to that job. A company can never see another
company's applications or scores, even by guessing IDs.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError

from ...deps import require_company_role
from ...schemas import (
    ApplicationAnalysisOut,
    ApplicationOut,
    ApplicationStatusUpdateIn,
    RankedApplicantOut,
)
from ...crud import (
    get_analyses_for_job,
    get_application,
    get_application_analysis,
    get_company_by_owner_id,
    get_job,
    get_profiles_basic,
    list_applications_for_job,
    update_application_status_for_company,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/company/jobs/{job_id}/applicants", tags=["applicants"])

_SORT_FIELDS = ("placement_probability", "weighted_composite")


def _owned_job_or_404(current_user: dict, job_id: str) -> dict:
    company = get_company_by_owner_id(current_user["id"])
    if not company:
        raise HTTPException(status_code=404, detail="Company profile not found.")
    job = get_job(job_id)
    if not job or job["company_id"] != company["id"]:
        # Same 404 whether the job is missing or another company's — no leak.
        raise HTTPException(status_code=404, detail="Job not found.")
    return {"company": company, "job": job}


def _display_name(profile: dict) -> Optional[str]:
    if not profile:
        return None
    if profile.get("name"):
        return profile["name"]
    parts = [profile.get("first_name") or "", profile.get("last_name") or ""]
    joined = " ".join(p for p in parts if p).strip()
    return joined or None


# ── GET .../applicants ───────────────────────────────────────────────

@router.get("", response_model=List[RankedApplicantOut])
def list_applicants_route(
    job_id: str,
    sort_by: str = "placement_probability",
    current_user: dict = Depends(require_company_role),
) -> List[RankedApplicantOut]:
    if sort_by not in _SORT_FIELDS:
        raise HTTPException(status_code=400, detail=f"sort_by must be one of {_SORT_FIELDS}.")
    _owned_job_or_404(current_user, job_id)

    try:
        applications = list_applications_for_job(job_id)
        analyses = get_analyses_for_job(job_id)
        profiles = get_profiles_basic([a["student_id"] for a in applications])
    except APIError as exc:
        log.error("DB error listing applicants for job %s: %s", job_id, exc)
        raise HTTPException(status_code=500, detail="Failed to fetch applicants.")

    rows: List[RankedApplicantOut] = []
    for app in applications:
        analysis = analyses.get(app["id"])
        profile = profiles.get(app["student_id"], {})
        rows.append(RankedApplicantOut(
            application_id=app["id"],
            student_id=app["student_id"],
            student_name=_display_name(profile),
            student_email=profile.get("email"),
            status=app["status"],
            applied_at=str(app["applied_at"]),
            placement_probability=(
                float(analysis["placement_probability"]) if analysis else None
            ),
            weighted_composite=(
                float(analysis["weighted_composite"]) if analysis else None
            ),
            has_analysis=analysis is not None,
        ))

    rows.sort(
        key=lambda r: (
            getattr(r, sort_by) if getattr(r, sort_by) is not None else -1.0,
            r.applied_at,
        ),
        reverse=True,
    )
    return rows


# ── GET .../applicants/{application_id}  (full job-scoped analysis) ──

@router.get("/{application_id}", response_model=ApplicationAnalysisOut)
def get_applicant_analysis_route(
    job_id: str,
    application_id: str,
    current_user: dict = Depends(require_company_role),
) -> ApplicationAnalysisOut:
    ctx = _owned_job_or_404(current_user, job_id)
    application = get_application(application_id)
    if not application or application["job_id"] != job_id:
        raise HTTPException(status_code=404, detail="Application not found.")
    if application["company_id"] != ctx["company"]["id"]:
        raise HTTPException(status_code=404, detail="Application not found.")

    analysis = get_application_analysis(application_id)
    if not analysis:
        raise HTTPException(status_code=409, detail="Scoring for this application is not complete yet.")

    return ApplicationAnalysisOut(
        id=analysis["id"],
        application_id=analysis["application_id"],
        student_id=analysis["student_id"],
        job_id=analysis["job_id"],
        company_id=analysis["company_id"],
        analysis_json=analysis["analysis_json"],
        placement_probability=float(analysis["placement_probability"]),
        weighted_composite=float(analysis["weighted_composite"]),
        weights_snapshot=analysis["weights_snapshot"],
        generated_at=str(analysis["generated_at"]),
    )


# ── PATCH .../applicants/{application_id}/status ────────────────────

@router.patch("/{application_id}/status", response_model=ApplicationOut)
def update_applicant_status_route(
    job_id: str,
    application_id: str,
    payload: ApplicationStatusUpdateIn,
    current_user: dict = Depends(require_company_role),
) -> ApplicationOut:
    ctx = _owned_job_or_404(current_user, job_id)
    application = get_application(application_id)
    if not application or application["job_id"] != job_id:
        raise HTTPException(status_code=404, detail="Application not found.")

    updated = update_application_status_for_company(
        application_id, ctx["company"]["id"], payload.status
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Application not found.")

    return ApplicationOut(
        id=updated["id"],
        student_id=updated["student_id"],
        job_id=updated["job_id"],
        company_id=updated["company_id"],
        status=updated["status"],
        applied_at=str(updated["applied_at"]),
        updated_at=str(updated["updated_at"]),
    )
