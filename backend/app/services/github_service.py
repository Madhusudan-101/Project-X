"""
GitHub REST API Fetcher
───────────────────────
Fetches user profile data and top-used languages from the public GitHub API.

Endpoints consumed
    GET /users/{username}
    GET /users/{username}/repos?per_page=100&sort=updated

Environment
    GITHUB_PAT  –  (optional) Personal Access Token; raises the rate limit
                    from 60 → 5 000 requests / hour.
"""

from __future__ import annotations

import os
from collections import Counter
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from pydantic import BaseModel, Field

# ── Configuration ─────────────────────────────────────────────────────

GITHUB_API_BASE: str = "https://api.github.com"
_REQUEST_TIMEOUT: float = 15.0  # seconds


def _build_headers() -> Dict[str, str]:
    """Build request headers, including a PAT when available."""
    headers: Dict[str, str] = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    pat: Optional[str] = os.getenv("GITHUB_PAT")
    if pat:
        headers["Authorization"] = f"Bearer {pat}"
    return headers


# ── Response Models ───────────────────────────────────────────────────

class GitHubLanguageStat(BaseModel):
    """A single language and its byte-count across all repos."""
    language: str
    bytes: int
    percentage: float = Field(
        ..., description="Share of total bytes across all repos."
    )


class GitHubProfileData(BaseModel):
    """Normalised GitHub profile payload returned to the caller."""
    username: str
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    public_repos: int
    followers: int
    following: int
    created_at: str  # ISO-8601
    account_age_days: int
    top_languages: List[GitHubLanguageStat] = []


# ── Service Functions ─────────────────────────────────────────────────

