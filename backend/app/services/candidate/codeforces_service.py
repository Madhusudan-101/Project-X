"""
Codeforces API Fetcher
──────────────────────
Fetches a user's contest rating, rank, and full submission history from
the public Codeforces API — used to verify competitive-programming/DSA
claims alongside GitHub and LeetCode.

Endpoints
    GET https://codeforces.com/api/user.info?handles=<handle>
    GET https://codeforces.com/api/user.status?handle=<handle>&from=1&count=<n>
    GET https://codeforces.com/api/user.rating?handle=<handle>

Notes
    • The API wraps every response as {"status": "OK"|"FAILED", ...} —
      a non-"OK" status (e.g. unknown handle) must be checked explicitly,
      it isn't always reflected as a non-2xx HTTP status.
    • ``creationTimeSeconds`` / ``ratingUpdateTimeSeconds`` are UNIX
      timestamps (UTC).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

import httpx
from pydantic import BaseModel, Field

# ── Configuration ─────────────────────────────────────────────────────

CODEFORCES_API_BASE: str = "https://codeforces.com/api"
_REQUEST_TIMEOUT: float = 15.0
_MAX_SUBMISSIONS: int = 10_000

# ── Response Models ───────────────────────────────────────────────────


class CodeforcesStreakInfo(BaseModel):
    current_streak: int = Field(0, description="Consecutive days with ≥1 submission up to today.")
    longest_streak: int = Field(0, description="Longest streak found in submission history.")
    total_active_days: int = Field(0, description="Total days with at least one submission.")


class CodeforcesProfileData(BaseModel):
    """Normalised Codeforces profile payload returned to the caller."""
    handle: str
    rating: Optional[int] = None
    max_rating: Optional[int] = None
    rank: Optional[str] = None
    max_rank: Optional[str] = None
    contribution: int = 0
    contests_participated: int = 0
    total_solved: int = 0
    streak: CodeforcesStreakInfo = CodeforcesStreakInfo()


# ── Internal helpers ──────────────────────────────────────────────────


async def _api_get(client: httpx.AsyncClient, path: str, params: Dict[str, Any]) -> Dict[str, Any]:
    resp = await client.get(f"{CODEFORCES_API_BASE}/{path}", params=params, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    body: Dict[str, Any] = resp.json()
    if body.get("status") != "OK":
        raise ValueError(body.get("comment", f"Codeforces API request to '{path}' failed."))
    return body


def _unique_solved(submissions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Dedupe accepted submissions down to one entry per unique problem."""
    seen: Set[str] = set()
    solved: List[Dict[str, Any]] = []
    for sub in submissions:
        if sub.get("verdict") != "OK":
            continue
        problem: Dict[str, Any] = sub.get("problem", {})
        key = f"{problem.get('contestId')}-{problem.get('index')}"
        if key in seen:
            continue
        seen.add(key)
        solved.append(sub)
    return solved


def _submission_dates(submissions: List[Dict[str, Any]]) -> List[date]:
    dates: List[date] = []
    for sub in submissions:
        ts = sub.get("creationTimeSeconds")
        if not ts:
            continue
        try:
            dates.append(datetime.fromtimestamp(int(ts), tz=timezone.utc).date())
        except (ValueError, OSError):
            continue
    return dates


def _compute_streak(active_dates: List[date]) -> CodeforcesStreakInfo:
    if not active_dates:
        return CodeforcesStreakInfo()

    sorted_dates = sorted(set(active_dates))
    total_active_days = len(sorted_dates)

    today = datetime.now(timezone.utc).date()
    active_set = set(sorted_dates)

    current_streak = 0
    check_date = today
    if check_date not in active_set:
        check_date = today - timedelta(days=1)
    while check_date in active_set:
        current_streak += 1
        check_date -= timedelta(days=1)

    longest_streak = 1
    running = 1
    for i in range(1, len(sorted_dates)):
        if (sorted_dates[i] - sorted_dates[i - 1]).days == 1:
            running += 1
            longest_streak = max(longest_streak, running)
        else:
            running = 1

    return CodeforcesStreakInfo(
        current_streak=current_streak,
        longest_streak=longest_streak,
        total_active_days=total_active_days,
    )


