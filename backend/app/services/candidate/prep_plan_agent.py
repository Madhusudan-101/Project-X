"""
Preparation Plan Agent — prep_plan_agent.py
──────────────────────────────────────────
Turns ONE candidate's existing job-scoped scoring breakdown + the drive's
ACTUAL round list into a personalized, time-boxed preparation plan for
THAT job. Nothing is invented: every recommendation is grounded in the
data passed in (required_skills, the 5-dimension breakdown, skills_match,
the real round list, and days remaining).

Model : gemini-3.5-flash (with fallbacks), google-genai SDK — same pattern
        as job_scoring_agent.score_application.
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

# Bump when SYSTEM_INSTRUCTION changes materially.
MODEL_VERSION_LABEL = "prep-plan-v1"


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add it to your .env file.")
    return genai.Client(api_key=api_key)


# ── Response schema (Pydantic) ───────────────────────────────────────

class PrepPriority(BaseModel):
    title: str = Field(..., description="The single highest-leverage fix, one phrase.")
    why: str = Field(..., description="Why — in terms of THIS job's weights and JD requirements.")


class PrepPhase(BaseModel):
    name: str = Field(..., description="Foundation | Skill Building | OA Prep | Interview Prep")
    applies: bool = Field(..., description="False when this phase does not apply to this candidate/drive.")
    timeframe: str = Field(..., description="Realistic window, fitting inside days-remaining if given.")
    action_items: List[str] = Field(
        default_factory=list,
        description="Concrete things to do today. Empty when applies=false.",
    )


class PrepPlanResult(BaseModel):
    headline: str
    standing_summary: str
    priority_focus: PrepPriority
    phases: List[PrepPhase]
    estimated_prep_time: str


_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "standing_summary": {"type": "string"},
        "priority_focus": {
            "type": "object",
            "properties": {"title": {"type": "string"}, "why": {"type": "string"}},
            "required": ["title", "why"],
        },
        "phases": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "applies": {"type": "boolean"},
                    "timeframe": {"type": "string"},
                    "action_items": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "applies", "timeframe", "action_items"],
            },
        },
        "estimated_prep_time": {"type": "string"},
    },
    "required": [
        "headline",
        "standing_summary",
        "priority_focus",
        "phases",
        "estimated_prep_time",
    ],
}


SYSTEM_INSTRUCTION = (
    "You are building a personalized preparation plan for ONE candidate applying to ONE\n"
    "specific job. You are given: the job description, its required skills, the job's\n"
    "weight config, this candidate's existing 5-dimension scoring breakdown (with\n"
    "rationale and evidence), the already-computed skills_match (matched / missing\n"
    "skills against this JD), and the list of actual rounds this drive will run\n"
    "(round_type + mode for each, e.g. \"tech / ai\", \"hr / live\"). You may also be given\n"
    "how many days remain until the OA window or the apply deadline.\n\n"
    "Ground every recommendation ONLY in the data given. Never invent a skill,\n"
    "technology, or round that isn't present in required_skills, the resume/portfolio\n"
    "data, or the drive's actual round list. If information is missing, say so instead\n"
    "of guessing.\n\n"
    "Produce a strict JSON object matching the schema:\n\n"
    "1. headline — one sentence, specific to this candidate and this job. Not a\n"
    "   generic \"keep improving\" line. Reference the actual role or company domain.\n\n"
    "2. standing_summary — 2-3 sentences on where this candidate stands for THIS job\n"
    "   today, referencing their weighted_composite position and the skills_match\n"
    "   coverage_pct. Calibrated, not falsely encouraging and not discouraging.\n\n"
    "3. priority_focus — the SINGLE highest-leverage fix. Determine this by combining\n"
    "   two things: (a) which dimension scores lowest relative to how much weight this\n"
    "   job places on it, and (b) which required_skills are in skills_match.missing.\n"
    "   If a missing skill and a weak weighted dimension point the same direction,\n"
    "   that's the priority. State the \"why\" in terms of this specific job's weights\n"
    "   and this specific JD's requirements, not generic advice.\n\n"
    "4. phases — build phases ONLY for what applies to this candidate and this drive:\n"
    "   a. \"Foundation\" — always include if any dimension has a low score or missing\n"
    "      evidence. Action items should be things fixable in days (resume wording,\n"
    "      pinning right GitHub repos, filling missing portfolio links).\n"
    "   b. \"Skill Building\" — always include if skills_match.missing is non-empty.\n"
    "      Action items must name the exact missing skill and a concrete, scoped\n"
    "      action (e.g. \"Build one small project using X\" not \"learn X\"). Do not pad\n"
    "      with skills already in skills_match.matched.\n"
    "   c. \"OA Prep\" — include ONLY if the drive's round list contains a round with\n"
    "      round_type other than 'hr'/'managerial' run in 'ai' mode (i.e. an\n"
    "      assessment-style round exists). If it doesn't exist in the given round\n"
    "      list, set applies=false and leave action_items empty. When it does apply,\n"
    "      tailor difficulty/topics to the JD's required_skills and experience_level,\n"
    "      not a generic DSA list.\n"
    "   d. \"Interview Prep\" — include ONLY if the round list contains a round of\n"
    "      mode 'live' or 'ai' with round_type in ('tech','hr','managerial'). Tailor\n"
    "      content to which round_type(s) actually exist for this drive: tech rounds\n"
    "      get technical prep tied to required_skills, hr/managerial rounds get\n"
    "      behavioral prep tied to the JD's seniority level (experience_level).\n"
    "   For every phase that applies, set a realistic timeframe. If days-remaining\n"
    "   until the OA window or apply deadline was provided, timeframes must fit\n"
    "   inside that window, tightest phases first — do not suggest a 3-week plan\n"
    "   when 5 days remain.\n\n"
    "5. estimated_prep_time — one short phrase, sum of the phases that apply, adjusted\n"
    "   down if the provided deadline is tighter than the ideal plan.\n\n"
    "Tone: direct and practical, like a mentor, not a motivational poster. No filler\n"
    "sentences (\"you've got this!\", \"stay positive\"). Every action item must be\n"
    "something the candidate can actually go do today, not an abstract goal.\n\n"
    "Never wrap the JSON in prose or markdown fences."
)


def _truncate(text: str, limit: int = 6000) -> str:
    return text if len(text) <= limit else text[:limit] + "\n…[truncated]"


def _dimensions_text(dimensions: Dict[str, Any], weights: Dict[str, int]) -> str:
    order = ("resume", "github", "leetcode", "interview", "assessment")
    lines = ["CANDIDATE 5-DIMENSION BREAKDOWN (score / weight — rationale — evidence):"]
    for dim in order:
        d = dimensions.get(dim) or {}
        score = d.get("score")
        w = weights.get(f"{dim}_weight", 0)
        rationale = (d.get("rationale") or "").strip()
        evidence = d.get("evidence") or []
        lines.append(
            f"  {dim}: score={score if score is not None else 'null'} weight={w}\n"
            f"    rationale: {rationale}\n"
            f"    evidence: {'; '.join(evidence) if evidence else '(none)'}"
        )
    return "\n".join(lines)


def _rounds_text(rounds: List[Dict[str, Any]]) -> str:
    if not rounds:
        return "DRIVE ROUND LIST: (no rounds configured for this drive)"
    lines = ["DRIVE ROUND LIST (in order):"]
    for r in sorted(rounds, key=lambda x: x.get("round_number", 0)):
        lines.append(
            f"  Round {r.get('round_number')}: {r.get('round_type')} / {r.get('mode')}"
        )
    return "\n".join(lines)


async def generate_prep_plan(
    *,
    job: Dict[str, Any],
    required_skills: List[str],
    weights: Dict[str, int],
    analysis_json: Dict[str, Any],
    weighted_composite: float,
    placement_probability: Optional[float],
    rounds: List[Dict[str, Any]],
    days_until_oa: Optional[int] = None,
    days_until_deadline: Optional[int] = None,
) -> PrepPlanResult:
    """Run the Gemini prep-plan generation. Raises RuntimeError (no API key),
    ValueError (unparseable output), or the underlying SDK error."""
    client = _get_client()

    import json

    skills_match = analysis_json.get("skills_match") or {}
    dimensions = analysis_json.get("dimensions") or {}

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
        f"  Employment type: {job.get('employment_type', '')}\n"
        f"  Required skills: {', '.join(required_skills) or '(none listed)'}\n\n"
        f"  Full description:\n{_truncate(job.get('description', ''))}\n"
    )
    standing_text = (
        "CURRENT STANDING FOR THIS JOB:\n"
        f"  weighted_composite: {weighted_composite}\n"
        f"  placement_probability: "
        f"{placement_probability if placement_probability is not None else 'unknown'}\n"
        f"  skills_match.coverage_pct: {skills_match.get('coverage_pct', 'unknown')}\n"
        f"  skills_match.matched: {', '.join(skills_match.get('matched', [])) or '(none)'}\n"
        f"  skills_match.missing: {', '.join(skills_match.get('missing', [])) or '(none)'}\n"
    )
    timing_lines = []
    if days_until_oa is not None:
        timing_lines.append(f"  Days until the OA window opens: {days_until_oa}")
    if days_until_deadline is not None:
        timing_lines.append(f"  Days until the apply deadline: {days_until_deadline}")
    timing_text = (
        "TIME REMAINING:\n" + "\n".join(timing_lines)
        if timing_lines
        else "TIME REMAINING: (not provided — do not assume a deadline)"
    )

    contents: List[Any] = [
        jd_text,
        weights_text,
        standing_text,
        _dimensions_text(dimensions, weights),
        "RECRUITER VERDICT (context): "
        + json.dumps(analysis_json.get("recruiter_verdict") or {}, default=str),
        _rounds_text(rounds),
        timing_text,
    ]

    config = genai_types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        response_mime_type="application/json",
        response_schema=_RESPONSE_SCHEMA,
        temperature=0.3,
        max_output_tokens=4096,
        http_options=genai_types.HttpOptions(timeout=60_000),
    )

    last_error: Optional[Exception] = None
    for model_name in _MODEL_CANDIDATES:
        try:
            logger.info("Prep-plan generation with model: %s", model_name)
            response = await client.aio.models.generate_content(
                model=model_name, contents=contents, config=config,
            )
            raw = (response.text or "").strip()
            raw = re.sub(r"^```json\s*", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"\s*```$", "", raw).strip()
            return PrepPlanResult.model_validate_json(raw)
        except Exception as exc:  # noqa: BLE001 — mirror job_scoring_agent fallback
            last_error = exc
            err = str(exc)
            if any(
                tok in err
                for tok in ("429", "503", "504", "UNAVAILABLE", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED")
            ) or "validation error" in err.lower() or "json" in err.lower():
                logger.warning("Model %s failed (%s) — trying next fallback…", model_name, type(exc).__name__)
                continue
            raise
    raise ValueError(f"Prep-plan generation failed after all model fallbacks: {last_error}") from last_error