async def _fetch_user_profile(
    client: httpx.AsyncClient,
    username: str,
) -> Dict[str, Any]:
    """GET /users/{username} — raises on non-2xx."""
    url = f"{GITHUB_API_BASE}/users/{username}"
    resp = await client.get(url, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


async def _fetch_repos(
    client: httpx.AsyncClient,
    username: str,
) -> List[Dict[str, Any]]:
    """GET /users/{username}/repos — paginated up to 100 most-recently updated."""
    url = f"{GITHUB_API_BASE}/users/{username}/repos"
    params = {"per_page": 100, "sort": "updated", "type": "owner"}
    resp = await client.get(url, params=params, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


async def _fetch_repo_languages(
    client: httpx.AsyncClient,
    owner: str,
    repo: str,
) -> Dict[str, int]:
    """GET /repos/{owner}/{repo}/languages — returns {lang: bytes}."""
    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/languages"
    resp = await client.get(url, timeout=_REQUEST_TIMEOUT)
    if resp.status_code == 403:
        # Rate-limited or blocked — skip silently
        return {}
    resp.raise_for_status()
    return resp.json()


def _aggregate_languages(
    all_langs: List[Dict[str, int]],
    top_n: int = 8,
) -> List[GitHubLanguageStat]:
    """Merge language byte-counts from multiple repos and rank them."""
    counter: Counter[str] = Counter()
    for lang_map in all_langs:
        counter.update(lang_map)

    total: int = sum(counter.values())
    if total == 0:
        return []

    return [
        GitHubLanguageStat(
            language=lang,
            bytes=count,
            percentage=round((count / total) * 100, 2),
        )
        for lang, count in counter.most_common(top_n)
    ]


async def fetch_github_profile(
    username: str,
    *,
    include_languages: bool = True,
    max_lang_repos: int = 20,
) -> GitHubProfileData:
    """
    High-level entry point — fetches a GitHub user's profile and
    (optionally) their top languages.

    Parameters
    ----------
    username : str
        GitHub login handle.
    include_languages : bool
        If *True*, inspect up to ``max_lang_repos`` repos for language data.
    max_lang_repos : int
        Cap the number of repos inspected for language stats (saves API calls).

    Raises
    ------
    httpx.HTTPStatusError   – re-raised so the router can translate to 404 / 500.
    httpx.TimeoutException  – external API timed out.
    """
    headers: Dict[str, str] = _build_headers()

    async with httpx.AsyncClient(headers=headers) as client:
        # 1. Core profile
        profile: Dict[str, Any] = await _fetch_user_profile(client, username)

        # 2. Repos + languages
        top_languages: List[GitHubLanguageStat] = []
        if include_languages:
            repos: List[Dict[str, Any]] = await _fetch_repos(client, username)
            lang_maps: List[Dict[str, int]] = []
            for repo in repos[:max_lang_repos]:
                lang_map = await _fetch_repo_languages(
                    client, username, repo["name"]
                )
                if lang_map:
                    lang_maps.append(lang_map)
            top_languages = _aggregate_languages(lang_maps)

        # 3. Compute account age
        created_at: str = profile.get("created_at", "")
        account_age_days: int = 0
        if created_at:
            created_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            account_age_days = (
                datetime.now(created_dt.tzinfo) - created_dt
            ).days

        return GitHubProfileData(
            username=profile.get("login", username),
            name=profile.get("name"),
            avatar_url=profile.get("avatar_url"),
            bio=profile.get("bio"),
            public_repos=profile.get("public_repos", 0),
            followers=profile.get("followers", 0),
            following=profile.get("following", 0),
            created_at=created_at,
            account_age_days=account_age_days,
            top_languages=top_languages,
        )


# ── Raw data for the AI Analyzer ──────────────────────────────────────

async def _fetch_events(
    client: httpx.AsyncClient,
    username: str,
    *,
    max_pages: int = 3,
) -> List[Dict[str, Any]]:
    """Fetch up to *max_pages* × 100 recent public events."""
    all_events: List[Dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        url = f"{GITHUB_API_BASE}/users/{username}/events/public"
        params = {"per_page": 100, "page": page}
        resp = await client.get(url, params=params, timeout=_REQUEST_TIMEOUT)
        if resp.status_code in (404, 403):
            break
        resp.raise_for_status()
        events: List[Dict[str, Any]] = resp.json()
        if not events:
            break
        all_events.extend(events)
    return all_events


async def _fetch_repo_commits(
    client: httpx.AsyncClient,
    owner: str,
    repo: str,
) -> List[str]:
    """
    GET /repos/{owner}/{repo}/commits?per_page=100

    Returns a list of ISO-8601 ``commit.author.date`` strings.
    Silently returns [] on 403 (rate limit), 404, or 409 (empty repo).
    """
    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/commits"
    params = {"per_page": 100}
    resp = await client.get(url, params=params, timeout=_REQUEST_TIMEOUT)
    if resp.status_code in (403, 404, 409):
        return []
    resp.raise_for_status()

    dates: List[str] = []
    for commit_obj in resp.json():
        try:
            dt_str = commit_obj["commit"]["author"]["date"]
            dates.append(dt_str)
        except (KeyError, TypeError):
            continue
    return dates


async def _fetch_repo_readme(
    client: httpx.AsyncClient,
    owner: str,
    repo: str,
    *,
    max_chars: int = 2000,
) -> Optional[str]:
    """
    GET /repos/{owner}/{repo}/readme  (raw markdown via Accept header).

    Returns the raw README text truncated to *max_chars*, or *None* if
    the repo has no README or the request is rate-limited.
    """
    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/readme"
    headers = {"Accept": "application/vnd.github.v3.raw"}
    resp = await client.get(url, headers=headers, timeout=_REQUEST_TIMEOUT)
    if resp.status_code in (403, 404):
        return None
    resp.raise_for_status()
    text: str = resp.text
    return text[:max_chars] if len(text) > max_chars else text


async def fetch_github_raw_for_analysis(username: str) -> Dict[str, Any]:
    """
    Fetch *all* raw GitHub data needed by the formatter / analyzer.

    Returns a dict with:
      - ``profile``       – full user object
      - ``repos``         – list of repo objects (includes ``fork`` bool, sizes, timestamps)
      - ``events``        – list of recent public events (PushEvent, etc.)
      - ``repo_commits``  – {repo_name: [ISO-8601 commit date strings]}
      - ``repo_readmes``  – {repo_name: raw markdown text}
    """
    headers: Dict[str, str] = _build_headers()

    async with httpx.AsyncClient(headers=headers) as client:
        profile = await _fetch_user_profile(client, username)
        repos = await _fetch_repos(client, username)
        events = await _fetch_events(client, username)

        # Deep per-repo data: commit timelines + READMEs
        # Limit to 15 most-recently-updated owner repos to conserve API calls
        owner_repos = [r for r in repos if not r.get("fork")][:15]

        repo_commits: Dict[str, List[str]] = {}
        repo_readmes: Dict[str, str] = {}

        for repo in owner_repos:
            name: str = repo.get("name", "")
            if not name:
                continue

            commits = await _fetch_repo_commits(client, username, name)
            if commits:
                repo_commits[name] = commits

            readme = await _fetch_repo_readme(client, username, name)
            if readme:
                repo_readmes[name] = readme

    return {
        "profile": profile,
        "repos": repos,
        "events": events,
        "repo_commits": repo_commits,
        "repo_readmes": repo_readmes,
    }

