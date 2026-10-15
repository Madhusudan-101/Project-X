"""
Human-readable report files for a Model Lab run.

For every model in a run, writes a Markdown file (and a PDF when WeasyPrint and its system
libraries are available) into  results/<run_id>/ , plus a summary.md comparing all models.
Failed models get a file too, with the exact error message. Works for every task, since the
output is rendered generically from whatever JSON the production schema produced.

Regenerate for an existing run:   python -m model_lab.report <run_id>
"""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

RESULTS_DIR = Path(__file__).resolve().parent / "results"

_CHAR_FIXES = {"\u2011": "-", "\u202f": " ", "\u00a0": " ", "\u2060": ""}


def _clean(text: Any) -> str:
    s = str(text)
    for a, b in _CHAR_FIXES.items():
        s = s.replace(a, b)
    return s


def _label(key: str) -> str:
    s = key.replace("_", " ").strip()
    return s[:1].upper() + s[1:]


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", s).strip("-")[:80] or "model"


def _scalar(v: Any) -> str:
    if v is None or v == "":
        return "—"
    if isinstance(v, bool):
        return "yes" if v else "no"
    return _clean(v)


# ── tiny document model: ("h2"|"h3"|"p"|"ul"|"kv"|"pre", payload) ────────────────────────────

Block = tuple


def _blocks_for_value(key: str, value: Any, level: int = 2) -> List[Block]:
    """Render one key/value of the model output as blocks (headings for containers)."""
    head = f"h{min(level, 3)}"
    if isinstance(value, dict):
        out: List[Block] = [(head, _label(key))]
        scalars = {k: v for k, v in value.items() if not isinstance(v, (dict, list))}
        if scalars:
            out.append(("kv", [(_label(k), _scalar(v)) for k, v in scalars.items()]))
        for k, v in value.items():
            if isinstance(v, (dict, list)):
                out += _blocks_for_value(k, v, level + 1)
        return out
    if isinstance(value, list):
        out = [(head, _label(key))]
        if not value:
            out.append(("p", "None."))
        elif all(not isinstance(i, (dict, list)) for i in value):
            out.append(("ul", [_scalar(i) for i in value]))
        else:
            for n, item in enumerate(value, 1):
                if isinstance(item, dict):
                    out.append(("kv", [(f"{_label(key)} {n} · {_label(k)}" if i == 0 else _label(k), _scalar(v) if not isinstance(v, (dict, list)) else json.dumps(v, ensure_ascii=False))
                                       for i, (k, v) in enumerate(item.items())]))
                else:
                    out.append(("p", _scalar(item)))
        return out
    return [(head, _label(key)), ("p", _scalar(value))]


def _fmt_time(res: Dict[str, Any]) -> str:
    return f"{res['latency_s']:.2f}s" if res.get("latency_s") is not None else "—"


def _headline_text(res: Dict[str, Any]) -> str:
    h = res.get("headline") or {}
    return ", ".join(f"{_label(k)}: {_scalar(v)}" for k, v in h.items()) or "—"


def _portfolio_blocks(run: Dict[str, Any]) -> List[Block]:
    pf = run.get("portfolio")
    if not pf:
        return []
    out: List[Block] = [("h2", "Portfolio verification")]
    if pf.get("error"):
        return out + [("p", f"Portfolio step failed: {_clean(pf['error'])}")]
    rows = []
    for name, p in (pf.get("platforms") or {}).items():
        detail = p.get("error") or ""
        who = p.get("username") or "—"
        src = f" ({p['source']})" if p.get("source") else ""
        rows.append((_label(name), f"{_label(p.get('status', ''))} — {who}{src}" + (f" — {_clean(detail)}" if detail else "")))
    if rows:
        out.append(("kv", rows))
    if run.get("portfolio_notes"):
        out.append(("h3", "Notes given to every model"))
        out.append(("ul", [_clean(n) for n in run["portfolio_notes"]]))
    return out


