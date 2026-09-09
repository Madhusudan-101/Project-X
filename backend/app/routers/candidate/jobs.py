"""Candidate jobs router — /candidate/jobs

Steps 2 & 3: the student job board (filtered by domain + college
visibility), the JD detail page, the Apply action (which kicks off the
job-scoped scoring run), and the student's own application tracker.

Every read is scoped to the caller: a student only ever sees Live jobs
visible to them, their own applications, and their own analyses.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from postgrest.exceptions import APIError

from ...deps import db_client, require_candidate_role
from ...schemas import (
    ApplicationAnalysisOut,
    ApplicationOut,
    ApplicationRoundResultOut,
    JobBoardCardOut,
    JobDetailOut,
    JobDriveRoundOut,
)
from ...crud import (
    compute_eligibility,
    create_application,
    get_application,
    get_application_analysis,
    get_application_by_student_job,
    get_company_names,
    get_drive_for_job_college,
    get_job,
    get_job_skill_names,
    get_profile_eligibility_fields,
    list_applications_for_student,
    list_live_drives_for_student,
    list_round_results_for_application,
    list_round_results_for_applications,
    list_rounds_for_drive,
    list_rounds_for_drives,
    set_application_status,
)
from ...services.candidate.application_scoring_service import (
    run_scoring_for_application,
    student_has_scoring_inputs,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/candidate/jobs", tags=["candidate-jobs"])

_SUMMARY_LEN = 240


def _summary(description: str) -> str:
    text = " ".join((description or "").split())
    return text if len(text) <= _SUMMARY_LEN else text[:_SUMMARY_LEN].rstrip() + "…"


# ── GET /candidate/jobs  (the job board) ────────────────────────────

@router.get("", response_model=List[JobBoardCardOut])
def job_board_route(
    current_user: dict = Depends(require_candidate_role),
) -> List[JobBoardCardOut]:
    # Drive-aware board: live drives at the student's own college whose
    # apply_deadline has not passed, joined to their job. A student who
    # onboarded before the domain field existed (domain=None) skips domain
    # filtering rather than getting an empty board.
    domain = current_user.get("domain")
    college_id = current_user.get("college_id")
    try:
        pairs = list_live_drives_for_student(college_id, domain)
        company_names = get_company_names([p["job"]["company_id"] for p in pairs])
        applied_job_ids = {
            a["job_id"] for a in list_applications_for_student(current_user["id"])
        }
        profile = get_profile_eligibility_fields(current_user["id"])
    except APIError as exc:
        log.error("DB error building job board for %s: %s", current_user["id"], exc)
        raise HTTPException(status_code=500, detail="Failed to load the job board.")

    cards: List[JobBoardCardOut] = []
    for p in pairs:
        j, d = p["job"], p["drive"]
        eligible, _ = compute_eligibility(d, profile)
        cards.append(JobBoardCardOut(
            id=j["id"],
            title=j["title"],
            company_name=company_names.get(j["company_id"], "A company"),
            location=j["location"],
            domain=j["domain"],
            experience_level=j["experience_level"],
            deadline=str(d["apply_deadline"]),
            summary=_summary(j["description"]),
            already_applied=j["id"] in applied_job_ids,
            employment_type=j.get("employment_type", "full-time"),
            ctc_min=j.get("ctc_min"),
            ctc_max=j.get("ctc_max"),
            ctc_currency=j.get("ctc_currency") or "INR",
            is_on_campus=bool(d.get("is_on_campus", True)),
            eligible=eligible,
        ))
    return cards


# ── GET /candidate/jobs/options/colleges ───────────────────────────
# Same list a company picks a drive's college from (public.colleges), so a
# student's saved college resolves to the SAME row a drive is attached to.
# Declared before /{job_id} so "options" is never captured as a job id.

@router.get("/options/colleges")
def list_colleges_route(
    current_user: dict = Depends(require_candidate_role),
) -> list:
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


# ── GET /candidate/jobs/applications  (student's tracker) ───────────
# Declared before /{job_id} so "applications" is never captured as a job id.

@router.get("/applications", response_model=List[ApplicationOut])
def my_applications_route(
    current_user: dict = Depends(require_candidate_role),
) -> List[ApplicationOut]:
    college_id = current_user.get("college_id")
    try:
        applications = list_applications_for_student(current_user["id"])
        job_ids = [a["job_id"] for a in applications]
        jobs = {jid: get_job(jid) for jid in set(job_ids)}
        company_names = get_company_names(
            [j["company_id"] for j in jobs.values() if j]
        )
        # "Round X of Y" progress — drive per job (at the student's college)
        # + this student's per-round results.
        drives = {
            jid: get_drive_for_job_college(jid, college_id) for jid in set(job_ids)
        }
        rounds_by_drive = list_rounds_for_drives(
            [d["id"] for d in drives.values() if d]
        )
        rr_by_app = list_round_results_for_applications([a["id"] for a in applications])
    except APIError as exc:
        log.error("DB error listing applications for %s: %s", current_user["id"], exc)
        raise HTTPException(status_code=500, detail="Failed to load your applications.")

    out: List[ApplicationOut] = []
    for a in applications:
        job = jobs.get(a["job_id"]) or {}
        analysis = get_application_analysis(a["id"])
        drive = drives.get(a["job_id"])
        total_rounds = len(rounds_by_drive.get(drive["id"], [])) if drive else None
        current_round = None
        if total_rounds:
            shortlisted = sum(
                1 for r in rr_by_app.get(a["id"], []) if r["status"] == "shortlisted"
            )
            current_round = min(shortlisted + 1, total_rounds)
        out.append(ApplicationOut(
            id=a["id"],
            student_id=a["student_id"],
            job_id=a["job_id"],
            company_id=a["company_id"],
            status=a["status"],
            applied_at=str(a["applied_at"]),
            updated_at=str(a["updated_at"]),
            job_title=job.get("title"),
            company_name=company_names.get(job.get("company_id"), None),
            placement_probability=(
                float(analysis["placement_probability"]) if analysis else None
            ),
            current_round=current_round,
            total_rounds=total_rounds,
        ))
    return out


# ── GET /candidate/jobs/applications/{application_id}  (own analysis) ─

@router.get("/applications/{application_id}", response_model=ApplicationAnalysisOut)
def my_application_analysis_route(
    application_id: str,
    current_user: dict = Depends(require_candidate_role),
) -> ApplicationAnalysisOut:
    application = get_application(application_id)
    if not application or application["student_id"] != current_user["id"]:
        # Same 404 for missing and someone else's — no existence leak.
        raise HTTPException(status_code=404, detail="Application not found.")

    analysis = get_application_analysis(application_id)
    if not analysis:
        raise HTTPException(status_code=409, detail="Scoring is not complete yet.")

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


def _visible_job_and_drive(job_id: str, current_user: dict) -> tuple[dict, dict]:
    """A student sees a job only through a LIVE drive at their own college
    whose job is also live and in their domain. Same 404 for every miss —
    no existence leak."""
    job = get_job(job_id)
    if not job or job.get("status") != "live":
        raise HTTPException(status_code=404, detail="Job not found.")
    if current_user.get("domain") and job["domain"] != current_user["domain"]:
        raise HTTPException(status_code=404, detail="Job not found.")
    drive = get_drive_for_job_college(job_id, current_user.get("college_id"))
    if not drive or drive.get("status") != "live":
        raise HTTPException(status_code=404, detail="Job not found.")
    return job, drive


def _drive_rounds_out(drive_id: str) -> List[JobDriveRoundOut]:
    return [
        JobDriveRoundOut(
            id=r["id"],
            drive_id=r["drive_id"],
            round_number=r["round_number"],
            round_type=r["round_type"],
            mode=r["mode"],
            window_start=str(r["window_start"]) if r.get("window_start") else None,
            window_end=str(r["window_end"]) if r.get("window_end") else None,
        )
        for r in list_rounds_for_drive(drive_id)
    ]


# ── GET /candidate/jobs/applications/{application_id}/rounds ────────

@router.get(
    "/applications/{application_id}/rounds",
    response_model=List[ApplicationRoundResultOut],
)
def my_application_rounds_route(
    application_id: str,
    current_user: dict = Depends(require_candidate_role),
) -> List[ApplicationRoundResultOut]:
    """The student's own per-round results. Round N+1 is only revealed once
    round N's status for them is 'shortlisted'."""
    application = get_application(application_id)
    if not application or application["student_id"] != current_user["id"]:
        raise HTTPException(status_code=404, detail="Application not found.")

    drive = get_drive_for_job_college(application["job_id"], current_user.get("college_id"))
    if not drive:
        return []
    rounds = list_rounds_for_drive(drive["id"])
    results = {r["round_id"]: r for r in list_round_results_for_application(application_id)}

    out: List[ApplicationRoundResultOut] = []
    for rnd in sorted(rounds, key=lambda r: r["round_number"]):
        rr = results.get(rnd["id"])
        status = (rr or {}).get("status", "pending")
        out.append(ApplicationRoundResultOut(
            id=(rr or {}).get("id", ""),
            application_id=application_id,
            round_id=rnd["id"],
            round_number=rnd["round_number"],
            round_type=rnd["round_type"],
            mode=rnd["mode"],
            status=status,
            round_score=(
                float(rr["round_score"]) if rr and rr.get("round_score") is not None else None
            ),
            decided_at=str(rr["decided_at"]) if rr and rr.get("decided_at") else None,
            window_start=str(rnd["window_start"]) if rnd.get("window_start") else None,
            window_end=str(rnd["window_end"]) if rnd.get("window_end") else None,
        ))
        # Stop revealing once this round isn't a pass-through.
        if status != "shortlisted":
            break
    return out


