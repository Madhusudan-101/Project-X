"""
Practice Router — /api/practice
────────────────────────────────
Ranks a candidate's weakest LeetCode topics (by their own solved-problem
counts) and surfaces real, hyperlinkable LeetCode problems for each — so the
candidate knows exactly what to practice next. Standalone: only needs a
LeetCode username, no resume/employability analysis required first.
"""

from __future__ import annotations

import asyncio
import logging

import httpx
from fastapi import APIRouter, HTTPException

from ...services.candidate.leetcode_service import (
    PracticeRecommendations,
    WeakTopic,
    fetch_leetcode_topic_tags,
    fetch_questions_by_tag,
)
from ...services.candidate.practice_ranking import rank_weak_topics

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/practice", tags=["practice"])


async def _fetch_topic_with_questions(tag: dict, questions_per_topic: int) -> WeakTopic:
    """Fetch sample problems for one weak topic — never raises; a failure here
    degrades to an empty question list with a warning, not a broken response."""
    try:
        questions = await fetch_questions_by_tag(
            tag["tagSlug"], limit=questions_per_topic, exclude_paid=True,
        )
        fetch_warning = None
        if not questions:
            fetch_warning = f"No free practice problems found for '{tag['tagName']}' right now."
    except Exception as exc:
        logger.warning("Question fetch failed for tag %s: %s", tag.get("tagSlug"), exc)
        questions = []
        fetch_warning = f"Could not load sample problems for '{tag['tagName']}'."

    return WeakTopic(
        tag_name=tag["tagName"],
        tag_slug=tag["tagSlug"],
        tier=tag["tier"],
        problems_solved=tag.get("problemsSolved", 0),
        questions=questions,
        fetch_warning=fetch_warning,
    )


@router.post(
    "/{username}/recommendations",
    response_model=PracticeRecommendations,
    summary="Rank a candidate's weakest LeetCode topics and surface real practice problems",
    responses={
        404: {"description": "LeetCode user not found"},
        502: {"description": "Upstream LeetCode error"},
        504: {"description": "LeetCode API timed out"},
    },
)
async def get_practice_recommendations(
    username: str,
    questions_per_topic: int = 5,
) -> PracticeRecommendations:
    try:
        topic_tags = await fetch_leetcode_topic_tags(username)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"LeetCode user '{username}' not found.")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="LeetCode API timed out. Please try again.")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"LeetCode API returned an error ({exc.response.status_code}).",
        )

    ranked = rank_weak_topics(topic_tags)

    warnings: list[str] = []
    if not ranked:
        warnings.append(
            "No topic-tag data found for this LeetCode account yet — solve a few problems first."
        )

    weak_topics: list[WeakTopic] = list(
        await asyncio.gather(
            *(_fetch_topic_with_questions(tag, questions_per_topic) for tag in ranked)
        )
    )
    warnings.extend(wt.fetch_warning for wt in weak_topics if wt.fetch_warning)

    return PracticeRecommendations(username=username, weak_topics=weak_topics, warnings=warnings)
