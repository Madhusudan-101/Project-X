"""
LinkedIn Analyzer Agent — linkedin_analyzer_agent.py
─────────────────────────────────────────────────────
Analyzes a candidate's "Save to PDF" LinkedIn export directly with Gemini
(no parser, no scraping — a PDF export is the only ToS-compliant way to get
LinkedIn data at all) and cross-checks it against the candidate's most
recent resume analysis, if one exists, for a 2-source verification pass.

Model  : gemini-3.5-flash
SDK    : google-genai (the new, supported SDK)

Mirrors resume_analyzer_agent.py's conventions (schema style, retry/model
fallback loop, response cleanup) — see that file for the fuller original.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, List, Optional

from google import genai
from google.genai import types as genai_types
from pydantic import BaseModel, Field

from .resume_analyzer_agent import PreviousAnalysisContext

logger = logging.getLogger(__name__)

# Models to try in order — primary first, then fallbacks. Same list as the
# resume analyzer for consistent behavior/cost across both signals.
_MODEL_CANDIDATES: List[str] = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.0-flash",
]


# ── Response Schema (Pydantic V2) ─────────────────────────────────────


class LinkedInExperienceEntry(BaseModel):
    company: Optional[str] = Field(None, description="Employer/organization name.")
    role: Optional[str] = Field(None, description="Job title.")
    duration: Optional[str] = Field(
        None, description="Duration as printed on the export, e.g. 'Jun 2023 - Aug 2023 · 3 mos'."
    )
    description: Optional[str] = Field(None, description="Role description/bullets, if present.")


class LinkedInEducationEntry(BaseModel):
    institution: Optional[str] = Field(None, description="School/university name.")
    degree: Optional[str] = Field(None, description="Degree, e.g. 'B.Tech, Computer Science'.")
    duration: Optional[str] = Field(None, description="Duration as printed on the export.")


class CrossCheckFlag(BaseModel):
    field: str = Field(..., description="What's being compared, e.g. 'Company — Acme Corp internship'.")
    linkedin_value: str = Field(..., description="What the LinkedIn export states.")
    resume_value: str = Field(..., description="What the resume states for the same claim.")
    note: str = Field(..., description="Why this is a genuine contradiction, not just a wording difference.")


# Fixed, ordered set of sections every candidate gets rated on — present or
# not — so the UI can always render the same grid and gaps are obvious.
LINKEDIN_SECTIONS = (
    "Headline",
    "About",
    "Experience",
    "Education",
    "Skills",
    "Projects",
    "Licenses & Certifications",
    "Recommendations",
    "Featured",
)


class LinkedInSectionAnalysis(BaseModel):
    section: str = Field(..., description=f"One of: {', '.join(LINKEDIN_SECTIONS)}.")
    present: bool = Field(..., description="Whether this section exists at all on the profile.")
    rating: str = Field(..., description="Exactly one of: 'Strong', 'Needs Work', 'Missing'.")
    current_summary: str = Field(
        ..., description="One crisp sentence: what's actually written there right now (or 'Not filled in.' if absent)."
    )
    gap_reason: str = Field(
        ..., description="One crisp sentence: what's weak/missing and why it matters to a recruiter. Empty string if rating is 'Strong'."
    )
    suggestions: List[str] = Field(
        default_factory=list,
        description=(
            "2-3 short, concrete, ready-to-use fixes — a mix of fresher-appropriate and "
            "industry-standard advice. Never generic ('improve your profile'); always specific "
            "to what this candidate's profile actually needs. Empty if rating is 'Strong'."
        )
    )


class LinkedInAnalysisResult(BaseModel):
    is_valid_linkedin_export: bool = Field(
        ...,
        description=(
            "False if this PDF is clearly not a LinkedIn 'Save to PDF' profile export "
            "(e.g. a resume, a random document, an unrelated PDF). When false, every other "
            "field should be empty/null and `invalid_reason` must explain why."
        )
    )
    invalid_reason: Optional[str] = Field(
        None, description="Set only when is_valid_linkedin_export is false — why this doesn't look like a LinkedIn export."
    )
    headline: Optional[str] = Field(None, description="The profile headline under the candidate's name, if present.")
    experience: List[LinkedInExperienceEntry] = Field(
        default_factory=list, description="Experience section entries, in the order printed. Empty if the section is absent."
    )
    education: List[LinkedInEducationEntry] = Field(
        default_factory=list, description="Education section entries. Empty if the section is absent."
    )
    skills: List[str] = Field(default_factory=list, description="Skills listed on the profile. Empty if absent.")
    certifications: List[str] = Field(default_factory=list, description="Licenses & certifications listed. Empty if absent.")
    sections: List[LinkedInSectionAnalysis] = Field(
        default_factory=list,
        description=(
            f"EXACTLY one entry per section in {LINKEDIN_SECTIONS}, in that exact order — "
            "never fewer, never more, never reordered."
        )
    )
    cross_check_flags: List[CrossCheckFlag] = Field(
        default_factory=list,
        description=(
            "Genuine contradictions between this LinkedIn export and the candidate's resume "
            "(company/role/duration/skills) — only populated when resume context was supplied. "
            "A LinkedIn entry with no resume counterpart (or vice versa) is NOT a contradiction."
        )
    )
    green_flags: List[str] = Field(default_factory=list, description="Signals that strengthen credibility/consistency.")
    red_flags: List[str] = Field(default_factory=list, description="Genuine concerns — real cross-source conflicts or profile red flags, never absence-of-data.")
    overall_rating_score: int = Field(
        ..., ge=0, le=100,
        description="Profile completeness + consistency score out of 100 — NOT an employability score; that stays owned by the resume/portfolio analysis."
    )
    overall_rating_summary: str = Field(
        ..., description="2-3 sentence justification of overall_rating_score."
    )


_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "is_valid_linkedin_export": {"type": "boolean"},
        "invalid_reason": {"type": "string"},
        "headline": {"type": "string"},
        "experience": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company": {"type": "string"},
                    "role": {"type": "string"},
                    "duration": {"type": "string"},
                    "description": {"type": "string"},
                },
            },
        },
        "education": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "institution": {"type": "string"},
                    "degree": {"type": "string"},
                    "duration": {"type": "string"},
                },
            },
        },
        "skills": {"type": "array", "items": {"type": "string"}},
        "certifications": {"type": "array", "items": {"type": "string"}},
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "section": {"type": "string", "enum": list(LINKEDIN_SECTIONS)},
                    "present": {"type": "boolean"},
                    "rating": {"type": "string", "enum": ["Strong", "Needs Work", "Missing"]},
                    "current_summary": {"type": "string"},
                    "gap_reason": {"type": "string"},
                    "suggestions": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["section", "present", "rating", "current_summary", "gap_reason", "suggestions"],
            },
            "description": f"Exactly {len(LINKEDIN_SECTIONS)} entries, one per section, in order.",
        },
        "cross_check_flags": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "field": {"type": "string"},
                    "linkedin_value": {"type": "string"},
                    "resume_value": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["field", "linkedin_value", "resume_value", "note"],
            },
        },
        "green_flags": {"type": "array", "items": {"type": "string"}},
        "red_flags": {"type": "array", "items": {"type": "string"}},
        "overall_rating_score": {"type": "integer", "description": "0-100 profile completeness + consistency score."},
        "overall_rating_summary": {"type": "string"},
    },
    "required": [
        "is_valid_linkedin_export",
        "experience",
        "education",
        "skills",
        "certifications",
        "sections",
        "cross_check_flags",
        "green_flags",
        "red_flags",
        "overall_rating_score",
        "overall_rating_summary",
    ],
}


SYSTEM_INSTRUCTION = (
    "You are auditing a candidate's LinkedIn profile, provided as a PDF exported via LinkedIn's own "
    "'Save to PDF' feature (Resources dropdown on the profile page). Read the attached PDF directly.\n\n"
    "STEP ZERO — validity check: if this PDF is clearly NOT a LinkedIn profile export (e.g. it's a "
    "resume, an unrelated document, a random scan), set is_valid_linkedin_export=false, explain why in "
    "invalid_reason, and leave every other list/field empty or its default — do NOT hallucinate profile "
    "content for a document that isn't one. Only proceed past this point if it IS a genuine LinkedIn export.\n\n"
    "EXTRACTION — pull out exactly what's printed, never invent: headline, experience (company/role/"
    "duration/description), education (institution/degree/duration), skills, certifications. A missing "
    "section (e.g. no Certifications block at all) means an EMPTY list for that field, not a guess.\n\n"
    "PER-SECTION BREAKDOWN (`sections`) — this is the main output a candidate will actually read, so make "
    f"every word earn its place. Produce EXACTLY one entry for each of {LINKEDIN_SECTIONS}, in that exact "
    "order, never skipping or adding one. For each section:\n"
    "- `present`: does this section exist on the profile at all?\n"
    "- `rating`: 'Strong' (well-filled, recruiter-ready), 'Needs Work' (present but thin/generic/incomplete), "
    "or 'Missing' (not present at all).\n"
    "- `current_summary`: ONE crisp sentence stating what is actually there right now — quote or closely "
    "paraphrase the real content (e.g. 'Headline reads: \"Computer Science Student\".'), never a generic "
    "description. If absent, exactly: 'Not filled in.'\n"
    "- `gap_reason`: ONE crisp sentence on what's weak and why a recruiter would care — concrete, never "
    "vague filler like 'could be better.' Empty string if rating is 'Strong'.\n"
    "- `suggestions`: 2-3 short, ready-to-use fixes, each specific to what THIS profile actually needs (not "
    "generic advice) — phrase them as direct instructions the candidate can act on today. Mix the level: "
    "at least one fresher-appropriate suggestion (e.g. coursework, academic projects, a clear target-role "
    "headline) AND at least one industry-standard best practice (e.g. quantified impact bullets, a "
    "recruiter-optimized headline formula, endorsement-worthy skill ordering) wherever both are relevant to "
    "that section. Empty array if rating is 'Strong.'\n"
    "Be honest and specific — a thin one-line About section is 'Needs Work' even if technically 'present'; "
    "don't inflate ratings to be polite, the candidate needs real signal to actually improve.\n\n"
    "CROSS-CHECK — you may also receive the candidate's most recent RESUME ANALYSIS as separate context "
    "(their target role, matched/missing skills, and a raw resume text block). If given, compare company "
    "names, role titles, durations, and skills between the two sources. Only add to cross_check_flags when "
    "there is a REAL, direct contradiction (e.g. resume says 'Backend Intern at Acme, Jun-Aug 2023', "
    "LinkedIn says 'Frontend Intern at Acme, Jan-Mar 2023' — same employer, conflicting details). An entry "
    "present on one source and simply absent from the other is NOT a contradiction — people commonly leave "
    "things off one profile or the other. If no resume context is provided, cross_check_flags must be empty.\n\n"
    "FLAGS — green_flags are signals that strengthen credibility (e.g. LinkedIn corroborates a resume claim "
    "with matching detail, a complete and consistent work history). red_flags are genuine concerns: real "
    "cross_check_flags contradictions, or LinkedIn-native issues like an unexplained employment gap pattern "
    "or a duration that doesn't add up. Never use a red flag for a merely-empty or thin section — that "
    "belongs in that section's own `gap_reason`/`suggestions` in `sections`, not here.\n\n"
    "SCORING — overall_rating_score (0-100) is computed LAST, as a direct reflection of the `sections` "
    "ratings you just produced (roughly: mostly 'Strong' scores high, several 'Needs Work'/'Missing' scores "
    "low) plus cross-source consistency. This is NOT an employability score and must not try to judge the "
    "candidate's technical ability — that judgment belongs to the resume/portfolio analysis, not this one."
)


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add it to your .env file.")
    return genai.Client(api_key=api_key)


async def _generate_linkedin_analysis(contents: List[Any]) -> LinkedInAnalysisResult:
    """Run the structured-output Gemini call, retrying across model fallbacks."""
    client = _get_client()

    config = genai_types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        response_mime_type="application/json",
        response_schema=_RESPONSE_SCHEMA,
        temperature=0.2,
        max_output_tokens=8192,
        http_options=genai_types.HttpOptions(timeout=60_000),
    )

    last_error: Exception | None = None
    result: LinkedInAnalysisResult | None = None
    for model_name in _MODEL_CANDIDATES:
        try:
            logger.info("Trying LinkedIn analysis with model: %s", model_name)
            response = await client.aio.models.generate_content(
                model=model_name,
                contents=contents,
                config=config,
            )

            finish_reason = (
                response.candidates[0].finish_reason if response.candidates else None
            )
            if finish_reason is not None and str(finish_reason).upper().endswith("MAX_TOKENS"):
                raise ValueError(
                    f"Gemini response was truncated (finish_reason={finish_reason}) "
                    "before completing the JSON output."
                )

            raw_text: str = response.text or ""
            logger.debug("Gemini LinkedIn analysis raw response: %s", raw_text[:500])

            raw_text = re.sub(r"^```json\s*", "", raw_text, flags=re.IGNORECASE)
            raw_text = re.sub(r"\s*```$", "", raw_text)
            raw_text = raw_text.strip()

            result = LinkedInAnalysisResult.model_validate_json(raw_text)
            logger.info("Success with model: %s", model_name)
            break
        except Exception as exc:
            last_error = exc
            err_str = str(exc)
            if (
                "429" in err_str or "503" in err_str or "504" in err_str
                or "UNAVAILABLE" in err_str or "RESOURCE_EXHAUSTED" in err_str
                or "DEADLINE_EXCEEDED" in err_str
                or "truncated" in err_str.lower()
                or "json_invalid" in err_str.lower()
                or "validation error" in err_str.lower()
            ):
                logger.warning(
                    "Model %s failed (%s) — trying next fallback…",
                    model_name,
                    type(exc).__name__
                )
                continue
            raise
    else:
        raise ValueError(f"Gemini output failed validation: {last_error}") from last_error

    return result


async def analyze_linkedin(
    pdf_bytes: bytes,
    resume_context: Optional[PreviousAnalysisContext] = None,
) -> LinkedInAnalysisResult:
    """
    Send the LinkedIn PDF export to Gemini and return a structured
    ``LinkedInAnalysisResult``. ``resume_context`` — the candidate's most
    recent resume analysis, if any (see ``resume_history_service.
    load_previous_analysis``) — supplies the RAW resume text (not just the
    structured audit output, which has no company/role/duration fields to
    diff against) so Gemini can cross-check company/role/duration/skills
    between the two sources directly.
    """
    contents: List[Any] = [
        genai_types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
    ]

    if resume_context is not None:
        contents.append(
            "The candidate's RESUME TEXT on file (target role: "
            f"{resume_context.role_target}), for cross-checking company/role/duration/skills "
            "only — do not re-audit this resume, just compare its claims against the LinkedIn "
            f"export above:\n{resume_context.resume_text}"
        )
    else:
        contents.append(
            "No resume analysis is on file for this candidate yet — cross_check_flags must be empty."
        )

    return await _generate_linkedin_analysis(contents)
