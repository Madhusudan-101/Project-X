"""
Resume Analyzer Agent — resume_analyzer_agent.py
─────────────────────────────────────────────────
Parses and analyzes candidate resumes against verified developer portfolio metrics
using Google Gemini and returns a structured authenticity assessment.

Model  : gemini-3.5-flash
SDK    : google-genai (the new, supported SDK)
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List

from google import genai
from google.genai import types as genai_types
from pydantic import BaseModel, Field

from .formatter import FormattedMetrics

logger = logging.getLogger(__name__)

# ── Response Schema (Pydantic V2) ─────────────────────────────────────


class Discrepancy(BaseModel):
    resume_claim: str = Field(
        ...,
        description="The claim or experience stated in the resume."
    )
    portfolio_reality: str = Field(
        ...,
        description="The verified metrics/repositories representing the actual skill representation."
    )


class RoleFitAssessment(BaseModel):
    matched_skills: List[str] = Field(
        ...,
        description=(
            "Skills/tools/knowledge areas typically expected for the candidate's target role "
            "that the resume + verified portfolio actually demonstrate."
        )
    )
    missing_skills: List[str] = Field(
        ...,
        description=(
            "Skills/tools/knowledge areas typically expected for the candidate's target role "
            "that are missing, weak, or unverified for this candidate."
        )
    )
    fit_summary: str = Field(
        ...,
        description="A concise 2-3 sentence verdict on how well this candidate currently fits the target role."
    )


class ResumeAnalysisResult(BaseModel):
    detected_discrepancies: List[Discrepancy] = Field(
        ...,
        description="List of detected inconsistencies between resume claims and verified profile data."
    )
    role_fit: RoleFitAssessment = Field(
        ...,
        description="Assessment of the candidate's fit for their stated target role."
    )
    strengths: List[str] = Field(
        ...,
        description="Strengths where the resume perfectly aligns with hard data."
    )
    weaknesses: List[str] = Field(
        ...,
        description="Formatting, structure, or technical depth issues found in the resume layout itself."
    )
    resume_corrections: List[str] = Field(
        ...,
        description=(
            "Flat list of concrete, ready-to-use text edits that fix the detected discrepancies "
            "and weaknesses (e.g. wrong language/library claims). One-off resume edits — not a "
            "day-by-day plan."
        )
    )
    next_week_action_plan: List[str] = Field(
        ...,
        description=(
            "Exactly 7 daily skill-building tasks. Each task must target a specific gap between "
            "what recruiters for this candidate's target roles look for and what the verified "
            "portfolio metrics actually show (e.g. DSA volume, project depth, open-source "
            "engagement), with a measurable target derived from the candidate's real numbers. "
            "Must never include resume-editing tasks."
        )
    )


# ── Gemini Schema (dict form for the SDK to avoid nested ref schema errors) ─────────────────────────────

_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "detected_discrepancies": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "resume_claim": {
                        "type": "string",
                        "description": "The claim stated in the resume."
                    },
                    "portfolio_reality": {
                        "type": "string",
                        "description": "The actual verified data/reality from the portfolio."
                    }
                },
                "required": ["resume_claim", "portfolio_reality"]
            },
            "description": "Inconsistencies between resume and portfolio."
        },
        "role_fit": {
            "type": "object",
            "properties": {
                "matched_skills": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Role-relevant skills the candidate actually demonstrates."
                },
                "missing_skills": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Role-relevant skills missing, weak, or unverified for this candidate."
                },
                "fit_summary": {
                    "type": "string",
                    "description": "Concise verdict on fit for the target role."
                }
            },
            "required": ["matched_skills", "missing_skills", "fit_summary"],
            "description": "Assessment of the candidate's fit for their stated target role."
        },
        "strengths": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Alignments with hard data."
        },
        "weaknesses": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Resume formatting or technical weaknesses."
        },
        "resume_corrections": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Concrete text edits to fix discrepancies/weaknesses. One-off resume fixes, "
                "not a daily plan."
            )
        },
        "next_week_action_plan": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Exactly 7 daily SKILL-BUILDING tasks (never resume edits), each closing a "
                "specific, data-backed gap between recruiter expectations for this candidate's "
                "target roles and what the verified portfolio metrics show, with a measurable "
                "target derived from the candidate's actual numbers."
            )
        }
    },
    "required": [
        "detected_discrepancies",
        "role_fit",
        "strengths",
        "weaknesses",
        "resume_corrections",
        "next_week_action_plan"
    ]
}

# ── Agent entry point ─────────────────────────────────────────────────

# Models to try in order — primary first, then fallbacks.
_MODEL_CANDIDATES: List[str] = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.0-flash",
]


def _get_client() -> genai.Client:
    """Create a Gemini client using the API key from env."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Add it to your .env file."
        )
    return genai.Client(api_key=api_key)


