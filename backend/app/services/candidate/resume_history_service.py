"""
Resume Analysis History Service — resume_history_service.py
─────────────────────────────────────────────────────────────
Persists resume-analyzer runs (``resume_analyses`` table) and resolves the
current ``model_versions`` row, so ``resume_analyzer_agent.analyze_resume``
can look up a candidate's most recent analysis and diff a re-uploaded resume
against it instead of always running a full audit.

Every read/write here uses the service-role Supabase client (``db_client``),
matching the table's RLS policy (service_role only) — no anon/authenticated
policy exists for ``resume_analyses`` yet, so this must never be called with
a user-scoped client.
"""

from __future__ import annotations

import logging
from typing import Optional

from postgrest.exceptions import APIError
from supabase import Client

from ...deps import db_client
from .formatter import FormattedMetrics
from .resume_analyzer_agent import (
    SYSTEM_INSTRUCTION,
    PreviousAnalysisContext,
    ResumeAnalysisResult,
)

logger = logging.getLogger(__name__)

# Bump this whenever SYSTEM_INSTRUCTION changes materially, so past analyses
# stay attributable to the prompt version that actually produced them.
_MODEL_VERSION_LABEL = "resume-analyzer-diff-v2"


def get_or_create_model_version_id(sb: Client = db_client) -> str:
    """Return the id of the current prompt's ``model_versions`` row, creating it on first use."""
    try:
        existing = (
            sb.table("model_versions")
            .select("id")
            .eq("version_label", _MODEL_VERSION_LABEL)
            .limit(1)
            .execute()
        )
    except APIError as exc:
        raise RuntimeError(f"Failed to look up model_versions: {exc.message}") from exc

    if existing.data:
        return existing.data[0]["id"]

    try:
        created = (
            sb.table("model_versions")
            .insert({
                "version_label": _MODEL_VERSION_LABEL,
                "prompt_text": SYSTEM_INSTRUCTION,
                "change_notes": (
                    "Adds diff-based incremental re-analysis: an unchanged or lightly-edited "
                    "re-upload patches the previous result instead of a full re-audit."
                ),
            })
            .execute()
        )
    except APIError as exc:
        raise RuntimeError(f"Failed to create model_versions row: {exc.message}") from exc

    return created.data[0]["id"]


def load_previous_analysis(
    candidate_id: str,
    sb: Client = db_client,
) -> Optional[PreviousAnalysisContext]:
    """
    Fetch a candidate's most recent real-user resume analysis, if one exists
    and is complete enough to diff against (has resume text, portfolio
    metrics, and a valid output). Returns None otherwise — the caller then
    falls back to a full analysis.
    """
    try:
        res = (
            sb.table("resume_analyses")
            .select("parsed_resume_text, portfolio_metrics_json, output_json, role_target")
            .eq("candidate_id", candidate_id)
            .eq("source", "real_user")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except APIError as exc:
        logger.warning("Failed to load previous resume analysis for %s: %s", candidate_id, exc.message)
        return None

    if not res.data:
        return None

    row = res.data[0]
    if not row.get("parsed_resume_text") or row.get("portfolio_metrics_json") is None or not row.get("output_json"):
        return None

    try:
        return PreviousAnalysisContext(
            resume_text=row["parsed_resume_text"],
            result=ResumeAnalysisResult.model_validate(row["output_json"]),
            portfolio=row["portfolio_metrics_json"],
            role_target=row["role_target"],
        )
    except Exception:
        logger.warning(
            "Stored analysis for candidate %s failed validation — ignoring for incremental diff.",
            candidate_id,
            exc_info=True,
        )
        return None


def save_analysis(
    *,
    candidate_id: str,
    role_target: str,
    resume_text: str,
    portfolio: FormattedMetrics,
    result: ResumeAnalysisResult,
    latency_ms: int,
    sb: Client = db_client,
) -> None:
    """
    Persist a completed analysis so the next re-upload from this candidate
    can diff against it. Best-effort: a failure here is logged, never raised,
    since it must not break the response already computed for the user.
    """
    try:
        model_version_id = get_or_create_model_version_id(sb)
        sb.table("resume_analyses").insert({
            "candidate_id": candidate_id,
            "model_version_id": model_version_id,
            "role_target": role_target,
            "source": "real_user",
            "parsed_resume_text": resume_text,
            "portfolio_metrics_json": portfolio.model_dump(mode="json"),
            "output_json": result.model_dump(mode="json"),
            "overall_score": result.overall_rating.score,
            "latency_ms": latency_ms,
        }).execute()
    except (APIError, RuntimeError) as exc:
        logger.warning("Failed to persist resume analysis for candidate %s: %s", candidate_id, exc)
