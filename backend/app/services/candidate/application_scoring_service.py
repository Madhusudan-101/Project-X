"""
Application Scoring Service — application_scoring_service.py
───────────────────────────────────────────────────────────
Orchestrates one job-scoped scoring run for a single application:

    application → job → job_weights → job_skills
                            +
    student's latest resume_analyses row (resume text + cached portfolio
    metrics + prior audit)
                            ↓
    job_scoring_agent.score_application(...)  — weighted per THIS job
                            ↓
    application_analyses row, keyed by application_id (unique), with the
    exact weights snapshot used; applications.status → scored

Runs in a FastAPI BackgroundTask so the Apply request returns immediately
with status='scoring'. Every failure path resets status to 'applied' and
never leaves a half-written analysis.
"""

from __future__ import annotations

import logging
from typing import Optional

from postgrest.exceptions import APIError

from ...deps import db_client
from . import job_scoring_agent
from .job_scoring_agent import compute_weighted_composite, score_application
from .interview_signal_service import get_mock_interview_signal
from .resume_history_service import load_previous_analysis
from ...crud import (
    get_application,
    get_job,
    get_job_skill_names,
    get_job_weights,
    set_application_status,
    upsert_application_analysis,
)

logger = logging.getLogger(__name__)


class NoResumeAnalysisError(Exception):
    """The student has never run a resume analysis, so there is nothing to
    score. The Apply route checks for this synchronously and returns 409."""


def student_has_scoring_inputs(student_id: str) -> bool:
    return load_previous_analysis(student_id) is not None


def _get_job_scoring_model_version_id() -> Optional[str]:
    """Look up (or create) the model_versions row for the current job-scoring
    prompt, so every analysis is attributable to the prompt that produced it."""
    label = job_scoring_agent.MODEL_VERSION_LABEL
    try:
        existing = (
            db_client.table("model_versions")
            .select("id")
            .eq("version_label", label)
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0]["id"]
        created = (
            db_client.table("model_versions")
            .insert({
                "version_label": label,
                "prompt_text": job_scoring_agent.SYSTEM_INSTRUCTION,
                "change_notes": "Job-scoped per-application scoring engine (5-dimension, weighted per job_weights).",
            })
            .execute()
        )
        return created.data[0]["id"] if created.data else None
    except APIError as exc:
        logger.warning("Could not resolve job-scoring model_versions row: %s", exc)
        return None


async def run_scoring_for_application(application_id: str) -> None:
    """Entry point for the BackgroundTask. Self-contained: logs and resets
    status on any failure, raises nothing."""
    app_row = get_application(application_id)
    if not app_row:
        logger.warning("Scoring skipped — application %s not found.", application_id)
        return

    try:
        job = get_job(app_row["job_id"])
        weights = get_job_weights(app_row["job_id"])
        if not job or not weights:
            logger.error(
                "Scoring aborted for application %s — job or job_weights missing.",
                application_id,
            )
            set_application_status(application_id, "applied")
            return

        prev = load_previous_analysis(app_row["student_id"])
        if prev is None:
            logger.error(
                "Scoring aborted for application %s — student %s has no resume analysis.",
                application_id, app_row["student_id"],
            )
            set_application_status(application_id, "applied")
            return

        set_application_status(application_id, "scoring")

        required_skills = get_job_skill_names(app_row["job_id"])
        # General mock-interview signal (None when the student has no
        # completed AI Interview Studio sessions — dimensions.interview then
        # stays null, unchanged from before).
        mock_interview_signal = get_mock_interview_signal(app_row["student_id"])
        result = await score_application(
            resume_text=prev.resume_text,
            portfolio_metrics=prev.portfolio,
            prior_resume_audit=prev.result,
            job=job,
            required_skills=required_skills,
            weights=weights,
            mock_interview_signal=mock_interview_signal,
        )
        composite = compute_weighted_composite(result.dimensions, weights)

        weights_snapshot = {
            "resume_weight": weights["resume_weight"],
            "github_weight": weights["github_weight"],
            "leetcode_weight": weights["leetcode_weight"],
            "interview_weight": weights["interview_weight"],
            "assessment_weight": weights["assessment_weight"],
        }

        upsert_application_analysis({
            "application_id": application_id,
            "student_id": app_row["student_id"],
            "job_id": app_row["job_id"],
            "company_id": app_row["company_id"],
            "model_version_id": _get_job_scoring_model_version_id(),
            "analysis_json": result.model_dump(mode="json"),
            "placement_probability": result.placement_probability,
            "weighted_composite": composite,
            "weights_snapshot": weights_snapshot,
        })

        set_application_status(application_id, "scored")
        logger.info(
            "Scored application %s (job %s, student %s): composite=%.2f p=%d",
            application_id, app_row["job_id"], app_row["student_id"],
            composite, result.placement_probability,
        )
    except Exception:  # noqa: BLE001 — background task must never bubble
        logger.exception("Scoring failed for application %s — resetting to 'applied'.", application_id)
        try:
            set_application_status(application_id, "applied")
        except Exception:  # noqa: BLE001
            logger.exception("Could not reset status for application %s.", application_id)
