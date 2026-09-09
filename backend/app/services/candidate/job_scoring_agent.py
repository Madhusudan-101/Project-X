"""
Job-Scoped Scoring Agent — job_scoring_agent.py
────────────────────────────────────────────────
Evaluates ONE candidate against ONE specific job, weighted by THAT job's
own slider config. This is deliberately NOT a generic student-level score:
every call is bound to a single application and re-run with the job's
weights, so the same student applying to two jobs gets two different,
independently-computed results.

Inputs (all already cached from the candidate's onboarding / resume run):
  * resume text
  * verified portfolio metrics JSON (GitHub / LeetCode / Codeforces)
  * the prior resume-authenticity audit JSON
  * the JD context (title, description, required skills, experience, domain)
  * the job's job_weights row (resume / github / leetcode / interview / assessment)

Output: a 5-dimension breakdown + skills match + recruiter verdict +
placement probability. The weighted composite is computed in Python from
the per-dimension scores × this job's weights (renormalized over the
dimensions that actually have data) so the number is auditable.

Model : gemini-3.5-flash (with fallbacks), google-genai SDK — same pattern
        as resume_analyzer_agent._generate_analysis.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types as genai_types
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

_MODEL_CANDIDATES: List[str] = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.0-flash",
]

# Bump when SYSTEM_INSTRUCTION changes materially (tracked in model_versions).
# v2: dimensions.interview is now fed by the mock-interview signal when the
# candidate has completed AI Interview Studio sessions.
MODEL_VERSION_LABEL = "job-scoring-v2"

_DIMENSIONS = ("resume", "github", "leetcode", "interview", "assessment")

# Dimensions with no data source in the platform yet — the model is told to
# return score=null for these; their weight is excluded from the composite.
# 'interview' left here: it is only scorable when a mock_interview_signal is
# passed to score_application(), otherwise it stays null.
_UNAVAILABLE_DIMENSIONS = ("assessment",)


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add it to your .env file.")
    return genai.Client(api_key=api_key)


# ── Response schema (Pydantic) ───────────────────────────────────────

class DimensionScore(BaseModel):
    score: Optional[int] = Field(
        default=None,
        description="0-100 for this dimension, or null if there is no data to assess it.",
    )
    rationale: str = Field(..., description="Why this score / why no data.")
    evidence: List[str] = Field(
        default_factory=list,
        description="Concrete signals from the resume / portfolio that back this score.",
    )


class SkillsMatch(BaseModel):
    matched: List[str] = Field(default_factory=list)
    missing: List[str] = Field(default_factory=list)
    coverage_pct: int = Field(0, ge=0, le=100)


class RecruiterVerdict(BaseModel):
    label: str = Field(..., description="2-4 word verdict, e.g. 'Strong Fit', 'Borderline'.")
    summary: str = Field(..., description="2-3 sentence justification grounded in this JD.")
    recommendation: str = Field(
        ...,
        description="One of: 'advance', 'consider', 'hold', 'reject' — the recruiter's next step.",
    )


class JobScoringDimensions(BaseModel):
    resume: DimensionScore
    github: DimensionScore
    leetcode: DimensionScore
    interview: DimensionScore
    assessment: DimensionScore


class JobScoringResult(BaseModel):
    dimensions: JobScoringDimensions
    skills_match: SkillsMatch
    placement_probability: int = Field(
        ..., ge=0, le=100,
        description="Likelihood this candidate is placed for THIS role, given its weights.",
    )
    recruiter_verdict: RecruiterVerdict


_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "dimensions": {
            "type": "object",
            "properties": {
                dim: {
                    "type": "object",
                    "properties": {
                        "score": {
                            "type": ["integer", "null"],
                            "description": "0-100, or null when there is no data for this dimension.",
                        },
                        "rationale": {"type": "string"},
                        "evidence": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["rationale", "evidence"],
                }
                for dim in _DIMENSIONS
            },
            "required": list(_DIMENSIONS),
        },
        "skills_match": {
            "type": "object",
            "properties": {
                "matched": {"type": "array", "items": {"type": "string"}},
                "missing": {"type": "array", "items": {"type": "string"}},
                "coverage_pct": {"type": "integer"},
            },
            "required": ["matched", "missing", "coverage_pct"],
        },
        "placement_probability": {"type": "integer"},
        "recruiter_verdict": {
            "type": "object",
            "properties": {
                "label": {"type": "string"},
                "summary": {"type": "string"},
                "recommendation": {"type": "string"},
            },
            "required": ["label", "summary", "recommendation"],
        },
    },
    "required": ["dimensions", "skills_match", "placement_probability", "recruiter_verdict"],
}


SYSTEM_INSTRUCTION = (
    "You are a senior technical recruiter scoring ONE candidate for ONE specific job. "
    "You are given the job description, its required skills, and the hiring team's WEIGHT "
    "CONFIG for this job (how much Resume, GitHub, LeetCode, Interview, and Assessment each "
    "matter for THIS role). You are also given the candidate's resume text, their verified "
    "portfolio metrics (GitHub / LeetCode / Codeforces), and a prior resume-authenticity "
    "audit.\n\n"
    "Produce a strict JSON object matching the schema:\n"
    "1. dimensions.resume — 0-100 for how well the resume itself (experience, projects, "
    "clarity, relevance to THIS JD) supports this application. Always scorable.\n"
    "2. dimensions.github — 0-100 from the verified GitHub metrics (project depth, activity, "
    "relevance to the JD's stack). If there is NO GitHub data at all, set score to null and "
    "say so in rationale — do NOT guess.\n"
    "3. dimensions.leetcode — 0-100 from verified LeetCode/Codeforces DSA signal. Null if no "
    "data.\n"
    "4. dimensions.interview — if a MOCK INTERVIEW SIGNAL block is provided below, base this "
    "score on it: score should be approximately its aggregated score, and the rationale MUST "
    "state the attempt count and confidence level (e.g. 'Based on 5 completed mock interviews, "
    "medium confidence'). This signal reflects the candidate's general interviewing ability and "
    "applies whether THIS job uses an AI or a live interview round. If NO such block is provided, "
    "set score to null and rationale to 'Not yet assessed — no interview on file.'\n"
    "5. dimensions.assessment — no assessment has been taken yet. Set score to null and "
    "rationale to 'Not yet assessed — no assessment on file.'\n\n"
    "skills_match — compare the JD's required skills against everything credible in the resume "
    "+ verified portfolio. matched / missing are skill names; coverage_pct = matched / total "
    "required, 0-100.\n\n"
    "placement_probability — 0-100, the chance this candidate would actually be placed for "
    "THIS role. Weigh the dimensions BY THE JOB'S WEIGHT CONFIG you were given: a job that "
    "weights LeetCode heavily should punish a weak/absent LeetCode signal much harder than a "
    "job that weights it lightly. Dimensions with null scores (interview/assessment, or a "
    "missing platform) should be treated as 'unknown', not zero — lower confidence, not an "
    "automatic fail. Be realistic and calibrated, not generous.\n\n"
    "recruiter_verdict.recommendation must be exactly one of: advance, consider, hold, reject.\n"
    "Never wrap the JSON in prose or markdown fences."
)


def _truncate(text: str, limit: int = 12000) -> str:
    return text if len(text) <= limit else text[:limit] + "\n…[truncated]"


async def score_application(
    *,
    resume_text: str,
    portfolio_metrics: Dict[str, Any] | Any,
    prior_resume_audit: Dict[str, Any] | Any,
    job: Dict[str, Any],
    required_skills: List[str],
    weights: Dict[str, int],
    mock_interview_signal: Optional[Dict[str, Any]] = None,
) -> JobScoringResult:
    """Run the job-scoped Gemini evaluation. Raises RuntimeError (no API key),
    ValueError (unparseable output), or the underlying SDK error."""
    client = _get_client()

    weights_text = (
        "JOB WEIGHT CONFIG (how much each dimension matters for THIS job, sums to 100):\n"
        f"  Resume:     {weights.get('resume_weight', 0)}\n"
        f"  GitHub:     {weights.get('github_weight', 0)}\n"
        f"  LeetCode:   {weights.get('leetcode_weight', 0)}\n"
        f"  Interview:  {weights.get('interview_weight', 0)}\n"
        f"  Assessment: {weights.get('assessment_weight', 0)}\n"
    )
    jd_text = (
        "JOB DESCRIPTION\n"
        f"  Title: {job.get('title', '')}\n"
        f"  Domain: {job.get('domain', '')}\n"
        f"  Experience level: {job.get('experience_level', '')}\n"
        f"  Location: {job.get('location', '')}\n"
        f"  Required skills: {', '.join(required_skills) or '(none listed)'}\n\n"
        f"  Full description:\n{_truncate(job.get('description', ''), 6000)}\n"
    )

    def _as_json(obj: Any) -> str:
        if obj is None:
            return "null"
        if hasattr(obj, "model_dump_json"):
            return obj.model_dump_json()
        import json
        return json.dumps(obj, default=str)

    contents: List[Any] = [
        jd_text,
        weights_text,
        "CANDIDATE RESUME TEXT:\n" + _truncate(resume_text or "(no resume text on file)"),
        "CANDIDATE VERIFIED PORTFOLIO METRICS (GitHub / LeetCode / Codeforces) JSON:\n"
        + _as_json(portfolio_metrics),
        "PRIOR RESUME-AUTHENTICITY AUDIT JSON (context — not the JD-specific verdict):\n"
        + _as_json(prior_resume_audit),
    ]

    if mock_interview_signal:
        contents.append(
            "MOCK INTERVIEW SIGNAL (recency-weighted aggregate of the candidate's COMPLETED "
            "AI Interview Studio practice sessions — general interviewing ability, not job-"
            "specific; use this as the basis for dimensions.interview):\n"
            f"  aggregated_score: {mock_interview_signal.get('score')}\n"
            f"  confidence: {mock_interview_signal.get('confidence')}\n"
            f"  completed_sessions_counted: {mock_interview_signal.get('attempts_counted')}\n"
            f"  most_recent_at: {mock_interview_signal.get('most_recent_at')}\n"
        )

    config = genai_types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        response_mime_type="application/json",
        response_schema=_RESPONSE_SCHEMA,
        temperature=0.2,
        max_output_tokens=8192,
        http_options=genai_types.HttpOptions(timeout=60_000),
    )

    last_error: Optional[Exception] = None
    for model_name in _MODEL_CANDIDATES:
        try:
            logger.info("Job scoring with model: %s", model_name)
            response = await client.aio.models.generate_content(
                model=model_name, contents=contents, config=config,
            )
            raw = (response.text or "").strip()
            raw = re.sub(r"^```json\s*", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"\s*```$", "", raw).strip()
            return JobScoringResult.model_validate_json(raw)
        except Exception as exc:  # noqa: BLE001 — mirror resume_analyzer_agent fallback
            last_error = exc
            err = str(exc)
            if any(
                tok in err
                for tok in ("429", "503", "504", "UNAVAILABLE", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED")
            ) or "validation error" in err.lower() or "json" in err.lower():
                logger.warning("Model %s failed (%s) — trying next fallback…", model_name, type(exc).__name__)
                continue
            raise
    raise ValueError(f"Job scoring failed after all model fallbacks: {last_error}") from last_error


def compute_weighted_composite(
    dimensions: JobScoringDimensions, weights: Dict[str, int]
) -> float:
    """sum(score_i * weight_i) / sum(weight_i) over dimensions that have a
    non-null score. Computed here (not trusted from the model) so the number
    is auditable and provably tied to THIS job's weights."""
    pairs = [
        (dimensions.resume.score, weights.get("resume_weight", 0)),
        (dimensions.github.score, weights.get("github_weight", 0)),
        (dimensions.leetcode.score, weights.get("leetcode_weight", 0)),
        (dimensions.interview.score, weights.get("interview_weight", 0)),
        (dimensions.assessment.score, weights.get("assessment_weight", 0)),
    ]
    num = 0.0
    denom = 0.0
    for score, w in pairs:
        if score is None or w <= 0:
            continue
        num += float(score) * float(w)
        denom += float(w)
    if denom <= 0:
        # Every weighted dimension is missing data — fall back to a plain
        # mean of whatever scored dimensions exist.
        scored = [d.score for d in (dimensions.resume, dimensions.github, dimensions.leetcode)
                  if d.score is not None]
        return round(sum(scored) / len(scored), 2) if scored else 0.0
    return round(num / denom, 2)


