"""
Practice Ranking — practice_ranking.py
───────────────────────────────────────
Pure ranking logic (no I/O) that decides which of a candidate's LeetCode
topic tags are the highest-priority ones to practice next.

Heuristic: fundamentals are the most commonly tested and most foundational,
so a weak fundamental topic outranks a weak intermediate/advanced one
regardless of raw solved counts. Within a tier, the topic with the fewest
solved problems is the weakest and comes first.
"""

from __future__ import annotations

from typing import Dict, List

_TIER_ORDER: List[str] = ["fundamental", "intermediate", "advanced"]
TOP_N_TOPICS: int = 5


def rank_weak_topics(topic_tags: Dict[str, list]) -> List[dict]:
    """
    ``topic_tags``: ``{"fundamental": [...], "intermediate": [...], "advanced": [...]}``,
    each entry ``{"tagName": str, "tagSlug": str, "problemsSolved": int}``.

    Returns up to ``TOP_N_TOPICS`` entries (each with a ``"tier"`` key added),
    ordered by tier priority first (fundamental, then intermediate, then
    advanced), and ascending ``problemsSolved`` within each tier.
    """
    ranked: List[dict] = []
    for tier in _TIER_ORDER:
        tier_tags = sorted(
            topic_tags.get(tier, []) or [],
            key=lambda t: t.get("problemsSolved", 0),
        )
        for tag in tier_tags:
            ranked.append({**tag, "tier": tier})

    return ranked[:TOP_N_TOPICS]
