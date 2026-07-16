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
        description=(
            "The verified metrics/repositories that ACTIVELY CONTRADICT the resume claim. Never "
            "use this for a claim that simply has no GitHub/LeetCode data behind it — absence of "
            "data is not a contradiction."
        )
    )


class RoleFitAssessment(BaseModel):
    matched_skills: List[str] = Field(
        ...,
        description=(
            "Skills/tools/knowledge areas typically expected for the candidate's target role that "
            "are demonstrated by ANY credible signal in the resume + verified portfolio — including "
            "hackathon rankings, contest placements, and academic honors, not just GitHub/LeetCode."
        )
    )
    missing_skills: List[str] = Field(
        ...,
        description=(
            "Skills/tools/knowledge areas typically expected for the candidate's target role that "
            "are genuinely absent or weak. Do not list something here if the resume already shows "
            "credible independent evidence of it (e.g. a relevant hackathon win or contest podium)."
        )
    )
    fit_summary: str = Field(
        ...,
        description="A concise 2-3 sentence verdict on how well this candidate currently fits the target role."
    )


class OverallRating(BaseModel):
    score: int = Field(
        ...,
        ge=0,
        le=100,
        description=(
            "Overall competitiveness score out of 100 for this candidate against their target "
            "role, synthesizing accuracy (discrepancies), demonstrated strengths/achievements, "
            "role fit, and resume quality together — computed last, after all other sections."
        )
    )
    verdict: str = Field(
        ...,
        description="A short 2-4 word label for the score, e.g. 'Strong Candidate', 'Promising, Needs Polish', 'Not Yet Competitive'."
    )
    summary: str = Field(
        ...,
        description=(
            "2-3 sentence justification of the score, referencing the specific strengths, gaps, "
            "and role fit already identified in this analysis."
        )
    )