# ── JD drafting (Gemini-assisted) ────────────────────────────────────

_JD_SYSTEM = (
    "You are an expert technical recruiter and copywriter. Given a short plain-text brief "
    "about a role, write a complete, well-structured job description in Markdown with these "
    "sections: a 2-3 sentence overview, 'Responsibilities' (5-8 bullets), 'Requirements' "
    "(5-8 bullets), and 'Nice to have' (3-5 bullets). Keep it concrete and free of fluff, "
    "buzzwords, and salary/benefit claims you were not given. Return ONLY the Markdown body — "
    "no title heading, no preamble, no code fences."
)


async def draft_job_description(
    *,
    brief: str,
    title: Optional[str] = None,
    domain: Optional[str] = None,
    experience_level: Optional[str] = None,
    location: Optional[str] = None,
    skills: Optional[List[str]] = None,
) -> str:
    client = _get_client()
    ctx_lines = [f"Brief: {brief}"]
    if title:
        ctx_lines.append(f"Role title: {title}")
    if domain:
        ctx_lines.append(f"Domain: {domain}")
    if experience_level:
        ctx_lines.append(f"Experience level: {experience_level}")
    if location:
        ctx_lines.append(f"Location: {location}")
    if skills:
        ctx_lines.append(f"Key skills: {', '.join(skills)}")

    config = genai_types.GenerateContentConfig(
        system_instruction=_JD_SYSTEM,
        temperature=0.4,
        max_output_tokens=2048,
        http_options=genai_types.HttpOptions(timeout=45_000),
    )
    last_error: Optional[Exception] = None
    for model_name in _MODEL_CANDIDATES:
        try:
            response = await client.aio.models.generate_content(
                model=model_name, contents=["\n".join(ctx_lines)], config=config,
            )
            text = (response.text or "").strip()
            text = re.sub(r"^```(?:markdown)?\s*", "", text, flags=re.IGNORECASE)
            text = re.sub(r"\s*```$", "", text).strip()
            if text:
                return text
            raise ValueError("Empty draft from model.")
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            logger.warning("JD draft model %s failed (%s) — next fallback…", model_name, type(exc).__name__)
            continue
    raise ValueError(f"JD drafting failed after all model fallbacks: {last_error}") from last_error
