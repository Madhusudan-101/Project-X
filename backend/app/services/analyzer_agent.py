"""
Gemini Analyzer Agent — analyzer_agent.py
──────────────────────────────────────────
Sends the formatted developer metrics to Google Gemini and returns a
strict, structured JSON employability & authenticity analysis.

Model  : gemini-3.5-flash  (fast, cheap, structured-output capable)
SDK    : google-genai  (the new, supported SDK)
Output : Enforced via Pydantic model validation and structured schema response
         so the model *never* returns conversational text.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Literal

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from .formatter import FormattedMetrics

logger = logging.getLogger(__name__)

# ── Response Schema (Pydantic V2) ─────────────────────────────────────


class ConsistencyAnalysis(BaseModel):
    rating: Literal["Sustained", "Fragmented", "Spiky"] = Field(
        ...,
        description="Rating of trailing activity pacing, tracking long-term habits."
    )
    evaluation: str = Field(
        ...,
        description="Brief structural assessment of their pace over time, looking past broken streaks."
    )


class LeetCodeSkills(BaseModel):
    strong_topics: List[str] = Field(
        ...,
        description="Key algorithmic topic areas where the candidate exhibits solid proficiency."
    )
    growth_areas: List[str] = Field(
        ...,
        description="Algorithmic areas that need more attention or practice based on their topic counts."
    )
    algorithmic_depth_summary: str = Field(
        ...,
        description="1-2 sentence summary of their DSA capabilities based on their tag problem counts mapping."
    )


class ProjectRigorEntry(BaseModel):
    repo_name: str = Field(
        ...,
        description="Name of the public candidate repository."
    )
    inferred_complexity: Literal["Low", "Medium", "High", "Advanced"] = Field(
        ...,
        description="Inferred code complexity based on project scale, architecture, and readme text."
    )
    skills_developed: List[str] = Field(
        ...,
        description="Key software engineering/architectural skills developed or showcased by this project."
    )
    analysis: str = Field(
        ...,
        description="Short, focused analysis of their problem-solving depth based on the README snippet."
    )


class CareerAlignment(BaseModel):
    recommended_roles: List[str] = Field(
        ...,
        description="Typical industry software engineering roles suited to their skill profiles."
    )
    green_flags: List[str] = Field(
        ...,
        description="Authentic engineering indicators, clear designs, or well-distributed knowledge flags."
    )
    red_flags: List[str] = Field(
        ...,
        description="Red flag observations, tutorial hell indicators, shallow clones, or topic gaps."
    )


class AnalysisResult(BaseModel):
    overall_score: int = Field(
        ...,
        ge=0,
        le=100,
        description="Composite score (0–100) weighting engineering authenticity, project complexity, and skill depth."
    )
    consistency_analysis: ConsistencyAnalysis = Field(
        ...,
        description="Long-term activity distribution analysis."
    )
    leetcode_skills: LeetCodeSkills = Field(
        ...,
        description="Topic-wise algorithmic proficiency breakdown."
    )
    project_rigor: List[ProjectRigorEntry] = Field(
        ...,
        description="Per-repository complexity and implementation rigor review."
    )
    career_alignment: CareerAlignment = Field(
        ...,
        description="Candidate's green flags, red flags, and recommended career roles."
    )
    actionable_feedback: str = Field(
        ...,
        description="Direct paragraph advising the candidate on clear next milestones and concrete goals."
    )


# ── System Instruction ────────────────────────────────────────────────

_SYSTEM_INSTRUCTION: str = """\
You are an expert technical evaluator, seasoned engineering hiring manager, and engineering mentor. \
You will be provided with an expanded JSON payload containing deep technical signals from a candidate's GitHub and LeetCode profiles.

Your objective is to analyze this data thoroughly and output a strict JSON object that conforms exactly to the required output schema. \
Do NOT wrap your output in conversational filler.

## Portfolio Evaluation Framework

### 1. Consistency & Pacing (Sustained over Streaks)
- Do NOT penalize candidates strictly for missing a few days or having a broken "streak." Students and professionals have exams, health concerns, or legitimate breaks.
- Instead, measure "Sustained Consistency": evaluate the density and distribution of GitHub commit timestamps and LeetCode submission calendars over trailing 30, 90, and 180-day windows.
- Look at the "Frequency Vector": Is work distributed reasonably across weeks/months, or is there a single-day massive dump of 50+ commits/submissions (which indicates script/tutorial copying)?

### 2. LeetCode Skill & Topic Distribution (The Circle Cloud Analysis)
- Analyze the user's LeetCode topic-wise solving breakdown (extracted from their profile's tag-based problem-solving cloud).
- Map their stats (e.g., Dynamic Programming, Arrays, Graphs, Trees, Strings) to identify core structural competencies.
- Pinpoint specific high-level target topics that need more attention or practice based on low problem count relative to their overall tier.

### 3. GitHub Project Depth & Rigor (README Analysis)
- Evaluate the injected text content of the public repositories' README files.
- Assess the functional complexity, engineering challenge, and architectural requirements implied by the project setup (e.g., concurrency, low-level compilation, memory management, complex data structures).
- Determine what problem-solving, analytical, and systems thinking skills this project natively develops. Identify "Ghost Repos" (empty placeholder clones) and exclude/flag them.

