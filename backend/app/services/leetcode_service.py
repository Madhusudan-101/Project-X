"""
LeetCode GraphQL Fetcher
─────────────────────────
Fetches a user's problem-solving stats and active streak from the
LeetCode public GraphQL endpoint.

Endpoint
    POST https://leetcode.com/graphql

Notes
    • A realistic User-Agent header is mandatory — LeetCode blocks
      requests that look like automated scrapers.
    • The submissionCalendar is a JSON-encoded dict mapping UNIX
      timestamps (midnight UTC) → number of submissions that day.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import httpx
from pydantic import BaseModel, Field

# ── Configuration ─────────────────────────────────────────────────────

LEETCODE_GRAPHQL_URL: str = "https://leetcode.com/graphql"
_REQUEST_TIMEOUT: float = 15.0

_HEADERS: Dict[str, str] = {
    "Content-Type": "application/json",
    "Referer": "https://leetcode.com",
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
}

# ── GraphQL Queries ───────────────────────────────────────────────────

_USER_PROFILE_QUERY: str = """
query getUserProfile($username: String!) {
    matchedUser(username: $username) {
        username
        profile {
            realName
            ranking
            userAvatar
        }
        submitStatsGlobal {
            acSubmissionNum {
                difficulty
                count
            }
        }
        submissionCalendar
    }
}
"""

# ── Response Models ───────────────────────────────────────────────────


class LeetCodeDifficultyBreakdown(BaseModel):
    """Solved counts per difficulty tier."""
    all: int = Field(0, description="Total accepted problems.")
    easy: int = 0
    medium: int = 0
    hard: int = 0


class LeetCodeStreakInfo(BaseModel):
    """Current active-submission streak."""
    current_streak: int = Field(
        0, description="Consecutive days with ≥1 submission up to today."
    )
    longest_streak: int = Field(
        0, description="Longest streak found in the calendar."
    )
    total_active_days: int = Field(
        0, description="Total days with at least one submission."
    )


class LeetCodeProfileData(BaseModel):
    """Normalised LeetCode profile payload returned to the caller."""
    username: str
    real_name: Optional[str] = None
    ranking: Optional[int] = None
    avatar_url: Optional[str] = None
    total_solved: int = 0
    breakdown: LeetCodeDifficultyBreakdown = LeetCodeDifficultyBreakdown()
    streak: LeetCodeStreakInfo = LeetCodeStreakInfo()


# ── Streak Calculation ────────────────────────────────────────────────


def _compute_streak(calendar_json: Optional[str]) -> LeetCodeStreakInfo:
    """
    Parse the ``submissionCalendar`` JSON string and derive streak stats.

    The calendar maps **stringified UNIX timestamps** (midnight UTC) to
    the number of submissions on that day, e.g.::

        {"1720310400": 3, "1720396800": 1, ...}
    """
    if not calendar_json:
        return LeetCodeStreakInfo()

    try:
        raw: Dict[str, int] = json.loads(calendar_json)
    except (json.JSONDecodeError, TypeError):
        return LeetCodeStreakInfo()

    if not raw:
        return LeetCodeStreakInfo()

    # Convert timestamps to ``date`` objects
    active_dates = sorted(
        {
            datetime.fromtimestamp(int(ts), tz=timezone.utc).date()
            for ts, count in raw.items()
            if int(count) > 0
        }
    )

    total_active_days: int = len(active_dates)
    if total_active_days == 0:
        return LeetCodeStreakInfo()

    # ── Walk backwards from today to compute the current streak ──
    today = datetime.now(timezone.utc).date()

    # Build a set for O(1) lookups
    active_set = set(active_dates)

    current_streak: int = 0
    check_date = today
    # Allow "today" to not yet have a submission — start from yesterday
    if check_date not in active_set:
        check_date = today - timedelta(days=1)

    while check_date in active_set:
        current_streak += 1
        check_date -= timedelta(days=1)

    # ── Walk all dates to find the longest streak ──
    longest_streak: int = 1
    running: int = 1
    for i in range(1, len(active_dates)):
        if (active_dates[i] - active_dates[i - 1]).days == 1:
            running += 1
            longest_streak = max(longest_streak, running)
        else:
            running = 1

    return LeetCodeStreakInfo(
        current_streak=current_streak,
        longest_streak=longest_streak,
        total_active_days=total_active_days,
    )


# ── Difficulty Parsing ────────────────────────────────────────────────


def _parse_difficulty(
    ac_list: list[Dict[str, Any]],
) -> LeetCodeDifficultyBreakdown:
    """Map the ``acSubmissionNum`` array to a typed breakdown."""
    mapping: Dict[str, int] = {}
    for entry in ac_list:
        diff: str = entry.get("difficulty", "").lower().strip()
        count: int = int(entry.get("count", 0))
        mapping[diff] = count

    return LeetCodeDifficultyBreakdown(
        all=mapping.get("all", 0),
        easy=mapping.get("easy", 0),
        medium=mapping.get("medium", 0),
        hard=mapping.get("hard", 0),
    )


# ── Service Function ─────────────────────────────────────────────────


async def fetch_leetcode_profile(username: str) -> LeetCodeProfileData:
    """
    High-level entry point — queries LeetCode for the user's solve
    stats and computes their active streak.

    Raises
    ------
    httpx.HTTPStatusError   – non-2xx from LeetCode.
    httpx.TimeoutException  – endpoint timed out.
    ValueError              – user not found (``matchedUser`` is null).
    """
    payload: Dict[str, Any] = {
        "query": _USER_PROFILE_QUERY,
        "variables": {"username": username},
    }

    async with httpx.AsyncClient(headers=_HEADERS) as client:
        resp = await client.post(
            LEETCODE_GRAPHQL_URL,
            json=payload,
            timeout=_REQUEST_TIMEOUT,
        )
        resp.raise_for_status()

    body: Dict[str, Any] = resp.json()
    data: Optional[Dict[str, Any]] = body.get("data", {}).get("matchedUser")

    if data is None:
        raise ValueError(f"LeetCode user '{username}' not found.")

    profile: Dict[str, Any] = data.get("profile", {})
    ac_list: list[Dict[str, Any]] = (
        data.get("submitStatsGlobal", {}).get("acSubmissionNum", [])
    )
    calendar_json: Optional[str] = data.get("submissionCalendar")

    breakdown: LeetCodeDifficultyBreakdown = _parse_difficulty(ac_list)
    streak: LeetCodeStreakInfo = _compute_streak(calendar_json)

    return LeetCodeProfileData(
        username=data.get("username", username),
        real_name=profile.get("realName"),
        ranking=profile.get("ranking"),
        avatar_url=profile.get("userAvatar"),
        total_solved=breakdown.all,
        breakdown=breakdown,
        streak=streak,
    )


# ── Raw data for the AI Analyzer ──────────────────────────────────────

async def fetch_leetcode_raw_for_analysis(username: str) -> Dict[str, Any]:
    """
    Fetch raw LeetCode data needed by the formatter / analyzer.

    Returns a dict with:
      - ``username``
      - ``submission_calendar`` – dict of {unix_ts_str: count}
      - ``ac_stats``           – list of {difficulty, count}
      - ``profile``            – {realName, ranking, userAvatar}
    """
    payload: Dict[str, Any] = {
        "query": _USER_PROFILE_QUERY,
        "variables": {"username": username},
    }

    async with httpx.AsyncClient(headers=_HEADERS) as client:
        resp = await client.post(
            LEETCODE_GRAPHQL_URL,
            json=payload,
            timeout=_REQUEST_TIMEOUT,
        )
        resp.raise_for_status()

    body: Dict[str, Any] = resp.json()
    data: Optional[Dict[str, Any]] = body.get("data", {}).get("matchedUser")

    if data is None:
        raise ValueError(f"LeetCode user '{username}' not found.")

    calendar_json: Optional[str] = data.get("submissionCalendar")
    raw_calendar: Dict[str, int] = {}
    if calendar_json:
        try:
            raw_calendar = json.loads(calendar_json)
        except (json.JSONDecodeError, TypeError):
            pass

    return {
        "username": data.get("username", username),
        "submission_calendar": raw_calendar,
        "ac_stats": data.get("submitStatsGlobal", {}).get("acSubmissionNum", []),
        "profile": data.get("profile", {}),
    }

