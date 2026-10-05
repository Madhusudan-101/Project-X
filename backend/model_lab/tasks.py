"""
Task definitions. Each task reuses the *production* system prompt, response
schema and pydantic validator from app.services.candidate, so a model is judged
on exactly what the app asks of Gemini today.

The user-message construction mirrors the production agents
(resume_analyzer_agent.analyze_resume, job_scoring_agent.score_application,
linkedin_analyzer_agent.analyze_linkedin). If those change materially, update
the builders here — they're intentionally the only copy.
"""

from __future__ import annotations

import io
import json
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel
from pypdf import PdfReader

from app.services.candidate import job_scoring_agent as job
from app.services.candidate import linkedin_analyzer_agent as li
from app.services.candidate import resume_analyzer_agent as rs
from app.services.candidate.job_scoring_agent import compute_weighted_composite

from .providers import PdfInput


@dataclass
class Inputs:
    resume_pdf: Optional[bytes] = None
    linkedin_pdf: Optional[bytes] = None
    target_role: str = "Software Engineer"
    portfolio_json: str = ""
    prior_audit_json: str = ""
    portfolio_notes: List[str] = field(default_factory=list)  # verification notes from model_lab.portfolio
    job_title: str = ""
    job_domain: str = ""
    job_experience: str = ""
    job_location: str = ""
    job_description: str = ""
    job_skills: List[str] = field(default_factory=list)
    weights: Dict[str, int] = field(default_factory=lambda: {
        "resume_weight": 30, "github_weight": 25, "leetcode_weight": 25,
        "interview_weight": 10, "assessment_weight": 10,
    })
    native_pdf: bool = False  # send PDFs natively to models that support it


@dataclass
class Prompt:
    system: str
    user_parts: List[str]
    pdfs: List[PdfInput]


@dataclass
class Task:
    id: str
    label: str
    description: str
    needs: List[str]  # which uploads are required: resume / linkedin
    schema: Dict[str, Any]
    model_cls: type[BaseModel]
    max_output_tokens: int
    build: Callable[[Inputs, bool], Prompt]  # (inputs, native_pdf_for_this_model)
    headline: Callable[[BaseModel, Inputs], Dict[str, Any]]


