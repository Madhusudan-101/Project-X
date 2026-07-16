"""
Analyze Router — /api/v1/analyze
─────────────────────────────────
POST endpoint that chains:
    1. GitHub + LeetCode raw data fetchers
    2. The data formatter (token-efficient distillation)
    3. The Gemini analyzer agent (structured JSON analysis)

Returns the final ``AnalysisResult`` to the client.
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

from ..services.github_service import fetch_github_raw_for_analysis
from ..services.leetcode_service import fetch_leetcode_raw_for_analysis
from ..services.formatter import format_for_analysis, FormattedMetrics
from ..services.analyzer_agent import run_analysis, AnalysisResult
from ..services.resume_analyzer_agent import analyze_resume, ResumeAnalysisResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["analyze"])


# ── Request / Response models ─────────────────────────────────────────


class AnalyzeRequest(BaseModel):
    """Optional overrides — if omitted, the path ``{username}`` is used for both."""
    github_username: Optional[str] = Field(
        None, description="Override GitHub username (if different from path)."
    )
    leetcode_username: Optional[str] = Field(
        None, description="Override LeetCode username (if different from path)."
    )


class AnalyzeResponse(BaseModel):
    ok: bool
    username: str
    analysis: Optional[AnalysisResult] = None
    formatted_metrics: Optional[FormattedMetrics] = None
    warnings: list[str] = Field(default_factory=list)
    error: Optional[str] = None


# ── Endpoint ──────────────────────────────────────────────────────────


@router.post(
    "/analyze/{username}",
    response_model=AnalyzeResponse,
    summary="Run AI employability & authenticity analysis",
    responses={
        404: {"description": "User not found on either platform"},
        503: {"description": "Gemini API unavailable"},
    },
)
async def analyze_user(
    username: str,
    body: Optional[AnalyzeRequest] = None,
) -> AnalyzeResponse:
    """
    Fetch raw data from GitHub + LeetCode, format it, and run it
    through the Gemini analyzer agent. Returns a structured
    employability and authenticity assessment.
    """
    gh_user: str = (body.github_username if body and body.github_username else username)
    lc_user: str = (body.leetcode_username if body and body.leetcode_username else username)

    warnings: list[str] = []
    github_raw = None
    leetcode_raw = None

    # ── 1. Fetch raw data (tolerant — partial data is OK) ──

    try:
        github_raw = await fetch_github_raw_for_analysis(gh_user)
        logger.info("Fetched GitHub data for %s", gh_user)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            warnings.append(f"GitHub user '{gh_user}' not found — skipping.")
        elif exc.response.status_code == 403:
            warnings.append("GitHub API rate limit hit — skipping GitHub data.")
        else:
            warnings.append(f"GitHub API error ({exc.response.status_code}).")
        logger.warning("GitHub fetch failed for %s: %s", gh_user, exc)
    except httpx.TimeoutException:
        warnings.append("GitHub API timed out — skipping GitHub data.")
    except Exception as exc:
        warnings.append(f"GitHub fetch error: {exc}")
        logger.exception("Unexpected GitHub error for %s", gh_user)

    try:
        leetcode_raw = await fetch_leetcode_raw_for_analysis(lc_user)
        logger.info("Fetched LeetCode data for %s", lc_user)
    except ValueError:
        warnings.append(f"LeetCode user '{lc_user}' not found — skipping.")
    except httpx.HTTPStatusError as exc:
        warnings.append(f"LeetCode API error ({exc.response.status_code}).")
        logger.warning("LeetCode fetch failed for %s: %s", lc_user, exc)
    except httpx.TimeoutException:
        warnings.append("LeetCode API timed out — skipping LeetCode data.")
    except Exception as exc:
        warnings.append(f"LeetCode fetch error: {exc}")
        logger.exception("Unexpected LeetCode error for %s", lc_user)

    # ── Guard: need at least one platform ──

    if github_raw is None and leetcode_raw is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Could not retrieve data from either platform. "
                f"Warnings: {'; '.join(warnings)}"
            ),
        )

    # ── 2. Format ──

    formatted: FormattedMetrics = format_for_analysis(
        github_raw=github_raw,
        leetcode_raw=leetcode_raw,
    )

    # ── 3. Run Gemini analysis ──

    try:
        analysis: AnalysisResult = await run_analysis(formatted)
    except RuntimeError as exc:
        # Missing API key
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        # Invalid JSON from Gemini
        raise HTTPException(
            status_code=502,
            detail=f"Gemini returned unparseable output: {exc}",
        )
    except Exception as exc:
        logger.exception("Gemini analysis failed for %s", username)
        err_msg = str(exc)
        if "429" in err_msg or "quota" in err_msg.lower() or "exhausted" in err_msg.lower():
            raise HTTPException(
                status_code=429,
                detail="Gemini API rate limit or quota exceeded. Please wait a few seconds and try again.",
            )
        raise HTTPException(
            status_code=500,
            detail=f"AI analysis failed: {exc}",
        )

    return AnalyzeResponse(
        ok=True,
        username=username,
        analysis=analysis,
        formatted_metrics=formatted,
        warnings=warnings,
    )


@router.post(
    "/analyze-resume",
    response_model=ResumeAnalysisResult,
    summary="Upload and analyze a PDF resume against coding metrics",
)
async def analyze_resume_endpoint(
    file: UploadFile = File(...),
    target_role: str = Form(...),
    github_username: Optional[str] = Form(None),
    leetcode_username: Optional[str] = Form(None),
) -> ResumeAnalysisResult:
    """
    Accepts a PDF resume upload and a target tech role, fetches the corresponding
    GitHub and LeetCode portfolio data if usernames are provided, and runs the resume
    authenticity + role-fit analyzer.
    """
    # Verify file is a PDF
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF resume files are accepted."
        )

    try:
        resume_bytes = await file.read()
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to read uploaded resume file: {exc}"
        )

    github_raw = None
    leetcode_raw = None

    # Fetch GitHub metrics if username provided
    if github_username:
        try:
            github_raw = await fetch_github_raw_for_analysis(github_username)
        except Exception as exc:
            logger.warning("Failed to fetch GitHub raw metrics for resume analysis: %s", exc)

    # Fetch LeetCode metrics if username provided
    if leetcode_username:
        try:
            leetcode_raw = await fetch_leetcode_raw_for_analysis(leetcode_username)
        except Exception as exc:
            logger.warning("Failed to fetch LeetCode raw metrics for resume analysis: %s", exc)

    # Format the metrics
    formatted = format_for_analysis(github_raw, leetcode_raw)

    # Run analysis
    try:
        result = await analyze_resume(resume_bytes, formatted, target_role)
        return result
    except Exception as exc:
        logger.exception("Resume analysis failed")
        raise HTTPException(
            status_code=500,
            detail=f"Resume analysis failed: {exc}"
        )

