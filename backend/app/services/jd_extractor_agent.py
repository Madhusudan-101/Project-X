"""
Gemini JD Extractor Agent — jd_extractor_agent.py
──────────────────────────────────────────────────
Sends the raw text of an uploaded job-description PDF to Google Gemini
and returns a strict, structured JSON extraction that the frontend uses
to auto-populate the role creation form.

Model  : gemini-3.1-flash-lite  (fast, cheap, structured-output capable)
Output : Enforced via ``response_mime_type="application/json"`` +
         ``response_schema`` so the model never returns conversational text.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List

import google.generativeai as genai
from pydantic import BaseModel, Field

from ..schemas import VALID_EXPERIENCE_LEVELS, VALID_ROLE_TYPES

logger = logging.getLogger(__name__)

# ── Response Schema (what Gemini must return) ─────────────────────────


class JdExtractionResult(BaseModel):
    """Structured extraction output enforced by the Gemini response_schema."""

    title: str = Field(
        default="",
        description="Best-guess concise job title. Empty string if unclear.",
    )
    description: str = Field(
        default="",
        description="2-5 sentence candidate-facing summary of the role's "
        "responsibilities and expectations. Empty string if unclear.",
    )
    required_skills: List[str] = Field(
        default_factory=list,
        description="Concrete required technical/professional skills, "
        "5-15 items where possible.",
    )
    experience_level: str = Field(
        default="",
        description="One of the allowed experience levels, or empty string "
        "if it cannot be determined.",
    )
    role_type: str = Field(
        default="",
        description="One of the allowed role types, or empty string if it "
        "cannot be determined.",
    )
    preferred_qualifications: List[str] = Field(
        default_factory=list,
        description="Nice-to-have (not required) qualifications. Empty "
        "list if none are mentioned.",
    )


# ── System Instruction ────────────────────────────────────────────────

_SYSTEM_INSTRUCTION: str = f"""\
You are an expert technical recruiter who extracts structured hiring data \
from raw job description text. You will receive the plain-text contents of \
a job description PDF. Your job is to extract the key hiring facts and \
produce a strict JSON object. Do NOT output conversational text — output \
ONLY the JSON object matching the required schema.

## Field guidance

- **title**: A concise job title (e.g. "Senior Backend Engineer"). If the \
  document has no clear title, return an empty string — do not guess wildly.
- **description**: A 2-5 sentence candidate-facing summary covering the \
  role's core responsibilities and what the team does. Do not copy the \
  document verbatim — synthesize it.
- **required_skills**: Concrete, specific skills the candidate MUST have \
  (e.g. "React", "PostgreSQL", "System design"). Do not include soft skills \
  like "good communication" unless nothing else is mentioned.
- **experience_level**: Must be exactly one of: {", ".join(VALID_EXPERIENCE_LEVELS)}. \
  Infer from years-of-experience language, seniority titles, or scope of \
  responsibility. If truly ambiguous, return an empty string.
- **role_type**: Must be exactly one of: {", ".join(VALID_ROLE_TYPES)}. \
  Infer from employment-type language (e.g. "internship", "contract-to-hire"). \
  If truly ambiguous, return an empty string.
- **preferred_qualifications**: Qualifications described as a "plus", \
  "nice to have", or "preferred" rather than required. Empty list if none.

Never invent facts that are not supported by the text.\
"""

# ── Gemini Schema (dict form for the SDK) ─────────────────────────────

_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"},
        "required_skills": {"type": "array", "items": {"type": "string"}},
        # No "enum" constraint here — Gemini's schema validator rejects an
        # empty-string enum value, but we need to allow "couldn't determine"
        # (empty string). The system instruction lists the allowed values,
        # and run_jd_extraction() normalizes anything outside that list to "".
        "experience_level": {"type": "string"},
        "role_type": {"type": "string"},
        "preferred_qualifications": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "title",
        "description",
        "required_skills",
        "experience_level",
        "role_type",
        "preferred_qualifications",
    ],
}


# ── Agent entry point ─────────────────────────────────────────────────


def _configure_genai() -> None:
    """Configure the SDK with the API key from env (idempotent)."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add it to your .env file.")
    genai.configure(api_key=api_key)


async def run_jd_extraction(jd_text: str) -> JdExtractionResult:
    """
    Send the raw job-description text to Gemini and return a structured
    ``JdExtractionResult``.

    Uses ``generate_content_async`` so it doesn't block the event loop.
    """
    _configure_genai()

    model = genai.GenerativeModel(
        model_name="gemini-3.1-flash-lite",
        system_instruction=_SYSTEM_INSTRUCTION,
    )

    prompt = "Extract the structured hiring data from this job description:\n\n" + jd_text

    logger.info("Sending %d-char JD prompt to Gemini", len(prompt))

    response = await model.generate_content_async(
        prompt,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=_RESPONSE_SCHEMA,
            temperature=0.2,  # low temp → consistent, non-creative extraction
            max_output_tokens=1024,
        ),
    )

    raw_text: str = response.text
    logger.debug("Gemini raw JD extraction response: %s", raw_text[:500])

    try:
        parsed: Dict[str, Any] = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        logger.error("Gemini returned invalid JSON for JD extraction: %s", exc)
        raise ValueError(f"Gemini returned invalid JSON: {exc}") from exc

    # Gemini may return "" for enum fields it couldn't determine — normalize
    # those to None-like empty values the caller can treat as "not extracted".
    if parsed.get("experience_level") not in VALID_EXPERIENCE_LEVELS:
        parsed["experience_level"] = ""
    if parsed.get("role_type") not in VALID_ROLE_TYPES:
        parsed["role_type"] = ""

    return JdExtractionResult(**parsed)
