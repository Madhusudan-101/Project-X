"""
Screener Answer Agent — screener_answer_agent.py
───────────────────────────────────────────────
Drafts an answer to EACH of a job's screening questions for ONE candidate,
at APPLY time. No precomputed skills_match exists yet — the model matches
the resume against the required skills itself in this same call.

For a question that asks for a specific FACT the resume does not contain
(years of experience with X, notice period, salary expectation, work
authorization, availability date, …), the model returns a short best-guess
/ placeholder answer AND sets student_input_required=true so the UI can
flag it for the student to fill in.

Model : gemini-3.5-flash (with fallbacks), google-genai SDK.
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


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add it to your .env file.")
    return genai.Client(api_key=api_key)


class DraftedAnswer(BaseModel):
    question_id: str
    answer: str = Field(..., description="Drafted answer, or a placeholder when input is required.")
    student_input_required: bool = Field(
        ...,
        description="True when the question asks for a fact not present in the resume.",
    )


class _ScreenerResult(BaseModel):
    answers: List[DraftedAnswer]


_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "answers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question_id": {"type": "string"},
                    "answer": {"type": "string"},
                    "student_input_required": {"type": "boolean"},
                },
                "required": ["question_id", "answer", "student_input_required"],
            },
        }
    },
    "required": ["answers"],
}


_SYSTEM = (
    "You are drafting answers to a job's screening questions for a candidate, at the moment "
    "they apply. You are given the candidate's resume text, the job description, the required "
    "skills, and the list of questions (each with an id). There is NO precomputed skills "
    "match — do your own matching from the resume in this same pass.\n\n"
    "For EACH question, produce one object: { question_id, answer, student_input_required }.\n"
    "- If the answer can be grounded in the resume (a skill, a project, relevant experience), "
    "write a direct, 1-3 sentence answer using only what's actually in the resume, and set "
    "student_input_required=false.\n"
    "- If the question asks for a specific fact the resume does not state — years of hands-on "
    "experience with a named technology, notice period, current/expected salary, work "
    "authorization / visa status, earliest start date, willingness to relocate, a specific "
    "certification — write a short neutral placeholder (e.g. '[Add your notice period]') and "
    "set student_input_required=true.\n"
    "Never fabricate an employer, number, date, or credential. Answer every question exactly "
    "once, echoing its question_id verbatim. Return ONLY the JSON object, no prose, no fences."
)


def _truncate(text: str, limit: int = 12000) -> str:
    return text if len(text) <= limit else text[:limit] + "\n…[truncated]"


async def draft_screener_answers(
    *,
    resume_text: str,
    job: Dict[str, Any],
    required_skills: List[str],
    questions: List[Dict[str, Any]],
) -> List[DraftedAnswer]:
    """`questions` is a list of {id, question_text, required}. Returns one
    DraftedAnswer per question (best-effort — a question the model skipped
    is backfilled as student_input_required)."""
    if not questions:
        return []

    client = _get_client()

    jd_text = (
        "JOB DESCRIPTION\n"
        f"  Title: {job.get('title', '')}\n"
        f"  Domain: {job.get('domain', '')}\n"
        f"  Experience level: {job.get('experience_level', '')}\n"
        f"  Required skills: {', '.join(required_skills) or '(none listed)'}\n\n"
        f"  Full description:\n{_truncate(job.get('description', ''), 5000)}\n"
    )
    q_text = "SCREENING QUESTIONS:\n" + "\n".join(
        f"  id={q['id']}  required={q.get('required', True)}  {q['question_text']}"
        for q in questions
    )
    contents: List[Any] = [
        jd_text,
        "CANDIDATE RESUME TEXT:\n" + _truncate(resume_text or "(no resume text on file)"),
        q_text,
    ]
    config = genai_types.GenerateContentConfig(
        system_instruction=_SYSTEM,
        response_mime_type="application/json",
        response_schema=_RESPONSE_SCHEMA,
        temperature=0.3,
        max_output_tokens=2048,
        http_options=genai_types.HttpOptions(timeout=45_000),
    )

    last_error: Optional[Exception] = None
    for model_name in _MODEL_CANDIDATES:
        try:
            response = await client.aio.models.generate_content(
                model=model_name, contents=contents, config=config,
            )
            raw = (response.text or "").strip()
            raw = re.sub(r"^```json\s*", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"\s*```$", "", raw).strip()
            parsed = _ScreenerResult.model_validate_json(raw)
            by_id = {a.question_id: a for a in parsed.answers}
            # Backfill any question the model omitted so the UI always has a row.
            out: List[DraftedAnswer] = []
            for q in questions:
                a = by_id.get(q["id"])
                out.append(
                    a
                    if a
                    else DraftedAnswer(question_id=q["id"], answer="", student_input_required=True)
                )
            return out
        except Exception as exc:  # noqa: BLE001 — mirror job_scoring_agent fallback
            last_error = exc
            err = str(exc)
            if any(
                tok in err
                for tok in ("429", "503", "504", "UNAVAILABLE", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED")
            ) or "validation error" in err.lower() or "json" in err.lower():
                logger.warning(
                    "Screener model %s failed (%s) — next fallback…", model_name, type(exc).__name__
                )
                continue
            raise
    raise ValueError(f"Screener drafting failed after all model fallbacks: {last_error}") from last_error