def extract_pdf_text(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n".join(p.extract_text() or "" for p in reader.pages).strip()
    except Exception:
        return ""


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "\n…[truncated]"


def _portfolio(inp: Inputs) -> str:
    return inp.portfolio_json.strip() or "null (no verified GitHub / LeetCode / Codeforces data provided)"


def _resume_inputs(inp: Inputs, native: bool) -> tuple[List[str], List[PdfInput]]:
    """Resume as native PDF (production behaviour for Gemini) or extracted text + link targets."""
    assert inp.resume_pdf
    if native:
        return [], [PdfInput("resume.pdf", inp.resume_pdf)]
    text = extract_pdf_text(inp.resume_pdf) or "(no extractable text — scanned PDF?)"
    parts = ["CANDIDATE RESUME TEXT:\n" + text]
    links = rs.extract_pdf_hyperlinks(inp.resume_pdf)
    if links:
        parts.append("Hyperlink targets embedded in the resume PDF:\n" + "\n".join(links))
    return parts, []


# ── Task 1: resume authenticity audit ────────────────────────────────

def _build_resume(inp: Inputs, native: bool) -> Prompt:
    parts, pdfs = _resume_inputs(inp, native)
    parts += [
        f"Here are the candidate's actual verified coding metrics:\n{_portfolio(inp)}",
        f"The candidate's target tech role is: {inp.target_role}",
        f"Today's real-world date is {date.today().isoformat()}. Use this as the ONLY ground "
        "truth for any date/timeline reasoning in the resume.",
    ]
    parts += inp.portfolio_notes
    return Prompt(rs.SYSTEM_INSTRUCTION, parts, pdfs)


def _headline_resume(r: rs.ResumeAnalysisResult, _inp: Inputs) -> Dict[str, Any]:
    return {
        "score": r.overall_rating.score,
        "verdict": r.overall_rating.verdict,
        "discrepancies": len(r.detected_discrepancies),
        "strengths": len(r.strengths),
        "weaknesses": len(r.weaknesses),
    }


# ── Task 2: job-scoped scoring (the "dynamic scoring engine") ────────

def _build_job(inp: Inputs, native: bool) -> Prompt:
    w = inp.weights
    weights_text = (
        "JOB WEIGHT CONFIG (how much each dimension matters for THIS job, sums to 100):\n"
        f"  Resume:     {w.get('resume_weight', 0)}\n"
        f"  GitHub:     {w.get('github_weight', 0)}\n"
        f"  LeetCode:   {w.get('leetcode_weight', 0)}\n"
        f"  Interview:  {w.get('interview_weight', 0)}\n"
        f"  Assessment: {w.get('assessment_weight', 0)}\n"
    )
    jd_text = (
        "JOB DESCRIPTION\n"
        f"  Title: {inp.job_title}\n  Domain: {inp.job_domain}\n"
        f"  Experience level: {inp.job_experience}\n  Location: {inp.job_location}\n"
        f"  Required skills: {', '.join(inp.job_skills) or '(none listed)'}\n\n"
        f"  Full description:\n{_truncate(inp.job_description, 6000)}\n"
    )
    # The production scorer works from resume *text* (already cached), never the PDF.
    text = extract_pdf_text(inp.resume_pdf or b"") or "(no resume text on file)"
    parts = [
        jd_text, weights_text,
        "CANDIDATE RESUME TEXT:\n" + _truncate(text, 12000),
        "CANDIDATE VERIFIED PORTFOLIO METRICS (GitHub / LeetCode / Codeforces) JSON:\n"
        + (inp.portfolio_json.strip() or "null"),
        "PRIOR RESUME-AUTHENTICITY AUDIT JSON (context — not the JD-specific verdict):\n"
        + (inp.prior_audit_json.strip() or "null"),
    ]
    parts += inp.portfolio_notes
    return Prompt(job.SYSTEM_INSTRUCTION, parts, [])


def _headline_job(r: job.JobScoringResult, inp: Inputs) -> Dict[str, Any]:
    d = r.dimensions
    return {
        "score": compute_weighted_composite(d, inp.weights),
        "placement_probability": r.placement_probability,
        "verdict": r.recruiter_verdict.label,
        "recommendation": r.recruiter_verdict.recommendation,
        "dims": {k: getattr(d, k).score for k in ("resume", "github", "leetcode", "interview", "assessment")},
        "skills_coverage_pct": r.skills_match.coverage_pct,
    }


# ── Task 3: LinkedIn PDF audit ───────────────────────────────────────

def _build_linkedin(inp: Inputs, native: bool) -> Prompt:
    assert inp.linkedin_pdf
    if native:
        parts, pdfs = [], [PdfInput("linkedin.pdf", inp.linkedin_pdf)]
    else:
        parts = ["LINKEDIN PROFILE EXPORT (text extracted from the 'Save to PDF' file):\n"
                 + (extract_pdf_text(inp.linkedin_pdf) or "(no extractable text)")]
        pdfs = []
    if inp.resume_pdf:
        parts.append(
            f"The candidate's RESUME TEXT on file (target role: {inp.target_role}), for cross-checking "
            "company/role/duration/skills only — do not re-audit this resume, just compare its claims "
            f"against the LinkedIn export above:\n{extract_pdf_text(inp.resume_pdf)}"
        )
    else:
        parts.append("No resume analysis is on file for this candidate yet — cross_check_flags must be empty.")
    return Prompt(li.SYSTEM_INSTRUCTION, parts, pdfs)


def _headline_linkedin(r: li.LinkedInAnalysisResult, _inp: Inputs) -> Dict[str, Any]:
    if not r.is_valid_linkedin_export:
        return {"score": None, "verdict": "Not a LinkedIn export", "note": r.invalid_reason}
    strong = sum(1 for s in r.sections if s.rating == "Strong")
    return {
        "score": round(100 * strong / len(r.sections)) if r.sections else None,
        "verdict": f"{strong}/{len(r.sections)} sections Strong",
        "cross_check_flags": len(r.cross_check_flags),
    }


TASKS: Dict[str, Task] = {
    "resume": Task(
        "resume", "Resume audit",
        "Authenticity + role-fit audit of a resume vs. the target role (resume_analyzer_agent).",
        ["resume"], rs._RESPONSE_SCHEMA, rs.ResumeAnalysisResult, 16384, _build_resume, _headline_resume,
    ),
    "job_scoring": Task(
        "job_scoring", "Job scoring engine",
        "Per-job weighted scoring: 5 dimensions + skills match + verdict (job_scoring_agent).",
        ["resume"], job._RESPONSE_SCHEMA, job.JobScoringResult, 8192, _build_job, _headline_job,
    ),
    "linkedin": Task(
        "linkedin", "LinkedIn audit",
        "Section-by-section LinkedIn PDF review, cross-checked vs. the resume (linkedin_analyzer_agent).",
        ["linkedin"], li._RESPONSE_SCHEMA, li.LinkedInAnalysisResult, 8192, _build_linkedin, _headline_linkedin,
    ),
}


# ── Output parsing / validation ──────────────────────────────────────

def parse_json(raw: str) -> Any:
    """Tolerant JSON extraction: strips fences / leading prose. Raises ValueError."""
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise ValueError("no JSON object found in output")
