# plans.py
# What the interviewer asks and how it scores, as plain data and pure functions (no model,
# no network), so it can be unit tested on its own.
#
# Two kinds of interview use the same conversation graph:
#   * practice: a built-in track (ai_ml / web_dev / dsa) with fixed topics.
#   * company:  the hiring team's own rubric (domain "custom"), stamped into the room metadata
#               by the backend when the candidate starts from an invitation.
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional

from domains import DOMAIN_LABELS

MAX_COMPETENCIES = 8
MAX_QUESTIONS = 3


def to_ten(v: float | None) -> float | None:
    """Normalise a model score to 0-10 (accepts a 0-100 answer too)."""
    if v is None:
        return None
    v = float(v)
    if v > 10:
        v = v / 10
    return max(0.0, min(10.0, v))


def score100(v: float | None) -> float | None:
    t = to_ten(v)
    return None if t is None else round(t * 10, 1)


# -------------------- Domain-specific SDE interview topics --------------------
# These are TOPIC GUIDANCE for the LLM, not scripted questions - the interviewer
# phrases its own question about each topic based on the conversation so far,
# and may ask one natural follow-up before moving on.

QUESTION_TOPICS = {
    "ai_ml": [
        "Warm introduction - have the candidate tell you about their background, what they're passionate about "
        "in AI/ML, and what brought them to this interview.",

        "ML fundamentals - probe their understanding of supervised vs unsupervised vs reinforcement learning, "
        "ideally with a concrete example of when each is used in a real product.",

        "Overfitting - ask how they'd detect and address overfitting in a model they built; listen for specific "
        "techniques (regularization, cross-validation, dropout, more data, etc.).",

        "Productionizing ML - ask about a time they took a model from prototype/notebook to production, and how "
        "they handled challenges like data drift, latency, or scaling.",

        "Model tradeoffs - ask about the tradeoffs between using a large pretrained model (e.g. a transformer) "
        "versus training a smaller custom model for a specific use case, and how they'd decide.",

        "Closing - thank them for their answers and invite them to ask you anything about the company, the "
        "role, or the team.",
    ],
    "web_dev": [
        "Warm introduction - have the candidate tell you about their background, what they're passionate about "
        "in web development, and what brought them to this interview.",

        "Browser fundamentals - ask them to walk through what happens between typing a URL and the page fully "
        "rendering on screen.",

        "API design - ask about the difference between REST and GraphQL, the tradeoffs, and when they'd pick "
        "one over the other.",

        "Debugging story - ask about a challenging bug or performance issue they debugged in a web app, and how "
        "they found and fixed it.",

        "Architecture - ask how they'd design the frontend architecture for a real-time collaborative app like "
        "Google Docs, and how they'd keep multiple users' views in sync.",

        "Closing - thank them for their answers and invite them to ask you anything about the company, the "
        "role, or the team.",
    ],
    "dsa": [
        "Warm introduction - have the candidate tell you about their background, their experience with data "
        "structures & algorithms, and what brought them to this interview.",

        "Classic array problem - ask them to describe how they'd find two numbers in an array that add up to a "
        "target value (two-sum style), and its time complexity.",

        "Data structure tradeoffs - ask them to compare a hash map, a balanced BST, and a heap, and describe a "
        "scenario where each would be the best choice.",

        "Hardest problem - ask about the hardest algorithmic problem they've solved, their approach, and how "
        "they optimized it.",

        "Linked list cycle detection - ask how they'd detect a cycle in a linked list, ideally using only O(1) "
        "extra space (Floyd's algorithm).",

        "Closing - thank them for their answers and invite them to ask you anything about the company, the "
        "role, or the team.",
    ],
}

# Reference concepts per domain, used to (a) ground the interviewer's follow-up
# questions so it can push for real depth instead of accepting buzzwords, and
# (b) let the report grader check technical correctness against something concrete.
DOMAIN_KNOWLEDGE = {
    "ai_ml": (
        "Bias-variance tradeoff; regularization (L1/L2, dropout); cross-validation; gradient descent variants; "
        "batch/layer normalization; overfitting fixes (early stopping, more data, simpler model, augmentation); "
        "classical ML vs deep learning use cases; transfer learning and fine-tuning; evaluation metrics beyond "
        "accuracy (precision/recall/F1/AUC); data drift and monitoring in production; latency/throughput "
        "tradeoffs for serving models; embeddings and vector search basics."
    ),
    "web_dev": (
        "DNS resolution, TCP handshake, TLS; HTTP request/response cycle; critical rendering path; "
        "render-blocking CSS/JS; virtual DOM vs real DOM; REST statelessness vs GraphQL single-endpoint and "
        "over/under-fetching tradeoffs; caching layers (browser, CDN, server); CORS; WebSockets vs polling vs "
        "SSE for real-time sync; operational transforms/CRDTs for collaborative editing; session vs JWT auth; "
        "performance profiling tools."
    ),
    "dsa": (
        "Big-O time/space complexity; hash map O(1) average lookup and collision handling; BST balancing "
        "(AVL/red-black) and O(log n) guarantees; heap O(log n) insert/extract for priority queues; two-pointer "
        "and sliding window techniques; Floyd's cycle detection (tortoise and hare); recursion vs iteration "
        "tradeoffs; dynamic programming vs greedy; BFS/DFS use cases."
    ),
}


# -------------------- Company rubrics --------------------

