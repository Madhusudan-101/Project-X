"""Unified branch-name normalizer.

Single source of truth for branch matching across drive-eligibility checks
and shortlist filters. Replaces the two divergent implementations that used
to live in driveController.js (alias table + exact match) and
shortlistController.js (case-insensitive substring, no aliases).
"""

from typing import Optional

# Canonical form on the right; keys are lowercase aliases.
_BRANCH_ALIASES = {
    "cse": "computer science",
    "cs": "computer science",
    "computer science and engineering": "computer science",
    "it": "information technology",
    "ece": "electronics and communication",
    "electronics": "electronics and communication",
    "e&c": "electronics and communication",
    "ee": "electrical",
    "eee": "electrical",
    "mech": "mechanical",
    "civ": "civil",
}


def normalize_branch(value: Optional[str]) -> str:
    """Lowercase, strip, and resolve common branch aliases. Empty on None."""
    if value is None:
        return ""
    key = str(value).lower().strip()
    return _BRANCH_ALIASES.get(key, key)


def branch_matches(student_branch: Optional[str], allowed: list) -> bool:
    """True when the student's branch matches ANY of the allowed branches
    after canonicalisation. Substring fallback for close-but-not-alias hits
    (e.g. student "Computer Science and Engineering" vs allowed "CSE")."""
    sb = normalize_branch(student_branch)
    if not sb or not allowed:
        return not allowed  # empty allowed → no branch constraint → match
    for a in allowed:
        an = normalize_branch(a)
        if not an:
            continue
        if sb == an or an in sb or sb in an:
            return True
    return False
