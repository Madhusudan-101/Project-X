"""Draft a rubric for a role with Gemini, so a hiring team does not start from a blank page.

The draft is a starting point the company edits. Whatever the model returns is validated and
re-weighted by rubric.normalize_draft before it reaches the company.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from google.genai import types as genai_types

from ..candidate.cover_letter_agent import _MODEL_CANDIDATES, _get_client
from .rubric import MAX_COMPETENCIES, normalize_draft

logger = logging.getLogger(__name__)

_SYSTEM = (
    "You design interview rubrics for an AI interviewer that runs a voice interview. Given a role, a level "
    "and optionally a job description, propose 4 to 6 competencies the interview should assess. Prefer "
    "competencies that can be judged from a spoken conversation (reasoning, depth, trade-offs, "
    "communication), not things that need a screen or a take-home.\n\n"
    "Return ONLY a JSON array. Each item: {\"name\": short title (max 5 words), \"description\": one "
    "sentence on what a strong answer looks like, \"weight\": a number for relative importance, "
    "\"questions\": up to 2 open-ended seed questions, \"expected_concepts\": a short list of terms and ideas a "
    "correct answer should show}. Use only what the role and description support; do not invent "
    "requirements. Never include anything about age, gender, nationality, family, health or other "
    "protected characteristics. No markdown, no preamble."
)


def _truncate(text: str, limit: int = 6000) -> str:
    return text if len(text) <= limit else text[:limit] + "\n…[truncated]"


def parse_model_json(text: str) -> Any:
    """Models sometimes wrap JSON in a code fence or add a sentence; take the first JSON value."""
    cleaned = re.sub(r"^```(?:json)?\s*", "", (text or "").strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"(\[.*\]|\{.*\})", cleaned, flags=re.DOTALL)
        if not m:
            raise ValueError("The model did not return JSON.")
        return json.loads(m.group(1))


async def draft_rubric(
    role_title: str, level: str, description: str = "", *, client: Optional[Any] = None
) -> List[Dict[str, Any]]:
    """Returns a valid rubric (1 to MAX_COMPETENCIES competencies, weights adding to 100).

    Raises RuntimeError when no Gemini key is configured, and ValueError when the model's answer
    had nothing usable after every fallback.
    """
    client = client or _get_client()
    prompt = (
        f"Role: {role_title}\nLevel: {level}\nMaximum competencies: {MAX_COMPETENCIES}\n\n"
        f"Job description:\n{_truncate(description) if description.strip() else '(none given)'}"
    )
    config = genai_types.GenerateContentConfig(
        system_instruction=_SYSTEM,
        temperature=0.4,
        max_output_tokens=2500,
        http_options=genai_types.HttpOptions(timeout=45_000),
    )
    last: Optional[Exception] = None
    for model_name in _MODEL_CANDIDATES:
        try:
            response = await client.aio.models.generate_content(
                model=model_name, contents=[prompt], config=config
            )
            rubric = normalize_draft(parse_model_json(response.text or ""))
            if rubric:
                return rubric
            raise ValueError("No usable competencies in the draft.")
        except Exception as exc:  # noqa: BLE001 - try the next model
            last = exc
            logger.warning("Rubric draft model %s failed (%s)", model_name, type(exc).__name__)
    raise ValueError(f"Could not draft a rubric: {last}") from last
