"""CSV parsing for student roster uploads.

Replaces utils/csvParser.js + the ingestion logic in studentController.js.
Handles required-field validation, numeric coercion, and default values.
"""

from __future__ import annotations

import csv
import io
from typing import Iterable, List, Tuple


REQUIRED_FIELDS = ("name", "email", "branch", "graduationYear")

_NUMERIC_FIELDS = (
    "graduationYear",
    "employabilityScore",
    "resumeScore",
    "githubScore",
    "leetcodeScore",
    "interviewScore",
    "assessmentScore",
)

_VALID_STATUSES = {"pending", "verified", "rejected"}
_VALID_PLACEMENT_STATUSES = {"not_placed", "placed", "offer_declined"}


def _to_number(value: str, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        return float(str(value).strip())
    except (ValueError, TypeError):
        return default


def parse_students_csv(raw: bytes) -> Tuple[List[dict], List[dict]]:
    """Parse raw CSV bytes into (rows, invalid_rows).

    - Every row is validated against REQUIRED_FIELDS.
    - Numeric fields are coerced (with 0 as default for score fields).
    - verificationStatus is validated against the allowed enum, else 'pending'.
    - Returned rows use DB column names (snake_case).
    """
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    parsed: List[dict] = []
    invalid: List[dict] = []

    for idx, row in enumerate(reader, start=2):  # header is line 1
        row = {(k or "").strip(): (v.strip() if isinstance(v, str) else v)
               for k, v in row.items()}

        missing = [f for f in REQUIRED_FIELDS if not row.get(f)]
        if missing:
            invalid.append({"line": idx, "missing": missing, "row": row})
            continue

        status = (row.get("verificationStatus") or "pending").lower()
        if status not in _VALID_STATUSES:
            status = "pending"

        placement_status = (row.get("placementStatus") or "not_placed").lower()
        if placement_status not in _VALID_PLACEMENT_STATUSES:
            placement_status = "not_placed"

        try:
            grad = int(_to_number(row.get("graduationYear"), 0))
        except (ValueError, TypeError):
            invalid.append({"line": idx, "missing": ["graduationYear"], "row": row})
            continue

        parsed.append({
            "name": row["name"],
            "email": row["email"].lower(),
            "branch": row["branch"],
            "graduation_year": grad,
            "employability_score": _to_number(row.get("employabilityScore")),
            "resume_score": _to_number(row.get("resumeScore")),
            "github_score": _to_number(row.get("githubScore")),
            "leetcode_score": _to_number(row.get("leetcodeScore")),
            "interview_score": _to_number(row.get("interviewScore")),
            "assessment_score": _to_number(row.get("assessmentScore")),
            "verification_status": status,
            "placement_status": placement_status,
        })

    return parsed, invalid


def dedupe_by_email(rows: Iterable[dict]) -> List[dict]:
    """Keep last occurrence per email — CSV order wins."""
    out: dict[str, dict] = {}
    for r in rows:
        out[r["email"]] = r
    return list(out.values())
