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


class ResumeAnalysisResult(BaseModel):
    detected_discrepancies: List[Discrepancy] = Field(
        ...,
        description="List of detected inconsistencies between resume claims and verified profile data."
    )
    strengths: List[str] = Field(
        ...,
        description="Strengths where the resume perfectly aligns with hard data."
    )
    weaknesses: List[str] = Field(
        ...,
        description="Formatting, structure, or technical depth issues found in the resume layout itself."
    )
    next_week_action_plan: List[str] = Field(
        ...,
        description="Exactly 7 daily actionable tasks for resume corrections or repository additions."
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
        "next_week_action_plan": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Exactly 7 daily tasks."
        }
    },
    "required": ["detected_discrepancies", "strengths", "weaknesses", "next_week_action_plan"]
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


async def analyze_resume(resume_bytes: bytes, portfolio: FormattedMetrics) -> ResumeAnalysisResult:
    """
    Send the resume PDF and formatted portfolio metrics to Gemini and return a
    structured ``ResumeAnalysisResult``.
    """
    client = _get_client()

    contents = [
        genai_types.Part.from_bytes(
            data=resume_bytes,
            mime_type="application/pdf"
        ),
        f"Here are the candidate's actual verified coding metrics:\n{portfolio.model_dump_json()}"
    ]

    config = genai_types.GenerateContentConfig(
        system_instruction=(
            "You are an expert technical recruiter. Analyze this resume file against the verified "
            "portfolio data JSON to detect fake claims, formatting weaknesses, and output a strict "
            "JSON optimization roadmap matching the schema."
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
