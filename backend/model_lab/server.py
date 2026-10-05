"""
Model Lab server — a local dashboard for comparing LLMs on the app's resume /
LinkedIn / job-scoring prompts.

Run from backend/:   python -m model_lab        (then open http://127.0.0.1:8765)

Upload a resume (and/or LinkedIn) PDF, pick models, hit Run. Models execute
strictly one after another against identical input; each result is validated
against the production pydantic schema and shown side by side.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from .catalog import PROVIDERS, native_pdf, price_for, seed_models  # noqa: E402
from .providers import api_key_for, call_model, discover_models  # noqa: E402
from .portfolio import build_portfolio  # noqa: E402
from .tasks import TASKS, Inputs, extract_pdf_text, parse_json  # noqa: E402

HERE = Path(__file__).resolve().parent
RESULTS_DIR = HERE / "results"
RESULTS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Model Lab")
RUNS: Dict[str, Dict[str, Any]] = {}
TASK_HANDLES: Dict[str, asyncio.Task] = {}

TRANSIENT = ("429", "500", "502", "503", "504", "UNAVAILABLE", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED", "overloaded")


def _save(run: Dict[str, Any]) -> None:
    (RESULTS_DIR / f"{run['id']}.json").write_text(json.dumps(run, indent=2, default=str))


# ── Static + metadata ────────────────────────────────────────────────

@app.get("/")
async def index():
    return FileResponse(HERE / "static" / "index.html")


@app.get("/api/meta")
async def meta():
    return {
        "tasks": [
            {"id": t.id, "label": t.label, "description": t.description, "needs": t.needs}
            for t in TASKS.values()
        ],
        "providers": [
            {"id": pid, "label": p["label"], "key_env": p["key_env"], "has_key": bool(api_key_for(pid, {}))}
            for pid, p in PROVIDERS.items()
        ],
        "models": seed_models(),
    }


@app.post("/api/discover")
async def discover(provider: str = Form(...), api_key: str = Form("")):
    if provider not in PROVIDERS:
        raise HTTPException(400, "unknown provider")
    key = api_key or api_key_for(provider, {})
    if not key:
        raise HTTPException(400, f"No API key for {provider} (set {PROVIDERS[provider]['key_env']} or paste one).")
    try:
        return {"models": await discover_models(provider, key)}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, str(exc)[:500])


# ── Runs ─────────────────────────────────────────────────────────────

@app.post("/api/runs")
async def create_run(
    task: str = Form(...),
    models: str = Form(...),  # JSON: [{"provider","model"}]
    resume: Optional[UploadFile] = File(None),
    linkedin: Optional[UploadFile] = File(None),
    target_role: str = Form("Software Engineer"),
    portfolio_json: str = Form(""),
    prior_audit_json: str = Form(""),
    job_title: str = Form(""),
    job_domain: str = Form(""),
    job_experience: str = Form(""),
    job_location: str = Form(""),
    job_description: str = Form(""),
    job_skills: str = Form(""),
    weights: str = Form(""),  # JSON
    auto_portfolio: bool = Form(True),  # fetch GitHub/LeetCode/Codeforces from the resume's links
    github_user: str = Form(""),
    leetcode_user: str = Form(""),
    codeforces_user: str = Form(""),
    input_mode: str = Form("text"),  # text | native
    temperature: float = Form(0.2),
    timeout_s: float = Form(120),
    api_keys: str = Form("{}"),  # JSON {provider: key}; held in memory for this run only
):
    if task not in TASKS:
        raise HTTPException(400, "unknown task")
    spec = TASKS[task]
    try:
        model_list = json.loads(models)
        keys = json.loads(api_keys or "{}")
        w = json.loads(weights) if weights else None
        for blob, label in ((portfolio_json, "portfolio"), (prior_audit_json, "prior audit")):
            if blob.strip():
                json.loads(blob)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid JSON in form: {exc}")
    if not model_list:
        raise HTTPException(400, "Select at least one model.")

    inp = Inputs(
        resume_pdf=await resume.read() if resume else None,
        linkedin_pdf=await linkedin.read() if linkedin else None,
        target_role=target_role, portfolio_json=portfolio_json, prior_audit_json=prior_audit_json,
        job_title=job_title, job_domain=job_domain, job_experience=job_experience,
        job_location=job_location, job_description=job_description,
        job_skills=[s.strip() for s in job_skills.split(",") if s.strip()],
    )
    if w:
        inp.weights = {k: int(v) for k, v in w.items()}
    for need in spec.needs:
        if not getattr(inp, f"{need}_pdf"):
            raise HTTPException(400, f"This task needs a {need} PDF.")

    run_id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    run = {
        "id": run_id, "task": task, "created": time.time(), "status": "running", "input_mode": input_mode,
        "config": {
            "target_role": target_role, "temperature": temperature, "weights": inp.weights,
            "resume_file": resume.filename if resume else None,
            "linkedin_file": linkedin.filename if linkedin else None,
            "job_title": job_title,
        },
        "results": [
            {"provider": m["provider"], "model": m["model"], "status": "pending"} for m in model_list
        ],
        "best": None,
    }
    RUNS[run_id] = run
    overrides = {k: v.strip() for k, v in (("github", github_user), ("leetcode", leetcode_user), ("codeforces", codeforces_user)) if v.strip()}
    fetch_portfolio = auto_portfolio and task in ("resume", "job_scoring") and not portfolio_json.strip()
    TASK_HANDLES[run_id] = asyncio.create_task(
        _execute(run, spec, inp, keys, input_mode, temperature, timeout_s, fetch_portfolio, overrides)
    )
    return {"id": run_id}


async def _execute(run, spec, inp: Inputs, keys: Dict[str, str], input_mode: str, temperature: float, timeout_s: float,
                   fetch_portfolio: bool = False, overrides: Optional[Dict[str, str]] = None):
    try:
        if fetch_portfolio:
            # Once, before any model: every model is judged on the same verified data.
            run["phase"] = "Fetching GitHub / LeetCode / Codeforces from the resume's links…"
            _save(run)
            try:
                pf = await build_portfolio(inp.resume_pdf, extract_pdf_text(inp.resume_pdf), overrides or {})
                inp.portfolio_json = pf.metrics_json
                inp.portfolio_notes = pf.notes
                run["portfolio"] = pf.report
                run["portfolio_notes"] = pf.notes
            except Exception as exc:  # noqa: BLE001 — models still run, just without verified data
                run["portfolio"] = {"error": f"{type(exc).__name__}: {exc}"}
            run["phase"] = None
        # Strictly sequential, in the order chosen — one model at a time.
        for res in run["results"]:
            if run["status"] == "cancelled":
                res["status"] = "skipped"
                continue
            await _run_one(run, res, spec, inp, keys, input_mode, temperature, timeout_s)
            _save(run)
        if run["status"] != "cancelled":
            run["status"] = "done"
    except Exception as exc:  # noqa: BLE001 — never leave a run stuck at "running"
        run["status"] = "failed"
        run["error"] = str(exc)
    finally:
        _save(run)


async def _run_one(run, res, spec, inp, keys, input_mode, temperature, timeout_s):
    provider, model = res["provider"], res["model"]
    res["status"] = "running"
    res["started"] = time.time()
    key = api_key_for(provider, keys)
    if not key:
        res.update(status="error", error=f"No API key for {provider} (set {PROVIDERS[provider]['key_env']}).")
        return

    use_native = input_mode == "native" and native_pdf(provider, model)
    res["input_mode"] = "native PDF" if use_native else "extracted text"
    prompt = spec.build(inp, use_native)

    raw = None
    for attempt in (1, 2):  # one retry on transient provider errors
        try:
            out = await call_model(
                provider=provider, model=model, api_key=key, system=prompt.system,
                user_parts=prompt.user_parts, pdfs=prompt.pdfs, schema=spec.schema,
                temperature=temperature, max_output_tokens=spec.max_output_tokens, timeout_s=timeout_s,
            )
            raw = out
            break
        except Exception as exc:  # noqa: BLE001
            msg = f"{type(exc).__name__}: {exc}"
            if attempt == 1 and any(t in msg for t in TRANSIENT):
                await asyncio.sleep(5)
                continue
            res.update(status="error", error=msg[:1500], latency_s=round(time.time() - res["started"], 2))
            return

    res.update(
        latency_s=raw.latency_s, input_tokens=raw.input_tokens, output_tokens=raw.output_tokens,
        finish_reason=raw.finish_reason, raw=raw.text,
    )
    price = price_for(provider, model)
    if price and raw.input_tokens is not None and raw.output_tokens is not None:
        res["cost_usd"] = round((raw.input_tokens * price[0] + raw.output_tokens * price[1]) / 1_000_000, 5)

    try:
        data = parse_json(raw.text)
    except ValueError as exc:
        res.update(status="done", valid=False, parse_error=f"Unparseable JSON: {exc}")
        return
    try:
        parsed = spec.model_cls.model_validate(data)
    except ValidationError as exc:
        res.update(status="done", valid=False, output=data, parse_error=_short_errors(exc))
        return
    res.update(status="done", valid=True, output=parsed.model_dump(mode="json"), headline=spec.headline(parsed, inp))


def _short_errors(exc: ValidationError) -> str:
    errs = exc.errors()
    lines = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in errs[:8]]
    more = f"\n…and {len(errs) - 8} more" if len(errs) > 8 else ""
    return f"{len(errs)} schema violation(s):\n" + "\n".join(lines) + more


@app.get("/api/runs")
async def list_runs():
    items = []
    for f in sorted(RESULTS_DIR.glob("*.json"), reverse=True)[:50]:
        try:
            r = json.loads(f.read_text())
            items.append({
                "id": r["id"], "task": r["task"], "created": r["created"], "status": r["status"],
                "models": len(r["results"]), "file": r["config"].get("resume_file") or r["config"].get("linkedin_file"),
            })
        except Exception:  # noqa: BLE001
            continue
    return items


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    if run_id in RUNS:
        return RUNS[run_id]
    f = RESULTS_DIR / f"{run_id}.json"
    if not f.exists() or not run_id.replace("-", "").isalnum():
        raise HTTPException(404, "run not found")
    run = json.loads(f.read_text())
    RUNS[run_id] = run
    return run


@app.post("/api/runs/{run_id}/cancel")
async def cancel(run_id: str):
    run = await get_run(run_id)
    if run["status"] == "running":
        run["status"] = "cancelled"  # remaining models are skipped; the in-flight call finishes
    return {"ok": True}


@app.post("/api/runs/{run_id}/review")
async def review(run_id: str, index: int = Form(...), rating: int = Form(0), note: str = Form(""), best: bool = Form(False)):
    run = await get_run(run_id)
    if not 0 <= index < len(run["results"]):
        raise HTTPException(400, "bad index")
    run["results"][index]["rating"] = rating or None
    run["results"][index]["note"] = note
    if best:
        run["best"] = index
    elif run.get("best") == index:
        run["best"] = None
    _save(run)
    return {"ok": True}


@app.exception_handler(Exception)
async def _unhandled(_req, exc):  # pragma: no cover
    return JSONResponse({"detail": f"{type(exc).__name__}: {exc}"}, status_code=500)
