"""
Sync Router — /api/sync
────────────────────────
POST endpoints that trigger external profile fetches from GitHub and
LeetCode, returning normalised JSON payloads.

Error handling
    • 404  –  user not found on the external platform.
    • 504  –  upstream API timed out.
    • 502  –  unexpected upstream HTTP error.
    • 500  –  unhandled internal error.
"""

from __future__ import annotations

import logging
from typing import Union

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.github_service import GitHubProfileData, fetch_github_profile
from ..services.leetcode_service import LeetCodeProfileData, fetch_leetcode_profile
from ..services.codeforces_service import CodeforcesProfileData, fetch_codeforces_profile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sync", tags=["sync"])

# ── Generic envelope ──────────────────────────────────────────────────


class SyncResponse(BaseModel):
    """Wrapper so every sync endpoint returns a consistent shape."""
    ok: bool
    platform: str
    data: Union[GitHubProfileData, LeetCodeProfileData, CodeforcesProfileData, None] = None
    error: str | None = None


# ── GitHub ────────────────────────────────────────────────────────────


@router.post(
    "/github/{username}",
    response_model=SyncResponse,
    summary="Sync a GitHub profile",
    responses={
        404: {"description": "GitHub user not found"},
        504: {"description": "GitHub API timed out"},
        502: {"description": "Upstream GitHub error"},
    },
)
async def sync_github(username: str) -> SyncResponse:
    """Fetch public GitHub profile data for *username*."""
    try:
        profile: GitHubProfileData = await fetch_github_profile(username)
        return SyncResponse(ok=True, platform="github", data=profile)

    except httpx.HTTPStatusError as exc:
        status: int = exc.response.status_code
        if status == 404:
            raise HTTPException(
                status_code=404,
                detail=f"GitHub user '{username}' not found.",
            )
        if status == 403:
            logger.warning("GitHub API 403 for %s — rate limit or auth issue", username)
            raise HTTPException(
                status_code=429,
                detail="GitHub API rate limit exceeded. Please add a valid GITHUB_PAT to .env and restart the server.",
            )
        logger.error("GitHub API error for %s: %s", username, exc)
        raise HTTPException(
            status_code=502,
            detail=f"GitHub API returned {status}.",
        )

    except httpx.TimeoutException:
        logger.warning("GitHub API timeout for %s", username)
        raise HTTPException(
            status_code=504,
            detail="GitHub API timed out. Please try again later.",
        )

    except Exception as exc:
        logger.exception("Unexpected error syncing GitHub user %s", username)
        raise HTTPException(
            status_code=500,
            detail=f"Internal error: {exc}",
        )


# ── LeetCode ─────────────────────────────────────────────────────────


@router.post(
    "/leetcode/{username}",
    response_model=SyncResponse,
    summary="Sync a LeetCode profile",
    responses={
        404: {"description": "LeetCode user not found"},
        504: {"description": "LeetCode API timed out"},
        502: {"description": "Upstream LeetCode error"},
    },
)
async def sync_leetcode(username: str) -> SyncResponse:
    """Fetch LeetCode solve stats and streak for *username*."""
    try:
        profile: LeetCodeProfileData = await fetch_leetcode_profile(username)
        return SyncResponse(ok=True, platform="leetcode", data=profile)

    except ValueError:
        raise HTTPException(
            status_code=404,
            detail=f"LeetCode user '{username}' not found.",
        )

    except httpx.HTTPStatusError as exc:
        status: int = exc.response.status_code
        logger.error("LeetCode API error for %s: %s", username, exc)
        raise HTTPException(
            status_code=502,
            detail=f"LeetCode API returned {status}.",
        )

    except httpx.TimeoutException:
        logger.warning("LeetCode API timeout for %s", username)
        raise HTTPException(
            status_code=504,
            detail="LeetCode API timed out. Please try again later.",
        )

    except Exception as exc:
        logger.exception("Unexpected error syncing LeetCode user %s", username)
        raise HTTPException(
            status_code=500,
            detail=f"Internal error: {exc}",
        )


# ── Codeforces ───────────────────────────────────────────────────────


@router.post(
    "/codeforces/{handle}",
    response_model=SyncResponse,
    summary="Sync a Codeforces profile",
    responses={
        404: {"description": "Codeforces handle not found"},
        504: {"description": "Codeforces API timed out"},
        502: {"description": "Upstream Codeforces error"},
    },
)
async def sync_codeforces(handle: str) -> SyncResponse:
    """Fetch Codeforces rating, rank, and solve/consistency stats for *handle*."""
    try:
        profile: CodeforcesProfileData = await fetch_codeforces_profile(handle)
        return SyncResponse(ok=True, platform="codeforces", data=profile)

    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc) or f"Codeforces handle '{handle}' not found.",
        )

    except httpx.HTTPStatusError as exc:
        status: int = exc.response.status_code
        logger.error("Codeforces API error for %s: %s", handle, exc)
        raise HTTPException(
            status_code=502,
            detail=f"Codeforces API returned {status}.",
        )

    except httpx.TimeoutException:
        logger.warning("Codeforces API timeout for %s", handle)
        raise HTTPException(
            status_code=504,
            detail="Codeforces API timed out. Please try again later.",
        )

    except Exception as exc:
        logger.exception("Unexpected error syncing Codeforces handle %s", handle)
        raise HTTPException(
            status_code=500,
            detail=f"Internal error: {exc}",
        )