def model_blocks(run: Dict[str, Any], res: Dict[str, Any], index: int) -> List[Block]:
    cfg = run.get("config", {})
    meta = [
        ("Provider / model", f"{res['provider']} / {res['model']}"),
        ("Task", _label(run.get("task", ""))),
        ("Status", _label(res.get("status", ""))),
        ("Schema valid", _scalar(res.get("valid")) if res.get("status") == "done" else "—"),
        ("Result", _headline_text(res)),
        ("Time", _fmt_time(res)),
        ("Tokens (in / out)", f"{res.get('input_tokens', '—')} / {res.get('output_tokens', '—')}"),
        ("Input mode", _scalar(res.get("input_mode") or run.get("input_mode"))),
        ("Input file", _scalar(cfg.get("resume_file") or cfg.get("linkedin_file"))),
        ("Run", run.get("id", "")),
    ]
    if cfg.get("target_role"):
        meta.insert(2, ("Target role", cfg["target_role"]))
    blocks: List[Block] = [("h1", f"{res['model']}"), ("kv", meta)]
    if res.get("status") == "error":
        blocks += [("h2", "Error"), ("pre", _clean(res.get("error", "")))]
    elif res.get("status") != "done":
        blocks += [("p", f"No output ({res.get('status')}).")]
    else:
        if res.get("parse_error"):
            blocks += [("h2", "Schema problems"), ("pre", _clean(res["parse_error"]))]
        out = res.get("output")
        if isinstance(out, dict):
            # Put the overall rating first — it's what people read first.
            keys = sorted(out, key=lambda k: 0 if k == "overall_rating" else 1)
            for k in keys:
                blocks += _blocks_for_value(k, out[k])
        elif out is not None:
            blocks += [("pre", _clean(json.dumps(out, indent=2, ensure_ascii=False)))]
    blocks += _portfolio_blocks(run)
    return blocks


def summary_blocks(run: Dict[str, Any]) -> List[Block]:
    cfg = run.get("config", {})
    blocks: List[Block] = [
        ("h1", f"Model Lab run {run.get('id', '')}"),
        ("kv", [("Task", _label(run.get("task", ""))), ("Target role", _scalar(cfg.get("target_role"))),
                ("Input file", _scalar(cfg.get("resume_file") or cfg.get("linkedin_file"))),
                ("Status", _label(run.get("status", "")))]),
        ("h2", "Comparison"),
        ("table", (["#", "Model", "Status", "Result", "Time", "Tokens in/out", "Schema valid"],
                   [[str(i + 1), f"{r['provider']}/{r['model']}", _label(r.get("status", "")),
                     _headline_text(r) if r.get("status") == "done" else _clean(str(r.get("error", ""))[:120]),
                     _fmt_time(r), f"{r.get('input_tokens', '—')}/{r.get('output_tokens', '—')}",
                     _scalar(r.get("valid")) if r.get("status") == "done" else "—"]
                    for i, r in enumerate(run.get("results", []))])),
    ]
    return blocks + _portfolio_blocks(run)


# ── renderers ────────────────────────────────────────────────────────────────────────────────

def to_markdown(blocks: List[Block]) -> str:
    lines: List[str] = []
    for kind, data in blocks:
        if kind in ("h1", "h2", "h3"):
            lines += [f"{'#' * int(kind[1])} {_clean(data)}", ""]
        elif kind == "p":
            lines += [_clean(data), ""]
        elif kind == "ul":
            lines += [f"- {_clean(i)}" for i in data] + [""]
        elif kind == "kv":
            lines += [f"- **{_clean(k)}:** {_clean(v)}" for k, v in data] + [""]
        elif kind == "pre":
            lines += ["```", _clean(data), "```", ""]
        elif kind == "table":
            header, rows = data
            esc = lambda c: _clean(c).replace("|", "\\|").replace("\n", " ")  # noqa: E731
            lines += ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
            lines += ["| " + " | ".join(esc(c) for c in r) + " |" for r in rows] + [""]
    return "\n".join(lines).rstrip() + "\n"