# ── Service Functions ─────────────────────────────────────────────────


async def fetch_codeforces_profile(handle: str) -> CodeforcesProfileData:
    """
    High-level entry point — queries Codeforces for rating/rank plus
    solved-problem count and submission streak.

    Raises
    ------
    httpx.HTTPStatusError   – non-2xx from Codeforces.
    httpx.TimeoutException  – endpoint timed out.
    ValueError              – handle not found / API-level failure.
    """
    async with httpx.AsyncClient() as client:
        info_body = await _api_get(client, "user.info", {"handles": handle})
        status_body = await _api_get(client, "user.status", {"handle": handle, "from": 1, "count": _MAX_SUBMISSIONS})
        try:
            rating_body = await _api_get(client, "user.rating", {"handle": handle})
        except ValueError:
            rating_body = {"result": []}

    info: Dict[str, Any] = (info_body.get("result") or [{}])[0]
    submissions: List[Dict[str, Any]] = status_body.get("result", [])
    rating_history: List[Dict[str, Any]] = rating_body.get("result", [])

    solved = _unique_solved(submissions)
    streak = _compute_streak(_submission_dates(submissions))

    return CodeforcesProfileData(
        handle=info.get("handle", handle),
        rating=info.get("rating"),
        max_rating=info.get("maxRating"),
        rank=info.get("rank"),
        max_rank=info.get("maxRank"),
        contribution=info.get("contribution", 0),
        contests_participated=len(rating_history),
        total_solved=len(solved),
        streak=streak,
    )


async def fetch_codeforces_raw_for_analysis(handle: str) -> Dict[str, Any]:
    """
    Fetch raw Codeforces data needed by the formatter / analyzer.

    Returns a dict with:
      - ``handle``
      - ``info``            – raw user.info result object
      - ``solved_problems`` – deduped list of {name, rating, tags, contestId, index, solved_at}
      - ``submission_dates``– ISO-8601 date strings, one per submission (for activity metrics)
      - ``rating_history``  – list of {contestName, ratingUpdateTimeSeconds (iso), oldRating, newRating, rank}
    """
    async with httpx.AsyncClient() as client:
        info_body = await _api_get(client, "user.info", {"handles": handle})
        status_body = await _api_get(client, "user.status", {"handle": handle, "from": 1, "count": _MAX_SUBMISSIONS})
        try:
            rating_body = await _api_get(client, "user.rating", {"handle": handle})
        except ValueError:
            rating_body = {"result": []}

    info: Dict[str, Any] = (info_body.get("result") or [{}])[0]
    submissions: List[Dict[str, Any]] = status_body.get("result", [])
    raw_rating_history: List[Dict[str, Any]] = rating_body.get("result", [])

    solved_raw = _unique_solved(submissions)
    solved_problems: List[Dict[str, Any]] = []
    for sub in solved_raw:
        problem = sub.get("problem", {})
        ts = sub.get("creationTimeSeconds")
        solved_at = ""
        if ts:
            try:
                solved_at = datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
            except (ValueError, OSError):
                pass
        solved_problems.append({
            "name": problem.get("name", ""),
            "rating": problem.get("rating"),
            "tags": problem.get("tags", []),
            "contestId": problem.get("contestId"),
            "index": problem.get("index"),
            "solved_at": solved_at,
        })

    submission_dates = [d.isoformat() for d in _submission_dates(submissions)]

    rating_history: List[Dict[str, Any]] = []
    for entry in raw_rating_history:
        ts = entry.get("ratingUpdateTimeSeconds")
        iso_ts = ""
        if ts:
            try:
                iso_ts = datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
            except (ValueError, OSError):
                pass
        rating_history.append({
            "contestName": entry.get("contestName", ""),
            "ratingUpdateTimeSeconds": iso_ts,
            "oldRating": entry.get("oldRating"),
            "newRating": entry.get("newRating"),
            "rank": entry.get("rank"),
        })

    return {
        "handle": info.get("handle", handle),
        "info": info,
        "solved_problems": solved_problems,
        "submission_dates": submission_dates,
        "rating_history": rating_history,
    }