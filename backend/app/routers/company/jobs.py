"""Jobs router — /company/jobs

The company side of the core platform loop: create a JD (optionally
Gemini-assisted), set per-job weight sliders, publish it Live. Distinct
from the legacy /company/roles feature.

All routes require a valid Bearer token AND role == "company", and every
job is scoped to the caller's own company. Uses the service-role db_client;
RLS in db/jobs_and_applications_migration.sql is the defense-in-depth layer.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError

from ...deps import require_company_role
from ...schemas import (
    DraftJDIn,
    DraftJDOut,
    JobCreateIn,
    JobOut,
    JobUpdateIn,
    JOB_STATUSES,
)
from ...crud import (
    count_applications_for_job,
    create_job,
    get_company_by_owner_id,
    get_job,
    get_job_skill_names,
    get_job_visible_college_ids,
    get_job_weights,
    list_jobs_by_company,
    resolve_skill_ids,
    set_job_skills,
    set_job_visible_colleges,
    update_job,
    upsert_job_weights,
)
from ...services.candidate.job_scoring_agent import draft_job_description
from ...deps import db_client

log = logging.getLogger(__name__)
router = APIRouter(prefix="/company/jobs", tags=["jobs"])


# ── Helpers ────────────────────────────────────────────────────────────

def _get_owned_company(current_user: dict) -> dict:
    company = get_company_by_owner_id(current_user["id"])
    if not company:
        raise HTTPException(
            status_code=404,
            detail="Company profile not found. Please complete onboarding.",
        )
    return company


def _get_owned_job(job_id: str, company_id: str) -> dict:
    job = get_job(job_id)
    if not job or job["company_id"] != company_id:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


def _job_out(job: dict) -> JobOut:
    weights = get_job_weights(job["id"])
    return JobOut(
        id=job["id"],
        company_id=job["company_id"],
        title=job["title"],
        description=job["description"],
        domain=job["domain"],
        experience_level=job["experience_level"],
        location=job["location"],
        openings_count=int(job.get("openings_count", 1)),
        deadline=str(job["deadline"]),
        visibility=job["visibility"],
        status=job["status"],
        skills=get_job_skill_names(job["id"]),
        visible_college_ids=get_job_visible_college_ids(job["id"]),
        weights={
            "resume_weight": weights["resume_weight"],
            "github_weight": weights["github_weight"],
            "leetcode_weight": weights["leetcode_weight"],
            "interview_weight": weights["interview_weight"],
            "assessment_weight": weights["assessment_weight"],
        } if weights else None,
        application_count=count_applications_for_job(job["id"]),
        employment_type=job.get("employment_type", "full-time"),
        interview_duration_minutes=int(job.get("interview_duration_minutes", 30)),
        interview_mode=job.get("interview_mode", "ai"),
        is_on_campus=bool(job.get("is_on_campus", True)),
        min_cgpa=job.get("min_cgpa"),
        eligible_branches=job.get("eligible_branches") or [],
        eligible_batch_years=job.get("eligible_batch_years") or [],
        ctc_min=job.get("ctc_min"),
        ctc_max=job.get("ctc_max"),
        ctc_currency=job.get("ctc_currency") or "INR",
        stipend_min=job.get("stipend_min"),
        stipend_max=job.get("stipend_max"),
        internship_duration_months=job.get("internship_duration_months"),
        ppo_ctc_min=job.get("ppo_ctc_min"),
        ppo_ctc_max=job.get("ppo_ctc_max"),
        perks=job.get("perks") or [],
        created_at=str(job.get("created_at", "")),
        updated_at=str(job.get("updated_at", "")),
    )


# ── POST /company/jobs/draft-description  (Gemini-assisted JD draft) ────

@router.post("/draft-description", response_model=DraftJDOut)
async def draft_description_route(
    payload: DraftJDIn,
    current_user: dict = Depends(require_company_role),
) -> DraftJDOut:
    _get_owned_company(current_user)
    try:
        text = await draft_job_description(
            brief=payload.brief,
            title=payload.title,
            domain=payload.domain,
            experience_level=payload.experience_level,
            location=payload.location,
            skills=payload.skills,
        )
    except RuntimeError as exc:  # missing API key
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        log.exception("JD draft failed")
        raise HTTPException(status_code=502, detail=f"Could not draft a description: {exc}")
    return DraftJDOut(description=text)


# ── GET /company/jobs/options/colleges  (for the restricted-visibility picker) ─

@router.get("/options/colleges")
def list_colleges_route(
    current_user: dict = Depends(require_company_role),
) -> list:
    _get_owned_company(current_user)
    try:
        res = (
            db_client.table("colleges")
            .select("id, name, city, state")
            .order("name", desc=False)
            .execute()
        )
    except APIError as exc:
        log.error("DB error listing colleges: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to fetch colleges.")
    return res.data or []


# ── POST /company/jobs  (create) ──────────────────────────────────────

@router.post("", response_model=JobOut, status_code=201)
def create_job_route(
    payload: JobCreateIn,
    current_user: dict = Depends(require_company_role),
) -> JobOut:
    company = _get_owned_company(current_user)

    if payload.publish and payload.deadline < date.today():
        raise HTTPException(
            status_code=400,
            detail="Cannot publish a job with a deadline in the past.",
        )

    try:
        skill_ids, _ = resolve_skill_ids(payload.skills)
        job = create_job(company["id"], {
            "title": payload.title,
            "description": payload.description,
            "domain": payload.domain,
            "experience_level": payload.experience_level,
            "location": payload.location,
            "openings_count": payload.openings_count,
            "deadline": payload.deadline.isoformat(),
            "visibility": payload.visibility,
            "status": "live" if payload.publish else "draft",
            # Eligibility & offer detail (jobs_eligibility_migration.sql).
            "employment_type": payload.employment_type,
            "interview_duration_minutes": payload.interview_duration_minutes,
            "interview_mode": payload.interview_mode,
            "is_on_campus": payload.is_on_campus,
            "min_cgpa": payload.min_cgpa,
            "eligible_branches": payload.eligible_branches,
            "eligible_batch_years": payload.eligible_batch_years,
            "ctc_min": payload.ctc_min,
            "ctc_max": payload.ctc_max,
            "ctc_currency": payload.ctc_currency,
            "stipend_min": payload.stipend_min,
            "stipend_max": payload.stipend_max,
            "internship_duration_months": payload.internship_duration_months,
            "ppo_ctc_min": payload.ppo_ctc_min,
            "ppo_ctc_max": payload.ppo_ctc_max,
            "perks": payload.perks,
        })
        if not job:
            raise HTTPException(status_code=400, detail="Failed to create job.")

        set_job_skills(job["id"], skill_ids)
        set_job_visible_colleges(
            job["id"],
            payload.visible_college_ids if payload.visibility == "restricted" else [],
        )
        # DB CHECK (job_weights_sum_100) re-validates the sum server-side.
        upsert_job_weights(job["id"], payload.weights.model_dump())
    except APIError as exc:
        log.error("DB error creating job for company %s: %s", company["id"], exc)
        raise HTTPException(status_code=400, detail=f"Failed to create job: {exc.message}")

    return _job_out(get_job(job["id"]))


# ── GET /company/jobs  (list) ─────────────────────────────────────────

@router.get("", response_model=List[JobOut])
def list_jobs_route(
    status: Optional[str] = None,
    current_user: dict = Depends(require_company_role),
) -> List[JobOut]:
    if status is not None and status not in JOB_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {JOB_STATUSES}.")
    company = _get_owned_company(current_user)
    try:
        rows = list_jobs_by_company(company["id"], status)
    except APIError as exc:
        log.error("DB error listing jobs for company %s: %s", company["id"], exc)
        raise HTTPException(status_code=500, detail="Failed to fetch jobs.")
    return [_job_out(r) for r in rows]


# ── GET /company/jobs/{job_id} ───────────────────────────────────────

@router.get("/{job_id}", response_model=JobOut)
def get_job_route(
    job_id: str,
    current_user: dict = Depends(require_company_role),
) -> JobOut:
    company = _get_owned_company(current_user)
    return _job_out(_get_owned_job(job_id, company["id"]))


# ── PATCH /company/jobs/{job_id} ─────────────────────────────────────

@router.patch("/{job_id}", response_model=JobOut)
def update_job_route(
    job_id: str,
    payload: JobUpdateIn,
    current_user: dict = Depends(require_company_role),
) -> JobOut:
    company = _get_owned_company(current_user)
    job = _get_owned_job(job_id, company["id"])

    fields: dict = {}
    for attr in (
        "title", "description", "domain", "experience_level", "location",
        "openings_count", "visibility",
        # Eligibility & offer detail (jobs_eligibility_migration.sql).
        "employment_type", "interview_duration_minutes", "interview_mode", "is_on_campus",
        "min_cgpa", "eligible_branches", "eligible_batch_years",
        "ctc_min", "ctc_max", "ctc_currency",
        "stipend_min", "stipend_max", "internship_duration_months",
        "ppo_ctc_min", "ppo_ctc_max", "perks",
    ):
        val = getattr(payload, attr)
        if val is not None:
            fields[attr] = val
    if payload.deadline is not None:
        fields["deadline"] = payload.deadline.isoformat()

    new_visibility = payload.visibility or job["visibility"]
    if new_visibility == "restricted" and payload.visible_college_ids is not None and not payload.visible_college_ids:
        raise HTTPException(status_code=400, detail="Restricted jobs must list at least one college.")

    try:
        if fields:
            update_job(job_id, fields)
        if payload.skills is not None:
            skill_ids, _ = resolve_skill_ids(payload.skills)
            set_job_skills(job_id, skill_ids)
        if payload.visible_college_ids is not None or payload.visibility is not None:
            set_job_visible_colleges(
                job_id,
                (payload.visible_college_ids or get_job_visible_college_ids(job_id))
                if new_visibility == "restricted" else [],
            )
        if payload.weights is not None:
            upsert_job_weights(job_id, payload.weights.model_dump())
    except APIError as exc:
        log.error("DB error updating job %s: %s", job_id, exc)
        raise HTTPException(status_code=400, detail=f"Update failed: {exc.message}")

    return _job_out(get_job(job_id))


# ── POST /company/jobs/{job_id}/publish ─────────────────────────────

@router.post("/{job_id}/publish", response_model=JobOut)
def publish_job_route(
    job_id: str,
    current_user: dict = Depends(require_company_role),
) -> JobOut:
    company = _get_owned_company(current_user)
    job = _get_owned_job(job_id, company["id"])

    if date.fromisoformat(str(job["deadline"])) < date.today():
        raise HTTPException(status_code=400, detail="Cannot publish a job with a past deadline.")
    if not get_job_weights(job_id):
        raise HTTPException(status_code=400, detail="Set the weight sliders before publishing.")

    update_job(job_id, {"status": "live"})
    return _job_out(get_job(job_id))


# ── POST /company/jobs/{job_id}/close ───────────────────────────────

@router.post("/{job_id}/close", response_model=JobOut)
def close_job_route(
    job_id: str,
    current_user: dict = Depends(require_company_role),
) -> JobOut:
    company = _get_owned_company(current_user)
    _get_owned_job(job_id, company["id"])
    update_job(job_id, {"status": "closed"})
    return _job_out(get_job(job_id))
