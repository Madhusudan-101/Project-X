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
    commit_dates: List[str] = Field(
        default_factory=list,
        description="ISO-8601 commit timestamps from the repo's history.",
    )
    readme_snippet: Optional[str] = Field(
        None, description="Raw README markdown text (truncated to ~2000 chars).",
    )


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


class TopicTagEntry(BaseModel):
    """Single tag solve count (e.g. 'Dynamic Programming': 12 solved)."""
    tagName: str
    problemsSolved: int = 0


class TopicTagBreakdown(BaseModel):
    """Per-tier algorithmic tag solve counts."""
    advanced: List[TopicTagEntry] = Field(default_factory=list)
    intermediate: List[TopicTagEntry] = Field(default_factory=list)
    fundamental: List[TopicTagEntry] = Field(default_factory=list)


class RecentSubmission(BaseModel):
    """A single recent accepted LeetCode submission."""
    title: str
    titleSlug: str
    timestamp: str  # ISO-8601


class LeetCodeMetrics(BaseModel):
    total_solved: int = 0
    easy: int = 0
    medium: int = 0
    hard: int = 0
    easy_medium_hard_ratio: str = "0:0:0"
    submission_activity: ActivityMetrics = ActivityMetrics()
    recent_submissions: List[RecentSubmission] = Field(
        default_factory=list,
        description="Last 50 accepted submissions with timestamps.",
    )
    topic_tags: Optional[TopicTagBreakdown] = Field(
        None, description="Algorithmic category solve map by skill tier.",
    )


class CodeforcesRatingChange(BaseModel):
    """A single rated-contest result."""
    contest_name: str
    date: str  # YYYY-MM-DD
    old_rating: int = 0
    new_rating: int = 0
    rank: int = 0


class CodeforcesSolvedProblem(BaseModel):
    """A single unique solved problem."""
    name: str
    rating: Optional[int] = Field(None, description="Codeforces difficulty rating of the problem (e.g. 800-3500).")
    tags: List[str] = Field(default_factory=list)
    solved_at: str = ""  # ISO-8601


class CodeforcesMetrics(BaseModel):
    handle: str = ""
    rating: Optional[int] = None
    max_rating: Optional[int] = None
    rank: Optional[str] = None
    max_rank: Optional[str] = None
    total_solved: int = 0
    contests_participated: int = 0
    avg_problem_rating: Optional[int] = Field(
        None, description="Average difficulty rating across unique solved problems."
    )
    top_tags: List[str] = Field(
        default_factory=list, description="Most-solved problem tags/topics, most frequent first."
    )
    submission_activity: ActivityMetrics = ActivityMetrics()
    rating_history: List[CodeforcesRatingChange] = Field(default_factory=list)
    solved_problems: List[CodeforcesSolvedProblem] = Field(
        default_factory=list,
        description="Unique solved problems, most recent first (capped for token efficiency).",
    )


