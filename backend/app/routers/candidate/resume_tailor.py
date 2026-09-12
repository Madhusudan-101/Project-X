"""Resume tailoring router — /candidate/applications/.../tailor-resume
+ /candidate/resume-tailoring/...

Post-scoring, per-application resume rewrite: AI section-rewrite → line +
word diff → per-bullet accept/reject → assembled final_text → PDF.

Every read/write is scoped to the caller: a student only ever touches
their own runs and hunks.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError

from ...deps import require_candidate_role
from ...schemas import (
    TailorApplyOut,
    TailorDecisionsIn,
    TailorHunkOut,
    TailorPdfOut,
    TailorRunOut,
)
from ...crud import (
    create_tailoring_run,
    get_application,
    get_application_analysis,
    get_job,
    get_job_skill_names,
    get_latest_tailoring_run_for_application,
    get_tailoring_run,
    insert_tailoring_hunks,
    list_tailoring_hunks,
    set_tailoring_hunk_decision,
    update_tailoring_run,
)
from ...services.candidate import resume_tailor_agent
from ...services.candidate.resume_history_service import load_previous_analysis
from ...services.candidate.resume_tailor_agent import tailor_resume
from ...services.candidate.resume_pdf import (
    PdfRenderUnavailable,
    render_resume_pdf,
    upload_and_sign,
)
from ...utils.resume_diff import assemble_final_text, build_hunks

log = logging.getLogger(__name__)
router = APIRouter(prefix="/candidate", tags=["resume-tailoring"])


# ── Helpers ────────────────────────────────────────────────────────────

def _hunk_out(h: dict) -> TailorHunkOut:
    return TailorHunkOut(
        id=h["id"],
        hunk_index=h["hunk_index"],
        section=h.get("section"),
        original_bullet=h.get("original_bullet") or "",
        rewritten_bullet=h.get("rewritten_bullet") or "",
        word_diff=h.get("word_diff") or [],
        decision=h.get("decision") or "pending",
    )


def _run_out(run: dict, hunks: list) -> TailorRunOut:
    return TailorRunOut(
        run_id=run["id"],
        application_id=run["application_id"],
        original_text=run["original_text"],
        rewritten_text=run.get("rewritten_text"),
        final_text=run.get("final_text"),
        pdf_ready=bool(run.get("pdf_path")),
        segments=run.get("segments_json") or [],
        hunks=[_hunk_out(h) for h in hunks],
        generated_at=str(run.get("created_at", "")),
    )


def _owned_run(run_id: str, student_id: str) -> dict:
    run = get_tailoring_run(run_id)
    if not run or run["student_id"] != student_id:
        raise HTTPException(status_code=404, detail="Tailoring run not found.")
    return run


# ── POST /candidate/applications/{application_id}/tailor-resume ──────

@router.post("/applications/{application_id}/tailor-resume", response_model=TailorRunOut)
async def tailor_resume_route(
    application_id: str,
    refresh: bool = False,
    current_user: dict = Depends(require_candidate_role),
) -> TailorRunOut:
    """Start (or return the existing) tailoring run for this application.
    A plain revisit returns the cached run with its saved accept/reject
    decisions — no AI cost. Pass ?refresh=true to regenerate (appends a new
    run, never overwrites the old one)."""
    application = get_application(application_id)
    if not application or application["student_id"] != current_user["id"]:
        raise HTTPException(status_code=404, detail="Application not found.")

    if not refresh:
        existing = get_latest_tailoring_run_for_application(application_id)
        if existing:
            return _run_out(existing, list_tailoring_hunks(existing["id"]))

    analysis = get_application_analysis(application_id)
    if not analysis:
        raise HTTPException(
            status_code=409,
            detail="Scoring isn't complete yet — tailoring needs your job analysis first.",
        )

    prev = load_previous_analysis(current_user["id"])
    if prev is None or not (prev.resume_text or "").strip():
        raise HTTPException(
            status_code=409,
            detail="No parsed resume on file — run your resume analysis first.",
        )

    job = get_job(application["job_id"])
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    analysis_json = analysis.get("analysis_json") or {}
    original_text = prev.resume_text

    try:
        rewritten_text = await tailor_resume(
            resume_text=original_text,
            job=job,
            required_skills=get_job_skill_names(application["job_id"]),
            skills_match=analysis_json.get("skills_match") or {},
            dimensions=analysis_json.get("dimensions") or {},
        )
    except RuntimeError as exc:  # missing API key
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        log.exception("Resume tailoring failed for application %s", application_id)
        raise HTTPException(status_code=502, detail=f"Could not tailor your resume: {exc}")

    hunks, segments = build_hunks(original_text, rewritten_text)

    try:
        run = create_tailoring_run({
            "application_id": application_id,
            "student_id": current_user["id"],
            "original_text": original_text,
            "rewritten_text": rewritten_text,
            "segments_json": segments,
            "model_version": resume_tailor_agent.MODEL_VERSION_LABEL,
        })
        if not run:
            raise HTTPException(status_code=400, detail="Could not start a tailoring run.")
        saved_hunks = insert_tailoring_hunks(run["id"], hunks)
    except APIError as exc:
        log.error("DB error saving tailoring run for %s: %s", application_id, exc)
        raise HTTPException(status_code=400, detail=f"Could not save the tailoring run: {exc.message}")

    return _run_out(run, saved_hunks)


# ── GET /candidate/resume-tailoring/{run_id} ───────────────────────

@router.get("/resume-tailoring/{run_id}", response_model=TailorRunOut)
def get_run_route(
    run_id: str,
    current_user: dict = Depends(require_candidate_role),
) -> TailorRunOut:
    run = _owned_run(run_id, current_user["id"])
    return _run_out(run, list_tailoring_hunks(run_id))


# ── PATCH /candidate/resume-tailoring/{run_id}  (accept/reject batch) ─

@router.patch("/resume-tailoring/{run_id}", response_model=TailorApplyOut)
def apply_decisions_route(
    run_id: str,
    payload: TailorDecisionsIn,
    current_user: dict = Depends(require_candidate_role),
) -> TailorApplyOut:
    run = _owned_run(run_id, current_user["id"])
    hunks = list_tailoring_hunks(run_id)
    valid_ids = {h["id"] for h in hunks}

    decisions = {d.hunk_id: d.decision for d in payload.decisions if d.hunk_id in valid_ids}
    try:
        for hid, decision in decisions.items():
            set_tailoring_hunk_decision(hid, decision)
    except APIError as exc:
        log.error("DB error updating hunk decisions for run %s: %s", run_id, exc)
        raise HTTPException(status_code=400, detail="Could not save your decisions.")

    # Any hunk the client didn't decide on stays as its stored value; assemble
    # treats non-'accepted' as "keep original".
    hunks_by_index = {h["hunk_index"]: h for h in hunks}
    for h in hunks:
        if h["id"] in decisions:
            h["decision"] = decisions[h["id"]]
    final_text = assemble_final_text(
        run.get("segments_json") or [], hunks_by_index, {h["id"]: h["decision"] for h in hunks}
    )

    update_tailoring_run(run_id, {"final_text": final_text, "pdf_path": None})
    return TailorApplyOut(run_id=run_id, final_text=final_text)


# ── POST /candidate/resume-tailoring/{run_id}/render-pdf ───────────

@router.post("/resume-tailoring/{run_id}/render-pdf", response_model=TailorPdfOut)
def render_pdf_route(
    run_id: str,
    current_user: dict = Depends(require_candidate_role),
) -> TailorPdfOut:
    run = _owned_run(run_id, current_user["id"])

    final_text = run.get("final_text")
    if not final_text:
        # Fall back to whatever decisions are stored (all 'pending' → original).
        hunks = list_tailoring_hunks(run_id)
        final_text = assemble_final_text(
            run.get("segments_json") or [],
            {h["hunk_index"]: h for h in hunks},
            {h["id"]: h.get("decision", "pending") for h in hunks},
        )
        update_tailoring_run(run_id, {"final_text": final_text})

    try:
        pdf_bytes = render_resume_pdf(final_text)
    except PdfRenderUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        log.exception("PDF render failed for run %s", run_id)
        raise HTTPException(status_code=502, detail=f"Could not render the PDF: {exc}")

    path = f"{current_user['id']}/{run_id}.pdf"
    try:
        url = upload_and_sign(path, pdf_bytes)
    except Exception as exc:  # noqa: BLE001 — storage/network
        log.exception("PDF upload failed for run %s", run_id)
        raise HTTPException(status_code=502, detail=f"Could not store the PDF: {exc}")

    if not url:
        raise HTTPException(status_code=502, detail="PDF stored but no download URL was returned.")

    update_tailoring_run(run_id, {"pdf_path": path})
    return TailorPdfOut(url=url)