def coerce_rubric(raw: Any) -> List[Dict[str, Any]]:
    """Room metadata is JSON written by our backend, but never trust its shape: keep only
    usable competencies (a name and a positive weight), at most MAX_COMPETENCIES."""
    out: List[Dict[str, Any]] = []
    if not isinstance(raw, list):
        return out
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        try:
            weight = int(item.get("weight") or 0)
        except (TypeError, ValueError):
            weight = 0
        if not name or weight < 1:
            continue
        questions = item.get("questions")
        out.append({
            "name": name[:60],
            "description": str(item.get("description") or "").strip()[:500],
            "weight": min(weight, 100),
            "questions": [str(q).strip() for q in (questions if isinstance(questions, list) else [])
                          if str(q).strip()][:MAX_QUESTIONS],
            "expected_concepts": str(item.get("expected_concepts") or "").strip()[:600],
        })
        if len(out) == MAX_COMPETENCIES:
            break
    return out


@dataclass
class Plan:
    label: str                       # shown to the model and in grading ("AI/ML", "Backend Engineer")
    topics: List[str]                # one entry per topic the interviewer works through, in order
    knowledge: str                   # reference points for judging correctness
    custom: bool = False
    role_title: str = ""
    company_name: str = ""
    level: str = ""
    competencies: List[Dict[str, Any]] = field(default_factory=list)
    # topics[i] assesses competencies[topic_competency[i]]; None for the intro and the closing.
    topic_competency: List[Optional[int]] = field(default_factory=list)


def _custom_topics(competencies: List[Dict[str, Any]], role: str, company: str) -> List[str]:
    at = f" at {company}" if company else ""
    topics = [
        f"Warm introduction - welcome the candidate to the interview for the {role} role{at}, and have "
        "them tell you about their background and what draws them to this role."
    ]
    for c in competencies:
        text = f"{c['name']} - assess this competency"
        text += f": {c['description']}" if c["description"] else "."
        text += (" Ask your own original, natural-sounding question about it, and push for specifics.")
        if c["questions"]:
            text += (" Ideas you may adapt (never read them out word for word): "
                     + " | ".join(c["questions"]))
        topics.append(text)
    topics.append(
        "Closing - thank them for their answers. If they have questions about the role, the team or the "
        "company, say you don't have those details and that you will pass their questions to the hiring team."
    )
    return topics


def build_plan(
    domain: Optional[str],
    rubric: Any = None,
    role_title: str = "",
    company_name: str = "",
    level: str = "",
) -> Optional[Plan]:
    """The interview plan for a built-in track, or for a company rubric when one is given.
    Returns None when neither applies (e.g. no domain chosen yet)."""
    competencies = coerce_rubric(rubric)
    if domain == "custom" or (domain is None and competencies):
        if not competencies:
            return None
        role = (role_title or "").strip() or "this"
        knowledge = "\n".join(
            f"{c['name']}: {c['expected_concepts']}" for c in competencies if c["expected_concepts"]
        ) or "Use your own expert judgement of what a strong answer looks like for this competency."
        return Plan(
            label=(role_title or "").strip() or "this role",
            topics=_custom_topics(competencies, role, (company_name or "").strip()),
            knowledge=knowledge,
            custom=True,
            role_title=(role_title or "").strip(),
            company_name=(company_name or "").strip(),
            level=(level or "").strip(),
            competencies=competencies,
            topic_competency=[None] + list(range(len(competencies))) + [None],
        )
    if domain in DOMAIN_LABELS:
        return Plan(
            label=DOMAIN_LABELS[domain],
            topics=QUESTION_TOPICS[domain],
            knowledge=DOMAIN_KNOWLEDGE[domain],
        )
    return None


def rubric_block(competencies: Iterable[Dict[str, Any]]) -> str:
    """The rubric as the grader sees it, with each weight as a share of the total."""
    comps = list(competencies)
    total = sum(c["weight"] for c in comps) or 1
    lines = []
    for c in comps:
        pct = round(c["weight"] * 100 / total)
        desc = f": {c['description']}" if c["description"] else ""
        lines.append(f"- {c['name']} (weight {pct}%){desc}")
    return "\n".join(lines)


def score_competencies(competencies: List[Dict[str, Any]], graded: Iterable[Any]) -> List[Dict[str, Any]]:
    """Turn the model's per-competency grades into the stored shape, in rubric order.

    Names, weights and order come from the rubric, never from the model, so the model cannot
    add, rename or re-weight a competency. A competency the model skipped keeps score None.
    """
    by_name: Dict[str, Any] = {}
    for g in graded or []:
        get = g.get if isinstance(g, dict) else lambda k, g=g: getattr(g, k, None)
        name = str(get("name") or "").strip().lower()
        if name and name not in by_name:
            by_name[name] = g
    out = []
    for c in competencies:
        g = by_name.get(c["name"].lower())
        get = (g.get if isinstance(g, dict) else lambda k, g=g: getattr(g, k, None)) if g is not None else (lambda k: None)
        out.append({
            "name": c["name"],
            "score": score100(get("score")),
            "weight": c["weight"],
            "evidence": str(get("evidence") or "").strip()[:600],
        })
    return out


def weighted_overall(scored: List[Dict[str, Any]]) -> Optional[float]:
    """Weighted average (0-100) over the competencies that were actually scored. A competency the
    candidate never reached does not count against them. None if nothing was scored."""
    pairs = [(s["score"], s["weight"]) for s in scored if s.get("score") is not None]
    total = sum(w for _, w in pairs)
    if not pairs or total <= 0:
        return None
    return round(sum(sc * w for sc, w in pairs) / total, 1)
