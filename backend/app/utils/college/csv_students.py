"""CSV parsing for student roster uploads.

Replaces utils/csvParser.js + the ingestion logic in studentController.js.
Handles required-field validation and numeric coercion.

Re-importing a roster must never overwrite what the file does not say. Only the
four required columns are always returned; every optional column (scores,
verificationStatus, placementStatus) appears in a row only when the column is in
the file's header AND that row's cell holds a usable value. A blank cell, a
missing column, or an unusable value means "leave this field as it is" — the
database default applies to a brand-new student, the stored value to an
existing one.

Validation rules (the College Portal demo engine, frontend/src/lib/demo/college/engine.ts,
implements the same ones):

* name / email / branch / graduationYear are required, must not contain a NUL
  byte (PostgreSQL text cannot store it), the email must look like an email
  (utils/email_rules.py) and the year must be a whole year from 1950 to 2100.
  A row that breaks a rule rejects the whole file, with the line and column.
* Scores must be plain decimal numbers from 0 to 100. They are rounded half-up to
  two decimals — what the numeric(5,2) column stores — so a re-upload of the
  same value compares equal to what the database kept. A score that is not a
  number, or is outside 0-100, is ignored and reported as a warning.
* Rows whose cells are all blank (trailing ",,,," rows from spreadsheet exports)
  are skipped. A header that repeats a column name is refused.
"""

from __future__ import annotations

import csv
import io
import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Dict, Iterable, List, Optional, Tuple

from ..email_rules import is_valid_email_format


REQUIRED_FIELDS = ("name", "email", "branch", "graduationYear")

# CSV column -> students column, for the optional numeric fields.
_NUMERIC_COLUMNS = {
    "employabilityScore": "employability_score",
    "resumeScore": "resume_score",
    "githubScore": "github_score",
    "leetcodeScore": "leetcode_score",
    "interviewScore": "interview_score",
    "assessmentScore": "assessment_score",
}

# students column -> CSV column, for reporting.
_COLUMN_FOR_FIELD = {
    "name": "name", "email": "email", "branch": "branch", "graduation_year": "graduationYear",
    "verification_status": "verificationStatus", "placement_status": "placementStatus",
    **{db: csv_name for csv_name, db in _NUMERIC_COLUMNS.items()},
}

_MIN_GRAD_YEAR, _MAX_GRAD_YEAR = 1950, 2100
_MIN_SCORE, _MAX_SCORE = Decimal(0), Decimal(100)

_VALID_STATUSES = {"pending", "verified", "rejected"}
_VALID_PLACEMENT_STATUSES = {"not_placed", "placed", "offer_declined"}

# Plain decimal syntax only: no hex ("0x10"), no "nan"/"inf", no digit separators.
_NUMBER_RE = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")
_YEAR_RE = re.compile(r"^\d{1,4}(\.0+)?$")


class CsvFormatError(ValueError):
    """The bytes are not a usable CSV at all (stray carriage returns, binary
    data, a repeated column name)."""


class Row(dict):
    """A parsed roster row (students columns -> values) that remembers the CSV
    line it came from, for error messages. Behaves exactly like a dict."""

    line: int = 0


def _score(cell: str) -> Tuple[Optional[float], Optional[str]]:
    """(value, None) for a usable score, else (None, reason)."""
    if not _NUMBER_RE.match(cell):
        return None, "not a number"
    try:
        rounded = Decimal(cell).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation:  # an exponent too large to represent
        return None, "outside 0-100"
    if not _MIN_SCORE <= rounded <= _MAX_SCORE:
        return None, "outside 0-100"
    return float(rounded) + 0.0, None  # + 0.0 turns -0.0 into 0.0


def _year(cell: str) -> Optional[int]:
    if not _YEAR_RE.match(cell):
        return None
    year = int(cell.split(".")[0])
    return year if _MIN_GRAD_YEAR <= year <= _MAX_GRAD_YEAR else None


