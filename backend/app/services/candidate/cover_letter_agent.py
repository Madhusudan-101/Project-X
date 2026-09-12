"""
Cover Letter Agent — cover_letter_agent.py
─────────────────────────────────────────
Drafts ONE cover letter for ONE candidate applying to ONE job, at APPLY
time — before any scoring has run. There is no precomputed skills_match at
this point (that only exists after run_scoring_for_application), so the
model does its own matching in this call, working straight off the resume
text + job description + required_skills.

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


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add it to your .env file.")
    return genai.Client(api_key=api_key)


_SYSTEM = (
    "You are drafting a cover letter for a candidate applying to a specific job. You are "
    "given the candidate's resume text, the job description, and the job's required skills. "
    "You have NO precomputed skills match — do your own matching from the resume against the "
    "required skills in this same pass.\n\n"
    "Write a concise, specific cover letter: 3-4 short paragraphs, first person, addressed to "
    "the hiring team. Open with the role and one concrete reason this candidate fits it. "
    "Middle paragraph(s): 2-4 specifics pulled ONLY from the resume (real projects, "
    "technologies, results) mapped to what the JD asks for. Close with a short, non-generic "
    "line about interest in this role.\n\n"
    "Rules: never invent an employer, project, credential, skill, or metric that is not in "
    "the resume. If the resume is thin, keep the letter shorter rather than padding it. No "
    "clichés ('I am writing to express my interest', 'team player', 'hit the ground "
    "running'). No salutation line like 'Dear Sir/Madam' and no sign-off name — just the "
    "letter body. Return ONLY the plain-text letter, no markdown, no preamble."
)


def _truncate(text: str, limit: int = 12000) -> str:
    return text if len(text) <= limit else text[:limit] + "\n…[truncated]"


async def draft_cover_letter(
    *,
    resume_text: str,
    job: Dict[str, Any],
    required_skills: List[str],
) -> str:
    """Raises RuntimeError (no API key) or the underlying SDK error; returns
    the plain-text letter."""
    client = _get_client()

    jd_text = (
        "JOB DESCRIPTION\n"
        f"  Title: {job.get('title', '')}\n"
        f"  Domain: {job.get('domain', '')}\n"
        f"  Experience level: {job.get('experience_level', '')}\n"
        f"  Required skills: {', '.join(required_skills) or '(none listed)'}\n\n"
        f"  Full description:\n{_truncate(job.get('description', ''), 6000)}\n"
    )
    contents: List[Any] = [
        jd_text,
        "CANDIDATE RESUME TEXT:\n" + _truncate(resume_text or "(no resume text on file)"),
    ]
    config = genai_types.GenerateContentConfig(
        system_instruction=_SYSTEM,
        temperature=0.4,
        max_output_tokens=1200,
        http_options=genai_types.HttpOptions(timeout=45_000),
    )

    last_error: Optional[Exception] = None
    for model_name in _MODEL_CANDIDATES:
        try:
            response = await client.aio.models.generate_content(
                model=model_name, contents=contents, config=config,
            )
            text = (response.text or "").strip()
            text = re.sub(r"^```(?:markdown|text)?\s*", "", text, flags=re.IGNORECASE)
            text = re.sub(r"\s*```$", "", text).strip()
            if text:
                return text
            raise ValueError("Empty cover letter from model.")
        except Exception as exc:  # noqa: BLE001 — mirror job_scoring_agent fallback
            last_error = exc
            logger.warning(
                "Cover-letter model %s failed (%s) — next fallback…", model_name, type(exc).__name__
            )
            continue
    raise ValueError(f"Cover-letter drafting failed after all model fallbacks: {last_error}") from last_error
