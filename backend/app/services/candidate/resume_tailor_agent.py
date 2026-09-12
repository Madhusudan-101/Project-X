"""
Resume Tailor Agent — resume_tailor_agent.py
───────────────────────────────────────────
Rewrites ONE candidate's resume for ONE job, section by section, AFTER
scoring (so skills_match and the 5-dimension breakdown are available). The
model returns the FULL rewritten resume as plain text, preserving section
order and headings; the backend then diffs it against the original.

Hard rule: never invent experience, employers, dates, or metrics. Only
resurface skills / achievements the candidate genuinely has, worded toward
what the JD asks for.

Model : gemini-3.5-flash (with fallbacks), google-genai SDK.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types as genai_types

logger = logging.getLogger(__name__)

_MODEL_CANDIDATES: List[str] = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.0-flash",
]

MODEL_VERSION_LABEL = "resume-tailor-v1"


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add it to your .env file.")
    return genai.Client(api_key=api_key)


_SYSTEM = (
    "You are tailoring a candidate's resume for one specific job. You are given the original "
    "resume text, the job description, the required skills, the already-computed skills_match "
    "(matched vs missing skills for THIS JD), and the candidate's 5-dimension scoring "
    "breakdown with rationale.\n\n"
    "Rewrite the resume SECTION BY SECTION, but OUTPUT THE FULL RESUME as plain text with the "
    "SAME section order and the SAME headings as the original. Keep the same overall length "
    "(±10%). Preserve the contact/header block verbatim.\n\n"
    "What to change:\n"
    "- Reword bullet points so that skills from skills_match.matched and concrete achievements "
    "already in the resume are stated in the JD's language and lead with impact.\n"
    "- Where a low-scoring dimension can HONESTLY be strengthened from existing content "
    "(e.g. a real project that shows a matched skill), surface it.\n"
    "- Tighten weak phrasing; use strong verbs and quantified results ONLY where the number "
    "is already in the resume.\n\n"
    "What you must NOT do:\n"
    "- Never add a skill from skills_match.missing unless the original resume already "
    "evidences it. Never invent an employer, title, date, project, tool, or metric. Never "
    "claim seniority the resume doesn't support. Do not add new bullets that assert "
    "experience the candidate doesn't have.\n\n"
    "Return ONLY the rewritten resume as plain text. No markdown, no commentary, no code fences."
)


def _truncate(text: str, limit: int = 16000) -> str:
    return text if len(text) <= limit else text[:limit] + "\n…[truncated]"


async def tailor_resume(
    *,
    resume_text: str,
    job: Dict[str, Any],
    required_skills: List[str],
    skills_match: Dict[str, Any],
    dimensions: Dict[str, Any],
) -> str:
    """Returns the full rewritten resume as plain text. Raises RuntimeError
    (no API key) or the underlying SDK error."""
    client = _get_client()

    import json

    jd_text = (
        "JOB DESCRIPTION\n"
        f"  Title: {job.get('title', '')}\n"
        f"  Domain: {job.get('domain', '')}\n"
        f"  Experience level: {job.get('experience_level', '')}\n"
        f"  Required skills: {', '.join(required_skills) or '(none listed)'}\n\n"
        f"  Full description:\n{_truncate(job.get('description', ''), 6000)}\n"
    )
    match_text = (
        "SKILLS MATCH (already computed for THIS JD):\n"
        f"  matched: {', '.join(skills_match.get('matched', [])) or '(none)'}\n"
        f"  missing: {', '.join(skills_match.get('missing', [])) or '(none)'}\n"
        f"  coverage_pct: {skills_match.get('coverage_pct', 'unknown')}\n"
    )
    dims_lines = ["5-DIMENSION BREAKDOWN (score — rationale):"]
    for dim in ("resume", "github", "leetcode", "interview", "assessment"):
        d = dimensions.get(dim) or {}
        dims_lines.append(
            f"  {dim}: {d.get('score', 'null')} — {(d.get('rationale') or '').strip()[:400]}"
        )

    contents: List[Any] = [
        jd_text,
        match_text,
        "\n".join(dims_lines),
        "ORIGINAL RESUME TEXT:\n" + _truncate(resume_text or "(no resume text on file)"),
    ]
    config = genai_types.GenerateContentConfig(
        system_instruction=_SYSTEM,
        temperature=0.3,
        max_output_tokens=6000,
        http_options=genai_types.HttpOptions(timeout=90_000),
    )

    last_error: Optional[Exception] = None
    for model_name in _MODEL_CANDIDATES:
        try:
            logger.info("Resume tailoring with model: %s", model_name)
            response = await client.aio.models.generate_content(
                model=model_name, contents=contents, config=config,
            )
            text = (response.text or "").strip()
            text = re.sub(r"^```(?:markdown|text)?\s*", "", text, flags=re.IGNORECASE)
            text = re.sub(r"\s*```$", "", text).strip()
            if text:
                return text
            raise ValueError("Empty rewrite from model.")
        except Exception as exc:  # noqa: BLE001 — mirror job_scoring_agent fallback
            last_error = exc
            logger.warning(
                "Resume-tailor model %s failed (%s) — next fallback…", model_name, type(exc).__name__
            )
            continue
    raise ValueError(f"Resume tailoring failed after all model fallbacks: {last_error}") from last_error
