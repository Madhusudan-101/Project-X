"""
Plain-text run report. This is what gets saved in model_lab/results/ — a clean,
readable .txt per run (answers as sections and bullets, not JSON). The raw run
state needed to reload a run in the dashboard lives in results/.data/ (hidden).
"""

from __future__ import annotations

import textwrap
import time
from typing import Any, Dict, List

WIDTH = 100
RULE = "=" * WIDTH
THIN = "-" * WIDTH

_HEAD = {"pending": "waiting", "running": "running", "skipped": "skipped"}


def _title(key: str) -> str:
    return key.replace("_", " ").upper()


def _wrap(text: str, indent: int = 0, first: str = "") -> List[str]:
    pad = " " * indent
    return textwrap.wrap(
        str(text), width=WIDTH, initial_indent=pad + first, subsequent_indent=pad + " " * len(first),
        break_long_words=False, break_on_hyphens=False,
    ) or [pad + first.rstrip()]


def _render(value: Any, indent: int = 0) -> List[str]:
    """Structured output → readable lines (sections, bullets, wrapped prose)."""
    pad = " " * indent
    lines: List[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            if isinstance(v, (dict, list)) and v:
                lines.append(f"{pad}{_title(k) if indent == 0 else k.replace('_', ' ').title() + ':'}")
                lines += _render(v, indent + 2)
                if indent == 0:
                    lines.append("")
            elif isinstance(v, (dict, list)):
                lines.append(f"{pad}{k.replace('_', ' ').title()}: none")
            elif indent == 0 and isinstance(v, str) and len(v) > 60:
                lines.append(_title(k))
                lines += _wrap(v, indent + 2)
                lines.append("")
            else:
                label = k.replace("_", " ").title()
                lines += _wrap("—" if v is None else v, indent, f"{label}: ")
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                first = True
                for k, v in item.items():
                    label = k.replace("_", " ").title()
                    body = ", ".join(map(str, v)) if isinstance(v, list) else ("—" if v is None else v)
                    lines += _wrap(body, indent, ("• " if first else "  ") + f"{label}: ")
                    first = False
                lines.append("")
            else:
                lines += _wrap(item, indent, "• ")
    else:
        lines += _wrap(value, indent)
    while lines and lines[-1] == "":
        lines.pop()
    return lines


def _fmt_time(ts: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))


def build_report(run: Dict[str, Any]) -> str:
    cfg = run.get("config", {})
    out: List[str] = [RULE, f"MODEL LAB RUN  {run['id']}", RULE]
    out.append(f"Task            : {run['task']}")
    out.append(f"Status          : {run.get('status')}")
    out.append(f"Started         : {_fmt_time(run['created'])}")
    if cfg.get("resume_file"):
        out.append(f"Resume          : {cfg['resume_file']}")
    if cfg.get("linkedin_file"):
        out.append(f"LinkedIn PDF    : {cfg['linkedin_file']}")
    out.append(f"Target role     : {cfg.get('target_role', '')}")
    if run["task"] == "job_scoring":
        out.append(f"Job             : {cfg.get('job_title', '')}")
    out.append(f"Input mode      : {run.get('input_mode')}    Temperature: {cfg.get('temperature')}")

    pf = run.get("portfolio")
    if pf:
        out += ["", "PORTFOLIO VERIFICATION (same data was given to every model)", THIN]
        if pf.get("error"):
            out.append(f"  Error: {pf['error']}")
        for p, e in (pf.get("platforms") or {}).items():
            state = {"verified": "verified", "fetch_failed": "FETCH FAILED", "not_provided": "NOT PROVIDED (flagged to models)"}[e["status"]]
            who = f" — {e['username']} ({e['source']})" if e.get("username") else ""
            err = f" — {e['error']}" if e.get("error") else ""
            out.append(f"  {p.title():<11}: {state}{who}{err}")

    out += ["", "SUMMARY", THIN]
    out.append(f"{'#':<3}{'Model':<46}{'Status':<12}{'Score':>6}  {'Time':>7}  {'Tokens in/out':>15}  Rating")
    for i, r in enumerate(run["results"], 1):
        status = r["status"] if r["status"] != "done" else ("ok" if r.get("valid") else "BAD SCHEMA")
        score = (r.get("headline") or {}).get("score")
        tok = f"{r.get('input_tokens') or '—'}/{r.get('output_tokens') or '—'}"
        stars = "*" * r["rating"] if r.get("rating") else "—"
        best = "  <- BEST" if run.get("best") == i - 1 else ""
        out.append(
            f"{i:<3}{(r['provider'] + '/' + r['model'])[:44]:<46}{status:<12}"
            f"{'—' if score is None else round(score):>6}  {str(r.get('latency_s', '—')) + 's':>7}  {tok:>15}  {stars}{best}"
        )

    for i, r in enumerate(run["results"], 1):
        out += ["", RULE, f"MODEL {i}: {r['provider']} / {r['model']}", RULE]
        st = r["status"]
        if st in _HEAD:
            out.append(f"  ({_HEAD[st]})")
            continue
        if st == "error":
            out += [f"  FAILED after {r.get('latency_s', '?')}s", *_wrap(r.get("error", ""), 2)]
            continue
        meta = [f"{r.get('latency_s')}s", f"{r.get('input_tokens')} in / {r.get('output_tokens')} out tokens", r.get("input_mode", "")]
        if r.get("cost_usd") is not None:
            meta.append(f"~${r['cost_usd']}")
        out.append("  " + "  |  ".join(m for m in meta if m))
        h = r.get("headline") or {}
        if h:
            out.append(f"  Score: {h.get('score')}   Verdict: {h.get('verdict', '')}")
        if r.get("rating") or r.get("note"):
            out.append(f"  Your rating: {'*' * (r.get('rating') or 0) or '—'}   Note: {r.get('note') or '—'}")
        out.append("")
        if r.get("valid"):
            out += _render(r["output"])
        else:
            out += ["  SCHEMA CHECK FAILED", *_wrap(r.get("parse_error", ""), 2), "", "  Raw output:", THIN]
            out += [("  " + ln) for ln in (r.get("raw") or "").splitlines()[:200]]
    out += ["", RULE, ""]
    return "\n".join(out)