### 4. Career Alignment (Green Flags & Red Flags)
- Project the candidate's portfolio against typical standard industry tech roles (e.g., Backend Engineer, Systems/Embedded Engineer, Full-Stack Developer).
- Provide explicit, actionable feedback using:
  - **Green Flags:** Authentic engineering indicators (e.g., clear design documentation, original core project logic, well-distributed topic knowledge).
  - **Red Flags:** Structural gaps or warning signs (e.g., "Tutorial Hell" clone copies, shallow empty repos, major topic asymmetry where critical fundamentals are untouched).
"""

# ── Gemini Schema (dict form for the SDK to avoid nested ref schema errors) ─────────────────────────────

_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "overall_score": {
            "type": "integer",
            "description": "Composite score (0–100) weighting engineering authenticity and skill depth.",
        },
        "consistency_analysis": {
            "type": "object",
            "properties": {
                "rating": {
                    "type": "string",
                    "enum": ["Sustained", "Fragmented", "Spiky"],
                    "description": "Activity pacing rating.",
                },
                "evaluation": {
                    "type": "string",
                    "description": "Assessment of trailing activity and habits, looking past broken streaks.",
                },
            },
            "required": ["rating", "evaluation"],
        },
        "leetcode_skills": {
            "type": "object",
            "properties": {
                "strong_topics": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Strongest algorithmic topic areas.",
                },
                "growth_areas": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Topic areas needing more practice.",
                },
                "algorithmic_depth_summary": {
                    "type": "string",
                    "description": "Overview of DSA capabilities based on their tag data cloud.",
                },
            },
            "required": ["strong_topics", "growth_areas", "algorithmic_depth_summary"],
        },
        "project_rigor": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "repo_name": {
                        "type": "string",
                        "description": "Repository name.",
                    },
                    "inferred_complexity": {
                        "type": "string",
                        "enum": ["Low", "Medium", "High", "Advanced"],
                        "description": "Inferred repository implementation complexity.",
                    },
                    "skills_developed": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Key software engineering/architectural skills developed.",
                    },
                    "analysis": {
                        "type": "string",
                        "description": "Short analysis of code and problem-solving complexity based on README text.",
                    },
                },
                "required": ["repo_name", "inferred_complexity", "skills_developed", "analysis"],
            },
            "description": "Per-repository rigor analysis.",
        },
        "career_alignment": {
            "type": "object",
            "properties": {
                "recommended_roles": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Target software engineering roles suited to their skills.",
                },
                "green_flags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Authentic engineering indicators observed.",
                },
                "red_flags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Warning signs or gaps observed.",
                },
            },
            "required": ["recommended_roles", "green_flags", "red_flags"],
        },
        "actionable_feedback": {
            "type": "string",
            "description": "Paragraph advising candidate on concrete next milestone goals.",
        },
    },
    "required": [
        "overall_score",
        "consistency_analysis",
        "leetcode_skills",
        "project_rigor",
        "career_alignment",
        "actionable_feedback",
    ],
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


async def run_analysis(formatted: FormattedMetrics) -> AnalysisResult:
    """
    Send the formatted developer metrics to Gemini and return a
    structured ``AnalysisResult``.

    Uses the new ``google-genai`` SDK with ``aio`` for async calls.
    Tries multiple models in order if the primary is unavailable.
    """
    client = _get_client()

    # Build the user prompt — just the data, no instructions
    prompt = (
        "Analyze the following developer metrics and return the JSON assessment.\n\n"
        + formatted.model_dump_json(indent=2)
    )

    logger.info("Sending %d-char prompt to Gemini", len(prompt))

    config = types.GenerateContentConfig(
        system_instruction=_SYSTEM_INSTRUCTION,
        response_mime_type="application/json",
        response_schema=_RESPONSE_SCHEMA,
        temperature=0.15,
        max_output_tokens=8192,
    )

    # Try each model in order until one succeeds
    last_error: Exception | None = None
    response = None
    for model_name in _MODEL_CANDIDATES:
        try:
            logger.info("Trying model: %s", model_name)
            response = await client.aio.models.generate_content(
                model=model_name,
                contents=prompt,
                config=config,
            )
            logger.info("Success with model: %s", model_name)
            break
        except Exception as exc:
            last_error = exc
            err_str = str(exc)
            # Retry with next model on 429 (rate limit) or 503 (unavailable)
            if "429" in err_str or "503" in err_str or "UNAVAILABLE" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                logger.warning("Model %s unavailable (%s), trying next fallback…", model_name, type(exc).__name__)
                continue
            # For other errors (auth, bad request, etc.) don't retry
            raise
    else:
        # All models failed
        raise last_error  # type: ignore[misc]

    # Parse the structured JSON response
    raw_text: str = response.text or ""
    logger.debug("Gemini raw response: %s", raw_text[:500])

    # Clean up json formatting wrappers (e.g. ```json ... ```)
    raw_text = re.sub(r"^```json\s*", "", raw_text, flags=re.IGNORECASE)
    raw_text = re.sub(r"\s*```$", "", raw_text)
    raw_text = raw_text.strip()

    try:
        # Validate and instantiate using Pydantic V2 model_validate_json
        return AnalysisResult.model_validate_json(raw_text)
    except Exception as exc:
        logger.error("Gemini output failed validation: %s. Raw text: %s", exc, raw_text)
        raise ValueError(f"Gemini output failed validation: {exc}") from exc
