"""
Gemini Analyzer Agent — analyzer_agent.py
──────────────────────────────────────────
Sends the formatted developer metrics to Google Gemini and returns a
strict, structured JSON employability & authenticity analysis.

Model  : gemini-3.5-flash  (fast, cheap, structured-output capable)
SDK    : google-genai  (the new, supported SDK)
Output : Enforced via ``response_mime_type="application/json"`` +
         ``response_schema`` so the model *never* returns conversational text.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from .formatter import FormattedMetrics

logger = logging.getLogger(__name__)

# ── Response Schema (what Gemini must return) ─────────────────────────


class AnalysisResult(BaseModel):
    """Structured analysis output enforced by the Gemini response_schema."""

    overall_score: int = Field(
        ...,
        ge=0,
        le=100,
        description=(
            "Composite employability score (0–100) weighting consistency, "
            "depth of problem-solving, and authenticity of activity."
        ),
    )
    consistency_rating: str = Field(
        ...,
        description="One of: Poor, Average, Good, Elite.",
    )
    authenticity_flags: List[str] = Field(
        ...,
        description=(
            "List of red-flag observations. Examples: 'Tutorial Hell — "
            "70 % of repos are unmodified forks', 'Artificial commit padding "
            "— 45 commits pushed on a single day'. Empty list if clean."
        ),
    )
    strengths_summary: str = Field(
        ...,
        description=(
            "Two-to-four sentence paragraph highlighting the candidate's "
            "strongest signals: languages, streak discipline, hard-problem "
            "ratio, and original project quality."
        ),
    )


# ── System Instruction ────────────────────────────────────────────────

_SYSTEM_INSTRUCTION: str = """\
You are an elite technical recruiter and engineering hiring manager with \
15 years of experience evaluating developer portfolios.

You will receive a JSON payload containing a developer's GitHub and \
LeetCode metrics. Your job is to analyze this data and produce a strict \
JSON assessment. Do NOT output conversational text — output ONLY the \
JSON object matching the required schema.

## Scoring Criteria

### Consistency & Hard Work (40 % of score)
- Look at **longest_streak_days**, **current_streak_days**, and \
  **unique_active_days** on both platforms.
- Compare **avg_per_active_day** — steady daily work (1–5/day) is far \
  better than cramming 50 in one day.
- A **largest_gap_days** > 30 is a yellow flag; > 90 is a red flag.
- Reward candidates who show activity across **multiple days of the week** \
  (day_of_week_distribution).

### Depth & Skill (30 % of score)
- **LeetCode hard ratio**: solving > 15 % hard problems is strong signal.
- **Original repositories** vs forks: more original repos with > 100 KB \
  size indicates real project work.
- **Top languages** diversity: 3–5 languages shows breadth without being \
  unfocused.
- **Stars received**: community validation.

### Authenticity — Fake Activity Detection (30 % of score)
Deduct points and add to ``authenticity_flags`` for:
- **Tutorial Hell**: fork_ratio > 0.6 — the user forks popular repos \
  without building anything original.
- **Commit Padding**: days_with_10plus > 5 combined with \
  avg_per_active_day > 8 — suggests scripted/artificial commits.
- **Ghost Repos**: many repos with size_kb < 10 — empty placeholder repos.
- **Single-Day Cramming**: busiest_single_day count > 30 on LeetCode \
  or > 20 on GitHub is suspicious.
- **Zero Activity Mismatch**: having 10+ repos but 0 recent commit events \
  suggests old/abandoned work.

If there are NO red flags, set ``authenticity_flags`` to an empty list.

## Rating Bands
- **Elite**:  score ≥ 85
- **Good**:   score 65–84
- **Average**: score 40–64
- **Poor**:   score < 40

Be fair but rigorous. A new developer with a short but genuine streak \
should still score decently if their activity is authentic.\
"""

# ── Gemini Schema (dict form for the SDK) ─────────────────────────────

_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "overall_score": {
            "type": "integer",
            "description": "Employability score 0-100",
        },
        "consistency_rating": {
            "type": "string",
            "enum": ["Poor", "Average", "Good", "Elite"],
            "description": "Rating band",
        },
        "authenticity_flags": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Red-flag observations, empty list if clean",
        },
        "strengths_summary": {
            "type": "string",
            "description": "2-4 sentence paragraph on candidate strengths",
        },
    },
    "required": [
        "overall_score",
        "consistency_rating",
        "authenticity_flags",
        "strengths_summary",
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
        temperature=0.2,        # low temp → deterministic, consistent scores
        max_output_tokens=1024,
    )

    # Try each model in order until one succeeds
    last_error: Exception | None = None
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
    raw_text: str = response.text
    logger.debug("Gemini raw response: %s", raw_text[:500])

    try:
        parsed: Dict[str, Any] = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        logger.error("Gemini returned invalid JSON: %s", exc)
        raise ValueError(f"Gemini returned invalid JSON: {exc}") from exc

    return AnalysisResult(**parsed)