async def analyze_resume(
    resume_bytes: bytes,
    portfolio: FormattedMetrics,
    target_role: str,
) -> ResumeAnalysisResult:
    """
    Send the resume PDF and formatted portfolio metrics to Gemini and return a
    structured ``ResumeAnalysisResult`` evaluated against ``target_role``.
    """
    client = _get_client()

    contents = [
        genai_types.Part.from_bytes(
            data=resume_bytes,
            mime_type="application/pdf"
        ),
        f"Here are the candidate's actual verified coding metrics:\n{portfolio.model_dump_json()}",
        f"The candidate's target tech role is: {target_role}",
    ]

    config = genai_types.GenerateContentConfig(
        system_instruction=(
            "You are an expert technical recruiter conducting a resume-authenticity audit for a "
            "candidate applying to a specific target tech role. Analyze the resume file against "
            "the verified portfolio metrics JSON (GitHub + LeetCode) to detect fake claims, "
            "formatting weaknesses, and produce a strict JSON output matching the schema.\n\n"
            "For `role_fit`: first privately determine, from general industry hiring standards, "
            "the skills, tools, and experience typically required for the candidate's stated "
            "target role (e.g. an AI/ML role expects things like model training, data pipelines, "
            "Python ML frameworks; a Quant role expects things like statistics, C++/Python "
            "performance code, financial modeling — infer the right set for whatever role is "
            "given, do not assume it is always a generalist software role). Then evaluate the "
            "resume and verified portfolio against that inferred requirement set and split it into "
            "`matched_skills` (demonstrated) and `missing_skills` (absent, weak, or unverified), "
            "plus a `fit_summary` verdict grounded in the specific target role.\n\n"
            "Keep two other things strictly separate:\n"
            "1. `resume_corrections` — concrete, ready-to-use text edits that fix the discrepancies "
            "and weaknesses you found (e.g. wrong language/library claims, vague bullets). These are "
            "one-off resume text fixes. Do NOT phrase these as a daily plan.\n"
            "2. `next_week_action_plan` — exactly 7 daily SKILL-BUILDING tasks. Never put a "
            "resume-editing task in here. Instead: (a) use the target-role skill requirements you "
            "already inferred for `role_fit`; (b) compare that against what the verified metrics "
            "JSON actually shows for this candidate (e.g. LeetCode solved counts by difficulty, "
            "GitHub stars/activity, language diversity, project complexity); (c) for every real gap "
            "you find — prioritizing the `missing_skills` from `role_fit` — prescribe one concrete, "
            "measurable daily action sized to the candidate's actual current numbers (e.g. a low "
            "solved-count candidate gets a daily problem-solving target; a candidate missing a "
            "role-required skill gets a concrete action to build it). Every task must be derived "
            "from this candidate's real data and target role — never generic, unconnected advice."
        ),
        response_mime_type="application/json",
        response_schema=_RESPONSE_SCHEMA,
        temperature=0.2,
        max_output_tokens=4096,
    )

    last_error: Exception | None = None
    response = None
    for model_name in _MODEL_CANDIDATES:
        try:
            logger.info("Trying resume analysis with model: %s", model_name)
            response = await client.aio.models.generate_content(
                model=model_name,
                contents=contents,
                config=config,
            )
            logger.info("Success with model: %s", model_name)
            break
        except Exception as exc:
            last_error = exc
            err_str = str(exc)
            if "429" in err_str or "503" in err_str or "UNAVAILABLE" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                logger.warning(
                    "Model %s unavailable (%s), trying next fallback…",
                    model_name,
                    type(exc).__name__
                )
                continue
            raise
    else:
        raise last_error  # type: ignore[misc]

    # Parse the structured JSON response
    raw_text: str = response.text or ""
    logger.debug("Gemini resume analysis raw response: %s", raw_text[:500])

    # Clean up json formatting wrappers (e.g. ```json ... ```)
    raw_text = re.sub(r"^```json\s*", "", raw_text, flags=re.IGNORECASE)
    raw_text = re.sub(r"\s*```$", "", raw_text)
    raw_text = raw_text.strip()

    try:
        return ResumeAnalysisResult.model_validate_json(raw_text)
    except Exception as exc:
        logger.error("Gemini output failed validation: %s. Raw text: %s", exc, raw_text)
        raise ValueError(f"Gemini output failed validation: {exc}") from exc