class FormattedMetrics(BaseModel):
    """Token-efficient summary consumed by the Gemini agent."""
    github: Optional[GitHubMetrics] = None
    leetcode: Optional[LeetCodeMetrics] = None
    codeforces: Optional[CodeforcesMetrics] = None


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

    # Deep per-repo data from the raw payload
    repo_commits: Dict[str, List[str]] = raw.get("repo_commits", {})
    repo_readmes: Dict[str, str] = raw.get("repo_readmes", {})

    # Repo summaries (limit to 25 for token efficiency)
    repo_summaries: List[RepoSummary] = []
    for r in repos_raw[:25]:
        lp = _iso_to_date(r.get("pushed_at", ""))
        rname = r.get("name", "")
        repo_summaries.append(
            RepoSummary(
                name=rname,
                is_fork=r.get("fork", False),
                stars=r.get("stargazers_count", 0),
                size_kb=r.get("size", 0),
                primary_language=r.get("language"),
                created=(_iso_to_date(r.get("created_at", "")) or today).isoformat(),
                last_push=(lp or today).isoformat(),
                days_since_last_push=(today - lp).days if lp else 0,
                commit_dates=repo_commits.get(rname, []),
                readme_snippet=repo_readmes.get(rname),
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

    # ── Recent submissions ──
    raw_subs: List[Dict[str, Any]] = raw.get("recent_submissions", [])
    recent_submissions = [
        RecentSubmission(
            title=s.get("title", ""),
            titleSlug=s.get("titleSlug", ""),
            timestamp=s.get("timestamp", ""),
        )
        for s in raw_subs
    ]

    # ── Topic tags ──
    raw_tags: Optional[Dict[str, Any]] = raw.get("topic_tags")
    topic_tags: Optional[TopicTagBreakdown] = None
    if raw_tags:
        topic_tags = TopicTagBreakdown(
            advanced=[
                TopicTagEntry(tagName=t.get("tagName", ""), problemsSolved=t.get("problemsSolved", 0))
                for t in raw_tags.get("advanced", [])
            ],
            intermediate=[
                TopicTagEntry(tagName=t.get("tagName", ""), problemsSolved=t.get("problemsSolved", 0))
                for t in raw_tags.get("intermediate", [])
            ],
            fundamental=[
                TopicTagEntry(tagName=t.get("tagName", ""), problemsSolved=t.get("problemsSolved", 0))
                for t in raw_tags.get("fundamental", [])
            ],
        )

    return LeetCodeMetrics(
        total_solved=total_solved,
        easy=easy,
        medium=medium,
        hard=hard,
        easy_medium_hard_ratio=ratio,
        submission_activity=activity,
        recent_submissions=recent_submissions,
        topic_tags=topic_tags,
    )


# ── Codeforces formatting ────────────────────────────────────────────


def _format_codeforces(raw: Dict[str, Any]) -> CodeforcesMetrics:
    info: Dict[str, Any] = raw.get("info", {})
    solved_raw: List[Dict[str, Any]] = raw.get("solved_problems", [])
    submission_dates_raw: List[str] = raw.get("submission_dates", [])
    rating_history_raw: List[Dict[str, Any]] = raw.get("rating_history", [])

    # ── Activity metrics from submission dates ──
    day_counts: Dict[date, int] = {}
    for iso in submission_dates_raw:
        d = _iso_to_date(iso)
        if d:
            day_counts[d] = day_counts.get(d, 0) + 1
    activity = _compute_activity_metrics(day_counts)

    # ── Tag frequency across unique solved problems ──
    tag_counter: Counter[str] = Counter()
    ratings: List[int] = []
    for p in solved_raw:
        for tag in p.get("tags", []):
            tag_counter[tag] += 1
        if p.get("rating"):
            ratings.append(p["rating"])
    top_tags = [t for t, _ in tag_counter.most_common(10)]
    avg_rating = round(sum(ratings) / len(ratings)) if ratings else None

    # Most-recent 40 solved problems, for token efficiency
    solved_sorted = sorted(solved_raw, key=lambda p: p.get("solved_at", ""), reverse=True)[:40]
    solved_problems = [
        CodeforcesSolvedProblem(
            name=p.get("name", ""),
            rating=p.get("rating"),
            tags=p.get("tags", []),
            solved_at=p.get("solved_at", ""),
        )
        for p in solved_sorted
    ]

    rating_history = [
        CodeforcesRatingChange(
            contest_name=r.get("contestName", ""),
            date=(_iso_to_date(r.get("ratingUpdateTimeSeconds", "")) or date.today()).isoformat(),
            old_rating=r.get("oldRating", 0),
            new_rating=r.get("newRating", 0),
            rank=r.get("rank", 0),
        )
        for r in rating_history_raw
    ]

    return CodeforcesMetrics(
        handle=info.get("handle", raw.get("handle", "")),
        rating=info.get("rating"),
        max_rating=info.get("maxRating"),
        rank=info.get("rank"),
        max_rank=info.get("maxRank"),
        total_solved=len(solved_raw),
        contests_participated=len(rating_history_raw),
        avg_problem_rating=avg_rating,
        top_tags=top_tags,
        submission_activity=activity,
        rating_history=rating_history,
        solved_problems=solved_problems,
    )


# ── Public entry point ────────────────────────────────────────────────


def format_for_analysis(
    github_raw: Optional[Dict[str, Any]] = None,
    leetcode_raw: Optional[Dict[str, Any]] = None,
    codeforces_raw: Optional[Dict[str, Any]] = None,
) -> FormattedMetrics:
    """
    Distil raw GitHub + LeetCode + Codeforces payloads into a compact,
    token-efficient ``FormattedMetrics`` object.
    """
    return FormattedMetrics(
        github=_format_github(github_raw) if github_raw else None,
        leetcode=_format_leetcode(leetcode_raw) if leetcode_raw else None,
        codeforces=_format_codeforces(codeforces_raw) if codeforces_raw else None,
    )