_CSS = """
@page { size: A4; margin: 18mm 16mm; @bottom-right { content: counter(page) " / " counter(pages); font-size: 8pt; color: #888; } }
body { font-family: 'DejaVu Sans', Helvetica, Arial, sans-serif; font-size: 9.5pt; line-height: 1.45; color: #1c1c1c; }
h1 { font-size: 17pt; margin: 0 0 8pt; border-bottom: 2px solid #333; padding-bottom: 4pt; }
h2 { font-size: 12.5pt; margin: 16pt 0 5pt; color: #0b3d91; break-after: avoid; }
h3 { font-size: 10.5pt; margin: 10pt 0 3pt; break-after: avoid; }
ul { margin: 3pt 0 6pt 0; padding-left: 16pt; } li { margin-bottom: 2.5pt; }
p { margin: 3pt 0 6pt; }
.kv { list-style: none; padding-left: 0; } .kv b { color: #444; }
pre { white-space: pre-wrap; background: #f4f4f4; border: 1px solid #ddd; padding: 6pt; font-size: 8.5pt; }
table { border-collapse: collapse; width: 100%; font-size: 8.5pt; }
th, td { border: 1px solid #ccc; padding: 3pt 5pt; text-align: left; vertical-align: top; } th { background: #eee; }
"""


def to_html(blocks: List[Block], title: str) -> str:
    e = lambda s: html.escape(_clean(s))  # noqa: E731
    parts: List[str] = []
    for kind, data in blocks:
        if kind in ("h1", "h2", "h3"):
            parts.append(f"<{kind}>{e(data)}</{kind}>")
        elif kind == "p":
            parts.append(f"<p>{e(data)}</p>")
        elif kind == "ul":
            parts.append("<ul>" + "".join(f"<li>{e(i)}</li>" for i in data) + "</ul>")
        elif kind == "kv":
            parts.append('<ul class="kv">' + "".join(f"<li><b>{e(k)}:</b> {e(v)}</li>" for k, v in data) + "</ul>")
        elif kind == "pre":
            parts.append(f"<pre>{e(data)}</pre>")
        elif kind == "table":
            header, rows = data
            parts.append("<table><tr>" + "".join(f"<th>{e(h)}</th>" for h in header) + "</tr>"
                         + "".join("<tr>" + "".join(f"<td>{e(c)}</td>" for c in r) + "</tr>" for r in rows) + "</table>")
    return f"<!doctype html><html><head><meta charset='utf-8'><title>{e(title)}</title><style>{_CSS}</style></head><body>{''.join(parts)}</body></html>"


def _write_pdf(blocks: List[Block], title: str, path: Path) -> Optional[str]:
    """Returns None on success, or a short reason when PDF rendering isn't available."""
    try:
        from weasyprint import HTML  # heavy import + needs pango; optional (see requirements.txt)
        HTML(string=to_html(blocks, title)).write_pdf(str(path))
        return None
    except Exception as exc:  # noqa: BLE001
        return f"{type(exc).__name__}: {str(exc)[:200]}"


# ── entry points ─────────────────────────────────────────────────────────────────────────────

def write_reports(run: Dict[str, Any], pdf: bool = True) -> Dict[str, Any]:
    """Write results/<run_id>/ with one .md (+ .pdf) per model and summary.md. Never raises."""
    info: Dict[str, Any] = {"dir": None, "files": [], "pdf_error": None}
    try:
        folder = RESULTS_DIR / run["id"]
        folder.mkdir(parents=True, exist_ok=True)
        info["dir"] = str(folder)
        jobs = [("00_summary", summary_blocks(run), f"Run {run['id']}")]
        for i, res in enumerate(run.get("results", [])):
            jobs.append((f"{i + 1:02d}_{_slug(res['provider'])}_{_slug(res['model'])}", model_blocks(run, res, i), res["model"]))
        for stem, blocks, title in jobs:
            (folder / f"{stem}.md").write_text(to_markdown(blocks), encoding="utf-8")
            info["files"].append(f"{stem}.md")
            if pdf and not info["pdf_error"]:
                err = _write_pdf(blocks, title, folder / f"{stem}.pdf")
                if err:
                    info["pdf_error"] = err  # stop trying; Markdown files are still complete
                else:
                    info["files"].append(f"{stem}.pdf")
    except Exception as exc:  # noqa: BLE001 — reports are a convenience; never break a run
        info["error"] = f"{type(exc).__name__}: {exc}"
    return info


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m model_lab.report <run_id>")
    src = RESULTS_DIR / ".data" / f"{sys.argv[1]}.json"
    if not src.exists():  # runs saved before raw state moved to results/.data/
        src = RESULTS_DIR / f"{sys.argv[1]}.json"
    data = json.loads(src.read_text())
    print(json.dumps(write_reports(data), indent=2))
