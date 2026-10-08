"""
Portfolio verification for Model Lab.

Mirrors what the production flow does before calling the resume analyzer
(app/routers/candidate/analyze.py): find GitHub / LeetCode / Codeforces profile
links in the resume, fetch the real data with the app's own services, and
format it into the same `FormattedMetrics` the models get in production.

Runs ONCE per run, before any model, so every model is judged on identical
verified data. On top of that it builds plain-text notes that tell the model
exactly which platforms were verified, which links were missing (→ must be
flagged) and which fetches failed (→ must NOT be treated as a false claim).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

from app.services.candidate import resume_analyzer_agent as rs
from app.services.candidate.codeforces_service import fetch_codeforces_raw_for_analysis
from app.services.candidate.formatter import format_for_analysis
from app.services.candidate.github_service import fetch_github_raw_for_analysis
from app.services.candidate.leetcode_service import fetch_leetcode_raw_for_analysis
from app.services.candidate.link_extraction import detect_profile_links

PLATFORMS = ("github", "leetcode", "codeforces")
_LABEL = {"github": "GitHub", "leetcode": "LeetCode", "codeforces": "Codeforces"}
_URL_RE = re.compile(r"(?:https?://)?(?:www\.)?(?:github\.com|leetcode\.com|codeforces\.com|linkedin\.com)/[^\s)>\]\"',;]+", re.I)


@dataclass
class PortfolioResult:
    metrics_json: str = ""  # FormattedMetrics JSON, "" if nothing could be fetched
    notes: List[str] = field(default_factory=list)  # extra prompt blocks
    report: Dict[str, Any] = field(default_factory=dict)  # shown in the dashboard


def _urls_from_text(text: str) -> List[str]:
    """Links printed as plain text (no PDF link annotation) — normalise to https://."""
    out = []
    for m in _URL_RE.findall(text or ""):
        u = m.rstrip(".")
        out.append(u if u.lower().startswith("http") else "https://" + u)
    return out


async def _fetch(platform: str, user: str) -> tuple[Optional[dict], Optional[str]]:
    fn = {
        "github": fetch_github_raw_for_analysis,
        "leetcode": fetch_leetcode_raw_for_analysis,
        "codeforces": fetch_codeforces_raw_for_analysis,
    }[platform]
    try:
        return await fn(user), None
    except ValueError:
        return None, f"{_LABEL[platform]} user '{user}' not found"
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        hint = " (rate limited — set GITHUB_PAT in backend/.env)" if platform == "github" and code in (403, 429) else ""
        return None, f"{_LABEL[platform]} API error {code}{hint}"
    except httpx.TimeoutException:
        return None, f"{_LABEL[platform]} API timed out"
    except Exception as exc:  # noqa: BLE001
        return None, f"{_LABEL[platform]} fetch error: {type(exc).__name__}: {exc}"


async def build_portfolio(
    resume_bytes: bytes,
    resume_text: str,
    overrides: Dict[str, str],
) -> PortfolioResult:
    pdf_links = rs.extract_pdf_hyperlinks(resume_bytes)
    text_links = _urls_from_text(resume_text)
    all_links = list(dict.fromkeys(pdf_links + text_links))
    detected = detect_profile_links(all_links)

    report: Dict[str, Any] = {"links_found": all_links, "platforms": {}}
    raws: Dict[str, Optional[dict]] = {}
    notes: List[str] = []

    for p in PLATFORMS:
        user = overrides.get(p) or detected.get(p)
        source = "manual" if overrides.get(p) else ("resume link" if detected.get(p) else None)
        entry: Dict[str, Any] = {"username": user, "source": source, "status": "not_provided"}
        raws[p] = None
        if not user:
            notes.append(
                f"PORTFOLIO GAP — {_LABEL[p].upper()}: the resume contains no {_LABEL[p]} profile link "
                f"and none was supplied, so there is NO verified {_LABEL[p]} data. State this explicitly "
                f"as a gap in the audit (weaknesses and resume_corrections: add a {_LABEL[p]} link if "
                f"the candidate has an account). Do not invent any {_LABEL[p]} statistics."
            )
        else:
            raw, err = await _fetch(p, user)
            raws[p] = raw
            if raw:
                entry["status"] = "verified"
            else:
                entry.update(status="fetch_failed", error=err)
                notes.append(
                    f"PORTFOLIO FETCH FAILED — {_LABEL[p].upper()}: the resume links to "
                    f"'{user}' but its data could not be retrieved ({err}). The claims are therefore "
                    f"UNCHECKED, not false: do not report them as discrepancies and do not call them "
                    f"fabricated; mention only that {_LABEL[p]} could not be verified this run."
                )
        report["platforms"][p] = entry

    linkedin = next((u for u in all_links if "linkedin.com" in u.lower()), None)
    report["linkedin"] = linkedin
    if linkedin:
        notes.append(f"The resume links to a LinkedIn profile ({linkedin}); it is not fetched here.")

    # Repo-level links (github.com/OWNER/REPO): production checks they really exist.
    gh_user = report["platforms"]["github"]["username"]
    hyper = await rs._build_hyperlink_context(resume_bytes, gh_user)
    if hyper:
        notes.append(hyper)
        report["repo_links_checked"] = True

    metrics = format_for_analysis(raws["github"], raws["leetcode"], raws["codeforces"])
    has_data = any(raws.values())
    return PortfolioResult(
        metrics_json=metrics.model_dump_json() if has_data else "",
        notes=notes,
        report=report,
    )