# ── GET /candidate/jobs/{job_id}  (JD detail) ──────────────────────

@router.get("/{job_id}", response_model=JobDetailOut)
def job_detail_route(
    job_id: str,
    current_user: dict = Depends(require_candidate_role),
) -> JobDetailOut:
    job, drive = _visible_job_and_drive(job_id, current_user)

    company_names = get_company_names([job["company_id"]])
    existing = get_application_by_student_job(current_user["id"], job_id)
    profile = get_profile_eligibility_fields(current_user["id"])
    eligible, reason = compute_eligibility(drive, profile)

    return JobDetailOut(
        id=job["id"],
        title=job["title"],
        company_name=company_names.get(job["company_id"], "A company"),
        location=job["location"],
        domain=job["domain"],
        experience_level=job["experience_level"],
        deadline=str(drive["apply_deadline"]),
        summary=_summary(job["description"]),
        already_applied=existing is not None,
        description=job["description"],
        required_skills=get_job_skill_names(job_id),
        openings_count=int(job.get("openings_count", 1)),
        application_status=existing["status"] if existing else None,
        employment_type=job.get("employment_type", "full-time"),
        ctc_min=job.get("ctc_min"),
        ctc_max=job.get("ctc_max"),
        ctc_currency=job.get("ctc_currency") or "INR",
        stipend_min=job.get("stipend_min"),
        stipend_max=job.get("stipend_max"),
        internship_duration_months=job.get("internship_duration_months"),
        ppo_ctc_min=job.get("ppo_ctc_min"),
        ppo_ctc_max=job.get("ppo_ctc_max"),
        perks=job.get("perks") or [],
        is_on_campus=bool(drive.get("is_on_campus", True)),
        interview_mode=job.get("interview_mode", "ai"),
        eligible=eligible,
        ineligible_reason=None if eligible else reason,
        drive_id=drive["id"],
        apply_deadline=str(drive["apply_deadline"]),
        oa_window_start=str(drive["oa_window_start"]) if drive.get("oa_window_start") else None,
        oa_window_end=str(drive["oa_window_end"]) if drive.get("oa_window_end") else None,
        rounds=_drive_rounds_out(drive["id"]),
    )


