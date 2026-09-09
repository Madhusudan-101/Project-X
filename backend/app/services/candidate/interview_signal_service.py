"""
Mock Interview Signal — interview_signal_service.py
──────────────────────────────────────────────────
Turns a student's AI Interview Studio practice history
(public.ai_interview_sessions) into ONE recency-weighted signal that the
job-scoring engine folds into dimensions.interview.

This is deliberately NOT best-of-N (which rewards a single lucky attempt)
and NOT a flat lifetime average (which lets a weak early run drag a since-
improved student down forever). It is an exponential recency-decay mean:
the most recent session dominates, older ones fade.

PeerMeet data is never touched here — those sessions live in a different
table and are excluded from scoring by spec.
"""

from __future__ import annotations

import logging
import statistics
from typing import List, Optional

from postgrest.exceptions import APIError

from ...deps import db_client

logger = logging.getLogger(__name__)

# weight = _DECAY ** rank, rank 0 = most recent completed session.
_DECAY = 0.85
# Variance is measured over at most this many of the most recent sessions.
_VARIANCE_WINDOW = 6
_LEVELS = ("low", "medium", "high")


def _downgrade(level: str, steps: int = 1) -> str:
    idx = max(0, _LEVELS.index(level) - steps)
    return _LEVELS[idx]


def get_mock_interview_signal(student_id: str) -> Optional[dict]:
    """Recency-weighted average over the student's *completed* AI Interview
    Studio sessions. Returns None when there are zero completed, scored
    sessions — the caller must then leave dimensions.interview null, exactly
    as it does today.

    Confidence is derived from three statistics, never the LLM's own
    self-reported confidence:
      * sample size      — more completed sessions ⇒ more confidence
      * score variance   — tight clustering ⇒ high even with few attempts;
                           wide swings ⇒ low even with many
      * completion rate  — abandoning most sessions ⇒ a confidence penalty
                           even if the completed ones scored well

    Returns: {"score": int, "confidence": "low"|"medium"|"high",
              "attempts_counted": int, "most_recent_at": str}
    """
    try:
        res = (
            db_client.table("ai_interview_sessions")
            .select("completed, overall_score, created_at")
            .eq("student_id", student_id)
            .order("created_at", desc=True)
            .execute()
        )
    except APIError as exc:
        logger.warning("Could not load ai_interview_sessions for %s: %s", student_id, exc)
        return None

    all_rows = res.data or []
    if not all_rows:
        return None

    completed = [r for r in all_rows if r.get("completed")]
    scored = [r for r in completed if r.get("overall_score") is not None]
    if not scored:
        return None

    # scored is already newest-first from the ORDER BY.
    scores: List[float] = [float(r["overall_score"]) for r in scored]
    weights = [_DECAY ** i for i in range(len(scores))]
    weighted_mean = sum(w * s for w, s in zip(weights, scores)) / sum(weights)

    window = scores[:_VARIANCE_WINDOW]
    stdev = statistics.pstdev(window) if len(window) >= 2 else None

    # Base bucket from variance.
    if stdev is None:
        confidence = "low"          # a single data point — no spread to trust
    elif stdev < 8:
        confidence = "high"
    elif stdev < 18:
        confidence = "medium"
    else:
        confidence = "low"

    # Minimum-sample-size floor: fewer than 2 completed sessions can never
    # be "high" regardless of (absent) variance.
    if len(scores) < 2 and confidence == "high":
        confidence = "medium"

    # Completion-rate penalty — a student who abandons most sessions is a
    # less reliable signal even if the finished ones scored well.
    completion_rate = len(completed) / len(all_rows)
    if completion_rate < 0.5:
        confidence = _downgrade(confidence, 1)

    return {
        "score": int(round(weighted_mean)),
        "confidence": confidence,
        "attempts_counted": len(scores),
        "most_recent_at": str(scored[0]["created_at"]),
    }
