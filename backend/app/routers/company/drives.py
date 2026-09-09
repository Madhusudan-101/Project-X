"""Drives router — /company/jobs/{job_id}/drives + /company/drive-templates
+ /company/dashboard/funnel

A job (public.jobs) is created once; it then runs as one or more DRIVES,
one per college, each independently scheduled and eligibility-gated. Each
drive has ordered rounds, and shortlisting is a manual company action at
every round — nothing here auto-advances or auto-rejects anyone.

All routes require role == "company" and are scoped to the caller's own
company via the same `_get_owned_job` pattern used in jobs.py.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError

from ...deps import require_company_role
from ...schemas import (
    ApplyTemplateIn,
    CompanyFunnelOut,
    DriveCloneIn,
    DriveTemplateIn,
    DriveTemplateOut,
    JobDriveIn,
    JobDriveOut,
    JobDriveRoundIn,
    JobDriveRoundOut,
    JobDriveUpdateIn,
    RoundApplicantOut,
    RoundStatusUpdateIn,
)
from ...crud import (
    apply_template_to_drive,
    clone_drive,
    create_drive_round,
    create_drive_template,
    create_job_drive,
    get_analyses_for_job,
    get_company_by_owner_id,
    get_company_funnel_counts,
    get_drive_for_job_college,
    get_drive_round,
    get_drive_template,
    get_job,
    get_college_names,
    get_profiles_basic,
    get_profiles_college_map,
    list_applications_for_job,
    list_drive_templates_for_company,
    list_drives_for_job,
    list_round_results_for_applications,
    list_round_results_for_drive_round,
    list_rounds_for_drive,
    replace_drive_rounds,
    set_round_result_status,
    update_drive_round,
    update_job_drive,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/company", tags=["drives"])


# ── Helpers ────────────────────────────────────────────────────────────

def _company(current_user: dict) -> dict:
    company = get_company_by_owner_id(current_user["id"])
    if not company:
        raise HTTPException(status_code=404, detail="Company profile not found. Please complete onboarding.")
    return company


def _owned_job(job_id: str, company_id: str) -> dict:
    job = get_job(job_id)
    if not job or job["company_id"] != company_id:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


def _owned_drive(job_id: str, drive_id: str, company_id: str) -> dict:
    _owned_job(job_id, company_id)
    drive = None
    for d in list_drives_for_job(job_id):
        if d["id"] == drive_id:
            drive = d
            break
    if not drive:
        raise HTTPException(status_code=404, detail="Drive not found.")
    return drive


def _round_out(r: dict) -> JobDriveRoundOut:
    return JobDriveRoundOut(
        id=r["id"],
        drive_id=r["drive_id"],
        round_number=r["round_number"],
        round_type=r["round_type"],
        mode=r["mode"],
        window_start=str(r["window_start"]) if r.get("window_start") else None,
        window_end=str(r["window_end"]) if r.get("window_end") else None,
    )


def _drive_out(drive: dict, *, college_name: Optional[str] = None,
               applicant_count: int = 0) -> JobDriveOut:
    rounds = list_rounds_for_drive(drive["id"])
    return JobDriveOut(
        id=drive["id"],
        job_id=drive["job_id"],
        college_id=drive["college_id"],
        college_name=college_name,
        status=drive["status"],
        is_on_campus=bool(drive.get("is_on_campus", True)),
        apply_deadline=str(drive["apply_deadline"]),
        oa_window_start=str(drive["oa_window_start"]) if drive.get("oa_window_start") else None,
        oa_window_end=str(drive["oa_window_end"]) if drive.get("oa_window_end") else None,
        min_cgpa=float(drive["min_cgpa"]) if drive.get("min_cgpa") is not None else None,
        eligible_branches=drive.get("eligible_branches") or [],
        eligible_batch_years=drive.get("eligible_batch_years") or [],
        rounds=[_round_out(r) for r in rounds],
        applicant_count=applicant_count,
        created_at=str(drive.get("created_at", "")),
        updated_at=str(drive.get("updated_at", "")),
    )


def _count_drive_applicants(job_id: str, college_id: str) -> int:
    apps = list_applications_for_job(job_id)
    if not apps:
        return 0
    college_by_student = get_profiles_college_map([a["student_id"] for a in apps])
    return sum(1 for a in apps if college_by_student.get(a["student_id"]) == college_id)


def _template_out(t: dict) -> DriveTemplateOut:
    return DriveTemplateOut(
        id=t["id"],
        company_id=t["company_id"],
        name=t["name"],
        interview_mode=t.get("interview_mode"),
        rounds_json=t.get("rounds_json") or [],
        default_min_cgpa=float(t["default_min_cgpa"]) if t.get("default_min_cgpa") is not None else None,
        default_eligible_branches=t.get("default_eligible_branches") or [],
        created_at=str(t.get("created_at", "")),
        updated_at=str(t.get("updated_at", "")),
    )


def _display_name(profile: dict) -> Optional[str]:
    if not profile:
        return None
    if profile.get("name"):
        return profile["name"]
    joined = " ".join(p for p in (profile.get("first_name") or "", profile.get("last_name") or "") if p).strip()
    return joined or None


# ═══════════════════════════ Drives ═══════════════════════════════════

@router.post("/jobs/{job_id}/drives", response_model=JobDriveOut, status_code=201)
def create_drive_route(
    job_id: str,
    payload: JobDriveIn,
    current_user: dict = Depends(require_company_role),
) -> JobDriveOut:
    company = _company(current_user)
    _owned_job(job_id, company["id"])

    if get_drive_for_job_college(job_id, payload.college_id):
        raise HTTPException(status_code=409, detail="This job already has a drive for that college.")

    try:
        drive = create_job_drive(job_id, {
            "college_id": payload.college_id,
            "status": "draft",
            "is_on_campus": payload.is_on_campus,
            "apply_deadline": payload.apply_deadline,
            "oa_window_start": payload.oa_window_start,
            "oa_window_end": payload.oa_window_end,
            "min_cgpa": payload.min_cgpa,
            "eligible_branches": payload.eligible_branches,
            "eligible_batch_years": payload.eligible_batch_years,
        })
        if not drive:
            raise HTTPException(status_code=400, detail="Failed to create drive.")
        if payload.rounds:
            replace_drive_rounds(drive["id"], [
                {
                    "round_number": r.round_number,
                    "round_type": r.round_type,
                    "mode": r.mode,
                    "window_start": r.window_start,
                    "window_end": r.window_end,
                }
                for r in payload.rounds
            ])
    except APIError as exc:
        log.error("DB error creating drive (job %s): %s", job_id, exc)
        raise HTTPException(status_code=400, detail=f"Failed to create drive: {exc.message}")

    names = get_college_names([drive["college_id"]])
    return _drive_out(drive, college_name=names.get(drive["college_id"]))


@router.get("/jobs/{job_id}/drives", response_model=List[JobDriveOut])
def list_drives_route(
    job_id: str,
    current_user: dict = Depends(require_company_role),
) -> List[JobDriveOut]:
    company = _company(current_user)
    _owned_job(job_id, company["id"])
    drives = list_drives_for_job(job_id)
    names = get_college_names([d["college_id"] for d in drives])
    return [
        _drive_out(
            d,
            college_name=names.get(d["college_id"]),
            applicant_count=_count_drive_applicants(job_id, d["college_id"]),
        )
        for d in drives
    ]


@router.get("/jobs/{job_id}/drives/{drive_id}", response_model=JobDriveOut)
def get_drive_route(
    job_id: str,
    drive_id: str,
    current_user: dict = Depends(require_company_role),
) -> JobDriveOut:
    company = _company(current_user)
    drive = _owned_drive(job_id, drive_id, company["id"])
    names = get_college_names([drive["college_id"]])
    return _drive_out(
        drive,
        college_name=names.get(drive["college_id"]),
        applicant_count=_count_drive_applicants(job_id, drive["college_id"]),
    )


@router.patch("/jobs/{job_id}/drives/{drive_id}", response_model=JobDriveOut)
def update_drive_route(
    job_id: str,
    drive_id: str,
    payload: JobDriveUpdateIn,
    current_user: dict = Depends(require_company_role),
) -> JobDriveOut:
    company = _company(current_user)
    _owned_drive(job_id, drive_id, company["id"])

    fields: dict = {}
    for attr in (
        "is_on_campus", "apply_deadline", "oa_window_start", "oa_window_end",
        "min_cgpa", "eligible_branches", "eligible_batch_years",
    ):
        val = getattr(payload, attr)
        if val is not None:
            fields[attr] = val

    try:
        drive = update_job_drive(drive_id, fields) if fields else _owned_drive(job_id, drive_id, company["id"])
    except APIError as exc:
        log.error("DB error updating drive %s: %s", drive_id, exc)
        raise HTTPException(status_code=400, detail=f"Update failed: {exc.message}")

    names = get_college_names([drive["college_id"]])
    return _drive_out(drive, college_name=names.get(drive["college_id"]))


@router.post("/jobs/{job_id}/drives/{drive_id}/publish", response_model=JobDriveOut)
def publish_drive_route(
    job_id: str,
    drive_id: str,
    current_user: dict = Depends(require_company_role),
) -> JobDriveOut:
    company = _company(current_user)
    drive = _owned_drive(job_id, drive_id, company["id"])

    rounds = list_rounds_for_drive(drive_id)
    missing = [r["round_number"] for r in rounds if not r.get("window_start") or not r.get("window_end")]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Set start/end windows for round(s) {sorted(missing)} before publishing.",
        )

    updated = update_job_drive(drive_id, {"status": "live"})
    names = get_college_names([drive["college_id"]])
    return _drive_out(updated, college_name=names.get(drive["college_id"]))


@router.post("/jobs/{job_id}/drives/{drive_id}/close", response_model=JobDriveOut)
def close_drive_route(
    job_id: str,
    drive_id: str,
    current_user: dict = Depends(require_company_role),
) -> JobDriveOut:
    company = _company(current_user)
    drive = _owned_drive(job_id, drive_id, company["id"])
    updated = update_job_drive(drive_id, {"status": "closed"})
    names = get_college_names([drive["college_id"]])
    return _drive_out(updated, college_name=names.get(drive["college_id"]))


@router.post("/jobs/{job_id}/drives/{drive_id}/clone", response_model=JobDriveOut, status_code=201)
def clone_drive_route(
    job_id: str,
    drive_id: str,
    payload: DriveCloneIn,
    current_user: dict = Depends(require_company_role),
) -> JobDriveOut:
    company = _company(current_user)
    _owned_drive(job_id, drive_id, company["id"])

    if get_drive_for_job_college(job_id, payload.target_college_id):
        raise HTTPException(status_code=409, detail="This job already has a drive for the target college.")

    try:
        new_drive = clone_drive(drive_id, payload.target_college_id, {
            "apply_deadline": payload.apply_deadline,
            "oa_window_start": payload.oa_window_start,
            "oa_window_end": payload.oa_window_end,
            "round_dates": payload.round_dates,
        })
    except APIError as exc:
        log.error("DB error cloning drive %s: %s", drive_id, exc)
        raise HTTPException(status_code=400, detail=f"Clone failed: {exc.message}")
    if not new_drive:
        raise HTTPException(status_code=400, detail="Clone failed.")

    names = get_college_names([new_drive["college_id"]])
    return _drive_out(new_drive, college_name=names.get(new_drive["college_id"]))


# ═══════════════════════════ Rounds ══════════════════════════════════

@router.post("/jobs/{job_id}/drives/{drive_id}/rounds", response_model=JobDriveRoundOut, status_code=201)
def add_round_route(
    job_id: str,
    drive_id: str,
    payload: JobDriveRoundIn,
    current_user: dict = Depends(require_company_role),
) -> JobDriveRoundOut:
    company = _company(current_user)
    _owned_drive(job_id, drive_id, company["id"])

    existing = list_rounds_for_drive(drive_id)
    next_num = len(existing) + 1
    if payload.round_number != next_num:
        raise HTTPException(
            status_code=400,
            detail=f"Round numbers must be gap-free — this drive's next round is {next_num}.",
        )
    try:
        created = create_drive_round(drive_id, {
            "round_number": payload.round_number,
            "round_type": payload.round_type,
            "mode": payload.mode,
            "window_start": payload.window_start,
            "window_end": payload.window_end,
        })
    except APIError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to add round: {exc.message}")
    return _round_out(created)


@router.patch("/jobs/{job_id}/drives/{drive_id}/rounds/{round_id}", response_model=JobDriveRoundOut)
def update_round_route(
    job_id: str,
    drive_id: str,
    round_id: str,
    payload: JobDriveRoundIn,
    current_user: dict = Depends(require_company_role),
) -> JobDriveRoundOut:
    company = _company(current_user)
    _owned_drive(job_id, drive_id, company["id"])
    rnd = get_drive_round(round_id)
    if not rnd or rnd["drive_id"] != drive_id:
        raise HTTPException(status_code=404, detail="Round not found.")
    try:
        updated = update_drive_round(round_id, {
            "round_type": payload.round_type,
            "mode": payload.mode,
            "window_start": payload.window_start,
            "window_end": payload.window_end,
        })
    except APIError as exc:
        raise HTTPException(status_code=400, detail=f"Update failed: {exc.message}")
    return _round_out(updated)


@router.get(
    "/jobs/{job_id}/drives/{drive_id}/rounds/{round_id}/applicants",
    response_model=List[RoundApplicantOut],
)
def round_applicants_route(
    job_id: str,
    drive_id: str,
    round_id: str,
    sort_by: str = "round_score",
    current_user: dict = Depends(require_company_role),
) -> List[RoundApplicantOut]:
    company = _company(current_user)
    drive = _owned_drive(job_id, drive_id, company["id"])
    rnd = get_drive_round(round_id)
    if not rnd or rnd["drive_id"] != drive_id:
        raise HTTPException(status_code=404, detail="Round not found.")

    rounds = list_rounds_for_drive(drive_id)
    prev = next((r for r in rounds if r["round_number"] == rnd["round_number"] - 1), None)

    apps = list_applications_for_job(job_id)
    college_by_student = get_profiles_college_map([a["student_id"] for a in apps])
    apps = [a for a in apps if college_by_student.get(a["student_id"]) == drive["college_id"]]
    if not apps:
        return []

    app_ids = [a["id"] for a in apps]
    rr_by_app = list_round_results_for_applications(app_ids)

    if prev:
        eligible_ids = {
            aid for aid, results in rr_by_app.items()
            if any(r["round_id"] == prev["id"] and r["status"] == "shortlisted" for r in results)
        }
        apps = [a for a in apps if a["id"] in eligible_ids]
        if not apps:
            return []

    analyses = get_analyses_for_job(job_id)
    profiles = get_profiles_basic([a["student_id"] for a in apps])

    rows: List[RoundApplicantOut] = []
    for a in apps:
        this_round = next(
            (r for r in rr_by_app.get(a["id"], []) if r["round_id"] == round_id), None
        )
        analysis = analyses.get(a["id"])
        profile = profiles.get(a["student_id"], {})
        rows.append(RoundApplicantOut(
            application_id=a["id"],
            student_id=a["student_id"],
            student_name=_display_name(profile),
            student_email=profile.get("email"),
            applied_at=str(a["applied_at"]),
            round_status=(this_round or {}).get("status", "pending"),
            round_score=(
                float(this_round["round_score"])
                if this_round and this_round.get("round_score") is not None else None
            ),
            placement_probability=float(analysis["placement_probability"]) if analysis else None,
            weighted_composite=float(analysis["weighted_composite"]) if analysis else None,
            has_analysis=analysis is not None,
            decided_at=str(this_round["decided_at"]) if this_round and this_round.get("decided_at") else None,
        ))

    # AI rounds rank by round_score; live rounds have no score — rank by
    # applied_at and the caller renders "rank manually".
    if rnd["mode"] == "ai" and sort_by == "round_score":
        rows.sort(key=lambda r: (r.round_score if r.round_score is not None else -1.0), reverse=True)
    else:
        rows.sort(key=lambda r: r.applied_at)
    return rows


@router.post(
    "/jobs/{job_id}/drives/{drive_id}/rounds/{round_id}/applicants/{application_id}/status",
    response_model=RoundApplicantOut,
)
def set_round_status_route(
    job_id: str,
    drive_id: str,
    round_id: str,
    application_id: str,
    payload: RoundStatusUpdateIn,
    current_user: dict = Depends(require_company_role),
) -> RoundApplicantOut:
    """The ONLY way application_round_results.status moves off 'pending'.
    Manual shortlist / reject. Never auto-advances the next round."""
    company = _company(current_user)
    drive = _owned_drive(job_id, drive_id, company["id"])
    rnd = get_drive_round(round_id)
    if not rnd or rnd["drive_id"] != drive_id:
        raise HTTPException(status_code=404, detail="Round not found.")

    apps = {a["id"]: a for a in list_applications_for_job(job_id)}
    app = apps.get(application_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found.")

    try:
        result = set_round_result_status(application_id, round_id, payload.status, current_user["id"])
    except APIError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to set status: {exc.message}")

    profile = get_profiles_basic([app["student_id"]]).get(app["student_id"], {})
    analysis = get_analyses_for_job(job_id).get(application_id)
    return RoundApplicantOut(
        application_id=application_id,
        student_id=app["student_id"],
        student_name=_display_name(profile),
        student_email=profile.get("email"),
        applied_at=str(app["applied_at"]),
        round_status=result["status"],
        round_score=float(result["round_score"]) if result.get("round_score") is not None else None,
        placement_probability=float(analysis["placement_probability"]) if analysis else None,
        weighted_composite=float(analysis["weighted_composite"]) if analysis else None,
        has_analysis=analysis is not None,
        decided_at=str(result["decided_at"]) if result.get("decided_at") else None,
    )


# ═══════════════════════ Drive templates ════════════════════════════

@router.post("/drive-templates", response_model=DriveTemplateOut, status_code=201)
def create_template_route(
    payload: DriveTemplateIn,
    current_user: dict = Depends(require_company_role),
) -> DriveTemplateOut:
    company = _company(current_user)
    try:
        created = create_drive_template(company["id"], {
            "name": payload.name,
            "interview_mode": payload.interview_mode,
            "rounds_json": [r.model_dump() for r in payload.rounds_json],
            "default_min_cgpa": payload.default_min_cgpa,
            "default_eligible_branches": payload.default_eligible_branches,
        })
    except APIError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to create template: {exc.message}")
    return _template_out(created)


@router.get("/drive-templates", response_model=List[DriveTemplateOut])
def list_templates_route(
    current_user: dict = Depends(require_company_role),
) -> List[DriveTemplateOut]:
    company = _company(current_user)
    return [_template_out(t) for t in list_drive_templates_for_company(company["id"])]


@router.post("/jobs/{job_id}/drives/{drive_id}/apply-template", response_model=JobDriveOut)
def apply_template_route(
    job_id: str,
    drive_id: str,
    payload: ApplyTemplateIn,
    current_user: dict = Depends(require_company_role),
) -> JobDriveOut:
    company = _company(current_user)
    drive = _owned_drive(job_id, drive_id, company["id"])

    tmpl = get_drive_template(payload.template_id)
    if not tmpl or tmpl["company_id"] != company["id"]:
        raise HTTPException(status_code=404, detail="Template not found.")

    try:
        updated = apply_template_to_drive(drive_id, payload.template_id, {
            "apply_deadline": payload.apply_deadline,
            "oa_window_start": payload.oa_window_start,
            "oa_window_end": payload.oa_window_end,
            "round_dates": [rd.model_dump() for rd in payload.round_dates],
        })
    except APIError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to apply template: {exc.message}")

    names = get_college_names([drive["college_id"]])
    return _drive_out(updated or drive, college_name=names.get(drive["college_id"]))


# ═══════════════════════ Dashboard funnel ═══════════════════════════

@router.get("/dashboard/funnel", response_model=CompanyFunnelOut)
def dashboard_funnel_route(
    current_user: dict = Depends(require_company_role),
) -> CompanyFunnelOut:
    company = _company(current_user)
    try:
        counts = get_company_funnel_counts(company["id"])
    except APIError as exc:
        log.error("DB error building funnel for company %s: %s", company["id"], exc)
        raise HTTPException(status_code=500, detail="Failed to load the dashboard funnel.")
    return CompanyFunnelOut(**counts)
