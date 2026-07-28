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

import asyncio
import logging
from typing import Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

from ..services.github_service import fetch_github_raw_for_analysis
from ..services.leetcode_service import fetch_leetcode_raw_for_analysis
from ..services.codeforces_service import fetch_codeforces_raw_for_analysis
from ..services.formatter import format_for_analysis, FormattedMetrics
from ..services.analyzer_agent import run_analysis, AnalysisResult
from ..services.resume_analyzer_agent import analyze_resume, extract_pdf_hyperlinks, ResumeAnalysisResult
from ..services.link_extraction import detect_profile_links

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
    codeforces_username: Optional[str] = Field(
        None, description="Codeforces handle, if the candidate linked one."
    )


class AnalyzeResponse(BaseModel):
    ok: bool
    username: str
    analysis: Optional[AnalysisResult] = None
    formatted_metrics: Optional[FormattedMetrics] = None
    warnings: list[str] = Field(default_factory=list)
    error: Optional[str] = None


class CombinedAnalysisResponse(BaseModel):
    """
    One unified analysis of a candidate: the resume-authenticity audit is
    always present; the profile/employability analysis is present only if
    at least one of GitHub/LeetCode/Codeforces resolved to real data.
    ``detected_profiles``/``missing_platforms`` drive the frontend's
    sequential "we didn't find your X — want to add it?" follow-up.
    """
    resume_analysis: ResumeAnalysisResult
    profile_analysis: Optional[AnalysisResult] = None
    detected_profiles: Dict[str, str] = Field(default_factory=dict)
    missing_platforms: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


async def _fetch_platforms_tolerant(
    github_username: Optional[str],
    leetcode_username: Optional[str],
    codeforces_username: Optional[str],
) -> tuple[Optional[dict], Optional[dict], Optional[dict], List[str]]:
    """
    Best-effort fetch of whichever of the three platforms have a username —
    a failure on any one platform is recorded as a warning, never fatal.
    """
    warnings: List[str] = []
    github_raw = leetcode_raw = codeforces_raw = None

    if github_username:
        try:
            github_raw = await fetch_github_raw_for_analysis(github_username)
        except Exception as exc:
            warnings.append(f"Could not fetch GitHub data for '{github_username}': {exc}")
            logger.warning("GitHub fetch failed for %s: %s", github_username, exc)

    if leetcode_username:
        try:
            leetcode_raw = await fetch_leetcode_raw_for_analysis(leetcode_username)
        except Exception as exc:
            warnings.append(f"Could not fetch LeetCode data for '{leetcode_username}': {exc}")
            logger.warning("LeetCode fetch failed for %s: %s", leetcode_username, exc)

    if codeforces_username:
        try:
            codeforces_raw = await fetch_codeforces_raw_for_analysis(codeforces_username)
        except Exception as exc:
            warnings.append(f"Could not fetch Codeforces data for '{codeforces_username}': {exc}")
            logger.warning("Codeforces fetch failed for %s: %s", codeforces_username, exc)

    return github_raw, leetcode_raw, codeforces_raw, warnings


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
    cf_user: Optional[str] = body.codeforces_username if body else None

    warnings: list[str] = []
    github_raw = None
    leetcode_raw = None
    codeforces_raw = None

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

    if cf_user:
        try:
            codeforces_raw = await fetch_codeforces_raw_for_analysis(cf_user)
            logger.info("Fetched Codeforces data for %s", cf_user)
        except ValueError:
            warnings.append(f"Codeforces handle '{cf_user}' not found — skipping.")
        except httpx.HTTPStatusError as exc:
            warnings.append(f"Codeforces API error ({exc.response.status_code}).")
            logger.warning("Codeforces fetch failed for %s: %s", cf_user, exc)
        except httpx.TimeoutException:
            warnings.append("Codeforces API timed out — skipping Codeforces data.")
        except Exception as exc:
            warnings.append(f"Codeforces fetch error: {exc}")
            logger.exception("Unexpected Codeforces error for %s", cf_user)

    # ── Guard: need at least one platform ──

    if github_raw is None and leetcode_raw is None and codeforces_raw is None:
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
        codeforces_raw=codeforces_raw,
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
        if "timeout" in err_msg.lower() or "deadline_exceeded" in err_msg.lower():
            raise HTTPException(
                status_code=504,
                detail="Gemini API timed out generating the analysis. Please try again.",
            )
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
    response_model=CombinedAnalysisResponse,
    summary="Upload a resume and get one unified authenticity + employability analysis",
)
async def analyze_resume_endpoint(
    file: UploadFile = File(...),
    target_role: str = Form(...),
    github_username: Optional[str] = Form(None),
    leetcode_username: Optional[str] = Form(None),
    codeforces_username: Optional[str] = Form(None),
) -> CombinedAnalysisResponse:
    """
    Accepts a PDF resume upload and a target tech role. GitHub/LeetCode/
    Codeforces usernames are all optional — whichever aren't explicitly
    provided are auto-detected from the resume's own embedded hyperlinks
    (e.g. a "GitHub" icon linking to the candidate's profile). Runs the
    resume-authenticity audit and the profile/employability analysis
    together and returns one combined result, plus which platforms
    (if any) had no username either provided or detected — the frontend
    uses this to ask the candidate to add them one at a time.
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

    # An explicitly-provided username always wins over one auto-detected from
    # the resume — this matters once the frontend's "add a missing platform"
    # follow-up starts resubmitting with a manually-entered username.
    links = extract_pdf_hyperlinks(resume_bytes)
    detected = detect_profile_links(links)

    gh_user = github_username or detected.get("github")
    lc_user = leetcode_username or detected.get("leetcode")
    cf_user = codeforces_username or detected.get("codeforces")

    detected_profiles: Dict[str, str] = {
        platform: user
        for platform, user in (("github", gh_user), ("leetcode", lc_user), ("codeforces", cf_user))
        if user
    }
    missing_platforms = [
        platform for platform in ("github", "leetcode", "codeforces")
        if platform not in detected_profiles
    ]

    github_raw, leetcode_raw, codeforces_raw, fetch_warnings = await _fetch_platforms_tolerant(
        gh_user, lc_user, cf_user
    )
    formatted = format_for_analysis(github_raw, leetcode_raw, codeforces_raw)
    has_any_profile_data = bool(github_raw or leetcode_raw or codeforces_raw)

    try:
        if has_any_profile_data:
            resume_result, profile_result = await asyncio.gather(
                analyze_resume(resume_bytes, formatted, target_role, gh_user),
                run_analysis(formatted),
            )
        else:
            resume_result = await analyze_resume(resume_bytes, formatted, target_role, gh_user)
            profile_result = None
    except Exception as exc:
        logger.exception("Combined resume analysis failed")
        err_msg = str(exc)
        if "timeout" in err_msg.lower() or "timed out" in err_msg.lower() or "deadline_exceeded" in err_msg.lower():
            raise HTTPException(
                status_code=504,
                detail="Gemini API timed out generating the analysis. Please try again.",
            )
        if "429" in err_msg or "quota" in err_msg.lower() or "exhausted" in err_msg.lower():
            raise HTTPException(
                status_code=429,
                detail="Gemini API rate limit or quota exceeded. Please wait a few seconds and try again.",
            )
        raise HTTPException(
            status_code=500,
            detail=f"Resume analysis failed: {exc}"
        )

    return CombinedAnalysisResponse(
        resume_analysis=resume_result,
        profile_analysis=profile_result,
        detected_profiles=detected_profiles,
        missing_platforms=missing_platforms,
        warnings=fetch_warnings,
    )

