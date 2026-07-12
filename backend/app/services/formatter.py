"""
Data Formatter — formatter.py
─────────────────────────────
Takes the *raw* GitHub and LeetCode JSON payloads and distils them into
a compact, token-efficient summary that the Gemini agent can analyse.

Key computations
    • Active days, gaps, and longest streaks (GitHub commits + LeetCode calendar)
    • Fork vs. original repo classification
    • Average commits per repository
    • Single-day spike detection (possible fake activity signal)
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Output Models (what gets sent to Gemini) ──────────────────────────


class RepoSummary(BaseModel):
    name: str
    is_fork: bool
    stars: int = 0
    size_kb: int = 0
    primary_language: Optional[str] = None
    created: str = ""            # YYYY-MM-DD
    last_push: str = ""          # YYYY-MM-DD
    days_since_last_push: int = 0


class ActivityMetrics(BaseModel):
    """Commit / submission activity patterns."""
    total_events: int = 0
    total_commits: int = 0
    unique_active_days: int = 0
    avg_per_active_day: float = 0.0
    longest_streak_days: int = 0
    current_streak_days: int = 0
    largest_gap_days: int = 0
    busiest_single_day: Dict[str, Any] = Field(default_factory=dict)
    days_with_10plus: int = Field(
        0, description="Days with ≥10 commits/submissions — possible spike."
    )
    day_of_week_distribution: Dict[str, int] = Field(default_factory=dict)


class GitHubMetrics(BaseModel):
    account_age_days: int = 0
    total_repos: int = 0
    original_repos: int = 0
    forked_repos: int = 0
    fork_ratio: float = 0.0
    total_stars_received: int = 0
    top_languages: List[str] = []
    repos: List[RepoSummary] = []
    recent_activity: ActivityMetrics = ActivityMetrics()
    commits_per_repo: Dict[str, int] = Field(
        default_factory=dict,
        description="Repo name → commit count from recent events.",
    )


class LeetCodeMetrics(BaseModel):
    total_solved: int = 0
    easy: int = 0
    medium: int = 0
    hard: int = 0
    easy_medium_hard_ratio: str = "0:0:0"
    submission_activity: ActivityMetrics = ActivityMetrics()


class FormattedMetrics(BaseModel):
    """Token-efficient summary consumed by the Gemini agent."""
    github: Optional[GitHubMetrics] = None
    leetcode: Optional[LeetCodeMetrics] = None


# ── Internal helpers ──────────────────────────────────────────────────

_DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _iso_to_date(iso: str) -> Optional[date]:
    """Parse an ISO-8601 timestamp to a ``date``; return *None* on failure."""
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        return None


def _compute_activity_metrics(
    day_counts: Dict[date, int],
) -> ActivityMetrics:
    """
    Given ``{date: count}`` produce streak / gap / spike metrics.
    Works for both GitHub commit days and LeetCode submission days.
    """
    if not day_counts:
        return ActivityMetrics()

    sorted_dates: List[date] = sorted(day_counts.keys())
    today: date = datetime.now(timezone.utc).date()

    # ── Totals ──
    total_events = sum(day_counts.values())
    unique_days = len(sorted_dates)
    avg = round(total_events / unique_days, 2) if unique_days else 0.0

    # ── Streaks & gaps ──
    longest_streak = 1
    current_streak = 0
    largest_gap = 0
    running = 1

    for i in range(1, len(sorted_dates)):
        delta = (sorted_dates[i] - sorted_dates[i - 1]).days
        if delta == 1:
            running += 1
            longest_streak = max(longest_streak, running)
        else:
            largest_gap = max(largest_gap, delta)
            running = 1

    # Current streak (walk back from today)
    check = today
    date_set = set(sorted_dates)
    if check not in date_set:
        check = today - timedelta(days=1)
    while check in date_set:
        current_streak += 1
        check -= timedelta(days=1)

    # ── Spikes ──
    busiest_date = max(day_counts, key=day_counts.get)  # type: ignore[arg-type]
    days_10plus = sum(1 for c in day_counts.values() if c >= 10)

    # ── Day-of-week distribution ──
    dow: Counter[str] = Counter()
    for d, c in day_counts.items():
        dow[_DOW_NAMES[d.weekday()]] += c

    return ActivityMetrics(
        total_events=total_events,
        total_commits=total_events,
        unique_active_days=unique_days,
        avg_per_active_day=avg,
        longest_streak_days=longest_streak if unique_days > 1 else (1 if unique_days == 1 else 0),
        current_streak_days=current_streak,
        largest_gap_days=largest_gap,
        busiest_single_day={
            "date": busiest_date.isoformat(),
            "count": day_counts[busiest_date],
        },
        days_with_10plus=days_10plus,
        day_of_week_distribution=dict(dow),
    )


# ── GitHub formatting ─────────────────────────────────────────────────


def _format_github(raw: Dict[str, Any]) -> GitHubMetrics:
    profile: Dict[str, Any] = raw.get("profile", {})
    repos_raw: List[Dict[str, Any]] = raw.get("repos", [])
    events_raw: List[Dict[str, Any]] = raw.get("events", [])

    today: date = datetime.now(timezone.utc).date()

    # ── Account age ──
    created = _iso_to_date(profile.get("created_at", ""))
    account_age = (today - created).days if created else 0

    # ── Repo classification ──
    originals = [r for r in repos_raw if not r.get("fork")]
    forks = [r for r in repos_raw if r.get("fork")]
    total = len(repos_raw)
    fork_ratio = round(len(forks) / total, 2) if total else 0.0

    total_stars = sum(r.get("stargazers_count", 0) for r in repos_raw)

    # Condensed language list
    lang_counter: Counter[str] = Counter()
    for r in repos_raw:
        lang = r.get("language")
        if lang:
            lang_counter[lang] += 1
    top_languages = [l for l, _ in lang_counter.most_common(8)]

    # Repo summaries (limit to 25 for token efficiency)
    repo_summaries: List[RepoSummary] = []
    for r in repos_raw[:25]:
        lp = _iso_to_date(r.get("pushed_at", ""))
        repo_summaries.append(
            RepoSummary(
                name=r.get("name", ""),
                is_fork=r.get("fork", False),
                stars=r.get("stargazers_count", 0),
                size_kb=r.get("size", 0),
                primary_language=r.get("language"),
                created=(_iso_to_date(r.get("created_at", "")) or today).isoformat(),
                last_push=(lp or today).isoformat(),
                days_since_last_push=(today - lp).days if lp else 0,
            )
        )

    # ── Commit events ──
    commit_day_counts: Dict[date, int] = {}
    commits_per_repo: Counter[str] = Counter()

    for ev in events_raw:
        if ev.get("type") != "PushEvent":
            continue
        ev_date = _iso_to_date(ev.get("created_at", ""))
        if not ev_date:
            continue
        n_commits = ev.get("payload", {}).get("size", 1)
        commit_day_counts[ev_date] = commit_day_counts.get(ev_date, 0) + n_commits
        repo_name = ev.get("repo", {}).get("name", "").split("/")[-1]
        commits_per_repo[repo_name] += n_commits

    activity = _compute_activity_metrics(commit_day_counts)

    return GitHubMetrics(
        account_age_days=account_age,
        total_repos=total,
        original_repos=len(originals),
        forked_repos=len(forks),
        fork_ratio=fork_ratio,
        total_stars_received=total_stars,
        top_languages=top_languages,
        repos=repo_summaries,
        recent_activity=activity,
        commits_per_repo=dict(commits_per_repo.most_common(15)),
    )


# ── LeetCode formatting ──────────────────────────────────────────────


def _format_leetcode(raw: Dict[str, Any]) -> LeetCodeMetrics:
    ac_stats: List[Dict[str, Any]] = raw.get("ac_stats", [])
    calendar: Dict[str, int] = raw.get("submission_calendar", {})

    # ── Difficulty breakdown ──
    mapping: Dict[str, int] = {}
    for entry in ac_stats:
        diff = entry.get("difficulty", "").lower().strip()
        count = int(entry.get("count", 0))
        mapping[diff] = count

    easy = mapping.get("easy", 0)
    medium = mapping.get("medium", 0)
    hard = mapping.get("hard", 0)
    total_solved = mapping.get("all", easy + medium + hard)
    total_nonzero = easy + medium + hard or 1
    ratio = (
        f"{round(easy / total_nonzero * 100)}:"
        f"{round(medium / total_nonzero * 100)}:"
        f"{round(hard / total_nonzero * 100)}"
    )

    # ── Calendar → day counts ──
    day_counts: Dict[date, int] = {}
    for ts_str, count in calendar.items():
        count_int = int(count)
        if count_int <= 0:
            continue
        try:
            d = datetime.fromtimestamp(int(ts_str), tz=timezone.utc).date()
            day_counts[d] = day_counts.get(d, 0) + count_int
        except (ValueError, OSError):
            continue

    activity = _compute_activity_metrics(day_counts)

    return LeetCodeMetrics(
        total_solved=total_solved,
        easy=easy,
        medium=medium,
        hard=hard,
        easy_medium_hard_ratio=ratio,
        submission_activity=activity,
    )


# ── Public entry point ────────────────────────────────────────────────


def format_for_analysis(
    github_raw: Optional[Dict[str, Any]] = None,
    leetcode_raw: Optional[Dict[str, Any]] = None,
) -> FormattedMetrics:
    """
    Distil raw GitHub + LeetCode payloads into a compact,
    token-efficient ``FormattedMetrics`` object.
    """
    return FormattedMetrics(
        github=_format_github(github_raw) if github_raw else None,
        leetcode=_format_leetcode(leetcode_raw) if leetcode_raw else None,
    )
