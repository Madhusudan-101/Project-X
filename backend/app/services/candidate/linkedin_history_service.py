"""
LinkedIn Analysis History Service — linkedin_history_service.py
─────────────────────────────────────────────────────────────
Persists LinkedIn-analyzer runs (``linkedin_analyses`` table) and resolves
the current ``model_versions`` row, mirroring ``resume_history_service.py``.

Every read/write here uses the service-role Supabase client (``db_client``),
matching the table's RLS policy (service_role only) — no anon/authenticated
policy exists for ``linkedin_analyses``, so this must never be called with a
user-scoped client.
"""

from __future__ import annotations

import logging

from postgrest.exceptions import APIError
from supabase import Client

from ...deps import db_client
from .linkedin_analyzer_agent import SYSTEM_INSTRUCTION, LinkedInAnalysisResult

logger = logging.getLogger(__name__)

# Bump this whenever SYSTEM_INSTRUCTION changes materially, so past analyses
# stay attributable to the prompt version that actually produced them.
_MODEL_VERSION_LABEL = "linkedin-analyzer-v2"


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
                "change_notes": "Initial LinkedIn PDF-export analyzer, cross-checked against the resume analysis.",
            })
            .execute()
        )
    except APIError as exc:
        raise RuntimeError(f"Failed to create model_versions row: {exc.message}") from exc

    return created.data[0]["id"]


def save_linkedin_analysis(
    *,
    candidate_id: str,
    result: LinkedInAnalysisResult,
    latency_ms: int,
    sb: Client = db_client,
) -> None:
    """
    Persist a completed LinkedIn analysis. Best-effort: a failure here is
    logged, never raised, since it must not break the response already
    computed for the user.
    """
    try:
        model_version_id = get_or_create_model_version_id(sb)
        sb.table("linkedin_analyses").insert({
            "candidate_id": candidate_id,
            "model_version_id": model_version_id,
            "output_json": result.model_dump(mode="json"),
            "overall_score": result.overall_rating_score,
            "latency_ms": latency_ms,
        }).execute()
    except (APIError, RuntimeError) as exc:
        logger.warning("Failed to persist LinkedIn analysis for candidate %s: %s", candidate_id, exc)