class ResumeAnalysisResult(BaseModel):
    detected_discrepancies: List[Discrepancy] = Field(
        ...,
        description=(
            "List of resume claims that ACTIVELY CONTRADICT verified profile data. Empty if none — "
            "a missing/thin GitHub or LeetCode profile is NOT a discrepancy, only a real conflict is."
        )
    )
    role_fit: RoleFitAssessment = Field(
        ...,
        description="Assessment of the candidate's fit for their stated target role."
    )
    strengths: List[str] = Field(
        ...,
        description=(
            "Strengths where the resume aligns with hard data OR with credible independent "
            "evidence such as hackathon placements, contest rankings, or academic honors."
        )
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
            "Exactly 7 daily skill-building tasks, each targeting a genuine gap from "
            "`role_fit.missing_skills`. Vary the kind of task to fit the gap (new project, "
            "extend an existing project, learn a specific concept/tool, replicate a paper, write "
            "documentation, open-source contribution) instead of defaulting every day to "
            "'push to GitHub' or 'solve N LeetCode problems' — use those only where they're "
            "genuinely the best lever for that day's gap. Must never include resume-editing tasks."
        )
    )
    overall_rating: OverallRating = Field(
        ...,
        description=(
            "Final overall competitiveness rating, computed last after every other section — "
            "a holistic synthesis of the whole analysis, not a separate independent judgment."
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
        },
        "overall_rating": {
            "type": "object",
            "properties": {
                "score": {
                    "type": "integer",
                    "description": "Overall competitiveness score out of 100, computed last as a synthesis of the whole analysis."
                },
                "verdict": {
                    "type": "string",
                    "description": "Short 2-4 word label for the score."
                },
                "summary": {
                    "type": "string",
                    "description": "2-3 sentence justification referencing specifics already found in this analysis."
                }
            },
            "required": ["score", "verdict", "summary"],
            "description": "Final holistic rating, computed last after every other section."
        }
    },
    "required": [
        "detected_discrepancies",
        "role_fit",
        "strengths",
        "weaknesses",
        "resume_corrections",
        "next_week_action_plan",
        "overall_rating"
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
            "CRITICAL — how to treat resume content that has no GitHub/LeetCode data behind it:\n"
            "The verified metrics JSON only ever covers GitHub and LeetCode activity. It says "
            "NOTHING about competition results, hackathon placements, academic honors, positions "
            "of responsibility, coursework, or teaching/leadership roles — those are independently "
            "verifiable by their own nature (an organizer-ranked hackathon podium, a university gold "
            "medal, a named contest placement) and must be taken at face value as genuine strengths, "
            "never flagged as unverifiable 'claims'. Only use `detected_discrepancies` for a resume "
            "statement that ACTIVELY CONTRADICTS something the verified metrics JSON shows (wrong "
            "language, wrong library, inflated numbers that conflict with real activity — like the "
            "classic 'claims C++, repo is pure C' case). The mere ABSENCE of a GitHub/LeetCode "
            "profile, or of profile data for a specific framework, is NOT a discrepancy — never "
            "invent one for it. If GitHub/LeetCode data is missing or thin, mention that at most "
            "once as a general observation in `weaknesses` (e.g. 'resume claims aren't backed by a "
            "linked public code portfolio') — do not repeat it as a discrepancy for every skill "
            "claim in the resume.\n\n"
            "For `strengths`: give full credit to resume-stated achievements that are inherently "
            "third-party-validated — hackathon rankings, competitive-programming contest placements, "
            "academic honors/medals, named leadership or PoR titles — treat these as real evidence "
            "of the candidate's ability (e.g. a top-5 hackathon finish among 50+ teams IS evidence of "
            "applied engineering ability; a podium finish in a CP contest IS evidence of DSA ability) "
            "even with zero linked GitHub/LeetCode profile behind them.\n\n"
            "For `role_fit`: first privately determine, from general industry hiring standards, "
            "the skills, tools, and experience typically required for the candidate's stated "
            "target role (e.g. an AI/ML role expects things like model training, data pipelines, "
            "Python ML frameworks; a Quant role expects things like statistics, C++/Python "
            "performance code, financial modeling — infer the right set for whatever role is "
            "given, do not assume it is always a generalist software role). Then evaluate the "
            "resume AND verified portfolio together against that inferred requirement set — "
            "weighing resume-stated achievements/awards/placements as real signal exactly like "
            "above, not just GitHub/LeetCode data — and split it into `matched_skills` "
            "(demonstrated, by any credible signal) and `missing_skills` (genuinely absent or weak), "
            "plus a `fit_summary` verdict grounded in the specific target role. Do not pad "
            "`missing_skills` with generic 'go verify on LeetCode/GitHub' items when the resume "
            "already contains strong, independently-credible proof of that exact ability.\n\n"
            "Keep two other things strictly separate:\n"
            "1. `resume_corrections` — concrete, ready-to-use text edits that fix the discrepancies "
            "and weaknesses you found (e.g. wrong language/library claims, vague bullets). These are "
            "one-off resume text fixes. Do NOT phrase these as a daily plan.\n"
            "2. `next_week_action_plan` — exactly 7 daily SKILL-BUILDING tasks, each targeting a "
            "genuine gap from `role_fit.missing_skills` or the verified metrics. Vary the KIND of "
            "task to fit the specific gap instead of defaulting every day to 'push code to GitHub' "
            "or 'solve N LeetCode problems' — pick whichever action actually closes that gap: build "
            "a new project demonstrating a missing capability, deepen/extend an existing project "
            "(e.g. add tests, add a missing subsystem, deploy it), learn or practice a specific "
            "concept/tool the role needs, replicate a relevant paper or technique, write technical "
            "documentation, or contribute to an open-source project in the relevant ecosystem. Only "
            "prescribe a LeetCode/GitHub-specific task on a day where that is genuinely the best "
            "lever for the gap being addressed that day — not as filler. Never put a resume-editing "
            "task in here. Every task must be derived from this candidate's real data and target "
            "role — never generic, unconnected advice.\n\n"
            "Finally, compute `overall_rating` LAST, after you have already worked out every "
            "section above — it is a holistic synthesis, not an independent first impression. "
            "Weigh together: (a) severity and count of real `detected_discrepancies` (more/worse "
            "contradictions pull the score down hard); (b) how well `role_fit.matched_skills` "
            "covers the role's real requirements vs `missing_skills`; (c) the strength of resume-"
            "stated achievements, hackathon/contest results, and academic honors as genuine "
            "positive signal; (d) resume quality issues in `weaknesses`. This is a recruiter's "
            "overall competitiveness rating for this candidate against this target role — not a "
            "keyword-matching score — so a candidate with strong verified/independent achievements "
            "but no GitHub/LeetCode should NOT be penalized as if they were dishonest; a candidate "
            "with real contradictions should score notably lower even with good achievements."
        ),
        response_mime_type="application/json",
        response_schema=_RESPONSE_SCHEMA,
        temperature=0.2,
        max_output_tokens=4096,
        http_options=genai_types.HttpOptions(timeout=60_000),
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
            if (
                "429" in err_str or "503" in err_str or "504" in err_str
                or "UNAVAILABLE" in err_str or "RESOURCE_EXHAUSTED" in err_str
                or "DEADLINE_EXCEEDED" in err_str
            ):
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