def parse_students_csv_with_warnings(raw: bytes) -> Tuple[List[Row], List[dict], List[dict]]:
    """Parse raw CSV bytes into (rows, invalid_rows, warnings).

    - Every row is validated against the rules in the module docstring; an
      invalid row is reported as {"line", "missing": [columns], "row"}.
    - Returned rows use DB column names (snake_case) and carry only the fields
      the file actually supplies (see the module docstring).
    - Raises CsvFormatError when the file cannot be read as CSV at all.
    - A non-blank optional value that cannot be used (an unknown status, a
      non-numeric or out-of-range score) is left out of the row and reported in
      `warnings` as {"line", "column", "value", "reason"}, so it is never
      silently turned into a default.
    """
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    parsed: List[Row] = []
    invalid: List[dict] = []
    warnings: List[dict] = []

    try:
        names = [(n or "").strip() for n in (reader.fieldnames or [])]
        repeated = sorted({n for n in names if n and names.count(n) > 1})
        if repeated:
            raise CsvFormatError(
                "Each column may appear only once, but this file repeats: " + ", ".join(repeated) + "."
            )

        for idx, row in enumerate(reader, start=2):  # header is line 1
            row = {(k or "").strip(): (v.strip() if isinstance(v, str) else v)
                   for k, v in row.items()}

            if not any(isinstance(v, str) and v for v in row.values()):
                continue  # a row with nothing in it (",,,," left behind by a spreadsheet)

            bad = [f for f in REQUIRED_FIELDS if not row.get(f)]
            if not bad:
                if any("\x00" in row[f] for f in ("name", "email", "branch")):
                    bad += [f for f in ("name", "email", "branch") if "\x00" in row[f]]
                if "email" not in bad and not is_valid_email_format(row["email"]):
                    bad.append("email")
                year = _year(row["graduationYear"])
                if year is None:
                    bad.append("graduationYear")
            if bad:
                invalid.append({"line": idx, "missing": bad, "row": row})
                continue

            out = Row(
                name=row["name"],
                email=row["email"].lower(),
                branch=row["branch"],
                graduation_year=year,
            )
            out.line = idx

            for column, db_column in _NUMERIC_COLUMNS.items():
                cell = row.get(column)
                if not cell:
                    continue
                value, reason = _score(cell)
                if value is None:
                    warnings.append({"line": idx, "column": column, "value": cell, "reason": reason})
                else:
                    out[db_column] = value

            for column, db_column, allowed in (
                ("verificationStatus", "verification_status", _VALID_STATUSES),
                ("placementStatus", "placement_status", _VALID_PLACEMENT_STATUSES),
            ):
                cell = row.get(column)
                if not cell:
                    continue
                if cell.lower() in allowed:
                    out[db_column] = cell.lower()
                else:
                    warnings.append({"line": idx, "column": column, "value": cell,
                                     "reason": "must be one of " + ", ".join(sorted(allowed))})

            parsed.append(out)
    except csv.Error as e:
        raise CsvFormatError(f"This file could not be read as a CSV ({e}).") from e

    return parsed, invalid, warnings


def parse_students_csv(raw: bytes) -> Tuple[List[Row], List[dict]]:
    """(rows, invalid_rows) — see parse_students_csv_with_warnings."""
    parsed, invalid, _ = parse_students_csv_with_warnings(raw)
    return parsed, invalid


def merge_duplicate_rows(rows: Iterable[Row]) -> Tuple[List[dict], List[dict]]:
    """One row per email, in first-seen order, plus a report of every email the
    file repeats: [{"email", "lines": [line numbers], "conflicts": [columns]}].

    Repeats that agree — or where a later row simply leaves a field blank — merge
    into one row; a blank cell never erases a value. A repeat that supplies a
    DIFFERENT value for the same field is a conflict: the caller must refuse the
    file rather than pick a winner, because either value could be the typo.
    """
    merged: Dict[str, dict] = {}
    seen: Dict[str, dict] = {}
    for r in rows:
        email = r["email"]
        if email not in merged:
            merged[email] = dict(r)
            seen[email] = {"email": email, "lines": [r.line], "conflicts": []}
            continue
        report = seen[email]
        report["lines"].append(r.line)
        for field, value in r.items():
            if field in merged[email] and merged[email][field] != value:
                column = _COLUMN_FOR_FIELD.get(field, field)
                if column not in report["conflicts"]:
                    report["conflicts"].append(column)
            else:
                merged[email][field] = value
    duplicates = [d for d in seen.values() if len(d["lines"]) > 1]
    return list(merged.values()), duplicates
