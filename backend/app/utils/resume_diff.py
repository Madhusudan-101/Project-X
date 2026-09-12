"""
resume_diff.py — line-level → word-level diff of an original resume against
its AI-rewritten version, plus reassembly of a final resume from per-hunk
accept/reject decisions.

Uses difflib.SequenceMatcher (already used elsewhere in
resume_analyzer_agent.py, here a second way).
"""

from __future__ import annotations

import difflib
import re
from typing import Any, Dict, List, Tuple

# Common resume section headings — used only to LABEL a hunk with the
# nearest preceding heading. Detection is best-effort and never required.
_SECTION_WORDS = (
    "summary", "objective", "experience", "work experience", "employment",
    "projects", "education", "skills", "technical skills", "certifications",
    "achievements", "awards", "publications", "activities", "interests",
    "contact", "profile",
)


def _is_heading(line: str) -> bool:
    s = line.strip()
    if not s or len(s) > 60:
        return False
    low = s.lower().rstrip(":").strip()
    if low in _SECTION_WORDS:
        return True
    # Short, mostly-uppercase line with no sentence punctuation.
    letters = [c for c in s if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.8 and not s.endswith("."):
        return True
    return s.endswith(":") and len(s.split()) <= 4


def _section_for(lines: List[str], idx: int) -> str:
    for k in range(min(idx, len(lines) - 1), -1, -1):
        if _is_heading(lines[k]):
            return lines[k].strip().rstrip(":").strip()
    return "Header"


def word_diff(original: str, rewritten: str) -> List[Dict[str, str]]:
    """Token list: [{op: 'equal'|'insert'|'delete', text}]. Whitespace is
    kept attached so the frontend can render the tokens back to text."""
    a = re.split(r"(\s+)", original)
    b = re.split(r"(\s+)", rewritten)
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    out: List[Dict[str, str]] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            out.append({"op": "equal", "text": "".join(a[i1:i2])})
        elif tag == "delete":
            out.append({"op": "delete", "text": "".join(a[i1:i2])})
        elif tag == "insert":
            out.append({"op": "insert", "text": "".join(b[j1:j2])})
        else:  # replace
            out.append({"op": "delete", "text": "".join(a[i1:i2])})
            out.append({"op": "insert", "text": "".join(b[j1:j2])})
    return [t for t in out if t["text"]]


def build_hunks(
    original_text: str, rewritten_text: str
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Return (hunks, segments).

    hunks:    one per changed bullet — {hunk_index, section, original_bullet,
              rewritten_bullet, word_diff}.
    segments: ordered reconstruction plan for the final resume —
              {kind: 'keep', text} for unchanged runs, {kind: 'hunk', i} for
              each hunk (in document order).
    """
    o_lines = original_text.splitlines()
    n_lines = rewritten_text.splitlines()
    sm = difflib.SequenceMatcher(a=o_lines, b=n_lines, autojunk=False)

    hunks: List[Dict[str, Any]] = []
    segments: List[Dict[str, Any]] = []

    def _add_hunk(section: str, orig: str, new: str) -> None:
        idx = len(hunks)
        hunks.append({
            "hunk_index": idx,
            "section": section,
            "original_bullet": orig,
            "rewritten_bullet": new,
            "word_diff": word_diff(orig, new),
        })
        segments.append({"kind": "hunk", "i": idx})

    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            segments.append({"kind": "keep", "text": "\n".join(o_lines[i1:i2])})
            continue

        section = _section_for(o_lines, i1)
        o_block = o_lines[i1:i2]
        n_block = n_lines[j1:j2]

        if tag == "replace" and len(o_block) == len(n_block):
            # Bullet-for-bullet rewrite — one hunk per line (skip lines that
            # only differ in whitespace).
            for ol, nl in zip(o_block, n_block):
                if ol.strip() == nl.strip():
                    segments.append({"kind": "keep", "text": ol})
                else:
                    _add_hunk(section, ol, nl)
        elif tag == "delete":
            for ol in o_block:
                if ol.strip():
                    _add_hunk(section, ol, "")
                else:
                    segments.append({"kind": "keep", "text": ol})
        elif tag == "insert":
            for nl in n_block:
                if nl.strip():
                    _add_hunk(section, "", nl)
        else:  # replace with unequal line counts — one combined hunk
            _add_hunk(section, "\n".join(o_block), "\n".join(n_block))

    return hunks, segments


def assemble_final_text(
    segments: List[Dict[str, Any]],
    hunks_by_index: Dict[int, Dict[str, Any]],
    decisions: Dict[str, str],
) -> str:
    """Walk the segments; for hunk segments pick rewritten (accepted) or
    original (rejected/pending). `decisions` maps hunk id -> decision;
    falls back to the hunk row's stored decision."""
    parts: List[str] = []
    for seg in segments:
        if seg.get("kind") == "keep":
            parts.append(seg.get("text", ""))
            continue
        h = hunks_by_index.get(seg.get("i"))
        if not h:
            continue
        decision = decisions.get(h["id"]) or h.get("decision") or "pending"
        chosen = h["rewritten_bullet"] if decision == "accepted" else h["original_bullet"]
        if chosen != "":
            parts.append(chosen)
    # Collapse the 3+ blank lines that dropping bullets can create.
    text = "\n".join(parts)
    return re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"
