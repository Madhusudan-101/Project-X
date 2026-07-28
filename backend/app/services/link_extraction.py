"""
Profile Link Extraction — link_extraction.py
─────────────────────────────────────────────
Parses candidate profile usernames/handles out of hyperlink URLs (e.g. the
hrefs behind a resume's "GitHub"/"LeetCode"/"Codeforces" icons, extracted via
``resume_analyzer_agent.extract_pdf_hyperlinks``).

These mirror the URL-parsing heuristics already used client-side in
``frontend/src/services/api/sync.ts`` (``extractGitHubUsername`` etc.), but
are stricter: the inputs here are always full hrefs pulled from a PDF's link
annotations — never raw, user-typed text — so there is no "bare username"
fallback, and the GitHub matcher requires an EXACT 1-segment path so it can
never collide with a 2-segment project-repo link (see
``resume_analyzer_agent._GITHUB_REPO_URL_RE``).
"""

from __future__ import annotations

from typing import Dict, List, Optional
from urllib.parse import urlparse

# Path segments that look like a 1-segment "profile" URL but are actually
# GitHub platform pages, not a candidate's account.
_GITHUB_NON_PROFILE_SEGMENTS = {
    "orgs", "sponsors", "settings", "notifications", "marketplace",
    "features", "about", "pricing", "topics", "search", "issues", "pulls",
}


def _path_segments(url: str) -> List[str]:
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return []
    return [seg for seg in parsed.path.split("/") if seg]


def extract_github_username(url: str) -> Optional[str]:
    """
    A GitHub *profile* link — exactly one path segment, e.g.
    ``https://github.com/veedhee2304`` — deliberately excludes 2-segment
    ``github.com/OWNER/REPO`` project links, which are project evidence, not
    a declared account.
    """
    try:
        hostname = (urlparse(url.strip()).hostname or "").lower()
    except ValueError:
        return None
    if not (hostname == "github.com" or hostname.endswith(".github.com")):
        return None
    segments = _path_segments(url)
    if len(segments) != 1:
        return None
    username = segments[0]
    if username.lower() in _GITHUB_NON_PROFILE_SEGMENTS:
        return None
    return username


def extract_leetcode_username(url: str) -> Optional[str]:
    """Handles ``leetcode.com/u/<name>`` and ``leetcode.com/<name>``."""
    try:
        hostname = (urlparse(url.strip()).hostname or "").lower()
    except ValueError:
        return None
    if not (hostname == "leetcode.com" or hostname.endswith(".leetcode.com")):
        return None
    segments = _path_segments(url)
    if len(segments) >= 2 and segments[0].lower() == "u":
        return segments[1]
    if len(segments) >= 1:
        return segments[-1]
    return None


def extract_codeforces_handle(url: str) -> Optional[str]:
    """Handles ``codeforces.com/profile/<handle>``."""
    try:
        hostname = (urlparse(url.strip()).hostname or "").lower()
    except ValueError:
        return None
    if not (hostname == "codeforces.com" or hostname.endswith(".codeforces.com")):
        return None
    segments = _path_segments(url)
    if len(segments) >= 2 and segments[0].lower() == "profile":
        return segments[1]
    return None


def detect_profile_links(urls: List[str]) -> Dict[str, str]:
    """
    Scan every extracted hyperlink and return the first GitHub/LeetCode/
    Codeforces profile match found for each platform. Only platforms that
    were actually found are present as keys.
    """
    detected: Dict[str, str] = {}
    for url in urls:
        if "github" not in detected:
            gh = extract_github_username(url)
            if gh:
                detected["github"] = gh
        if "leetcode" not in detected:
            lc = extract_leetcode_username(url)
            if lc:
                detected["leetcode"] = lc
        if "codeforces" not in detected:
            cf = extract_codeforces_handle(url)
            if cf:
                detected["codeforces"] = cf
        if len(detected) == 3:
            break
    return detected