# ── POST /candidate/jobs/{job_id}/apply ────────────────────────────

@router.post("/{job_id}/apply", response_model=ApplicationOut, status_code=201)
def apply_route(
    job_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_candidate_role),
) -> ApplicationOut:
    job, drive = _visible_job_and_drive(job_id, current_user)

    # Hard eligibility gate — never let an ineligible application through
    # only to reject it later.
    profile = get_profile_eligibility_fields(current_user["id"])
    eligible, reason = compute_eligibility(drive, profile)
    if not eligible:
        raise HTTPException(status_code=403, detail=reason or "You are not eligible for this drive.")

    if get_application_by_student_job(current_user["id"], job_id):
        raise HTTPException(status_code=409, detail="You have already applied to this job.")

    # Scoring needs the student's cached resume analysis as input.
    if not student_has_scoring_inputs(current_user["id"]):
        raise HTTPException(
            status_code=409,
            detail="Run your resume analysis first — the job score is built from it.",
        )

    try:
        application = create_application(current_user["id"], job_id, job["company_id"])
    except APIError as exc:
        if "duplicate key" in str(exc).lower() or getattr(exc, "code", "") == "23505":
            raise HTTPException(status_code=409, detail="You have already applied to this job.")
        log.error("DB error creating application (student %s, job %s): %s",
                  current_user["id"], job_id, exc)
        raise HTTPException(status_code=400, detail="Could not submit your application.")

    if not application:
        raise HTTPException(status_code=400, detail="Could not submit your application.")

    # Optimistically flip to 'scoring' so the tracker shows processing
    # immediately; the background task owns the rest of the lifecycle.
    set_application_status(application["id"], "scoring")
    background_tasks.add_task(run_scoring_for_application, application["id"])

    return ApplicationOut(
        id=application["id"],
        student_id=application["student_id"],
        job_id=application["job_id"],
        company_id=application["company_id"],
        status="scoring",
        applied_at=str(application["applied_at"]),
        updated_at=str(application["updated_at"]),
        job_title=job["title"],
    )
