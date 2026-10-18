"""Rubric rules for company AI interviews (pure: no database, no web framework).

A rubric is the list of competencies a company wants the AI interviewer to assess.
The interviewer asks about each one in order and scores each one, and the overall
score is the weighted average using the weights defined here.
"""

from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, Field, field_validator

MAX_COMPETENCIES = 8
MAX_QUESTIONS = 3
MIN_DURATION, MAX_DURATION = 10, 60


class CompetencyIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    # What the interviewer should assess, and what a strong answer looks like.
    description: str = Field(default="", max_length=500)
    weight: int = Field(ge=1, le=100)
    # Optional seed questions. The interviewer adapts them; it does not read them out.
    questions: List[str] = Field(default_factory=list, max_length=MAX_QUESTIONS)
    # Optional reference points used to check technical correctness.
    expected_concepts: str = Field(default="", max_length=600)

    @field_validator("name", "description", "expected_concepts")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, v: str) -> str:
        if len(v) < 2:
            raise ValueError("Competency name must be at least 2 characters.")
        return v

    @field_validator("questions")
    @classmethod
    def _questions(cls, v: List[str]) -> List[str]:
        cleaned = [q.strip() for q in v if q and q.strip()]
        if any(len(q) > 300 for q in cleaned):
            raise ValueError("Each seed question must be 300 characters or fewer.")
        return cleaned


def validate_rubric(items: List[CompetencyIn]) -> List[Dict[str, Any]]:
    """Cross-field rules: 1 to MAX_COMPETENCIES competencies with unique names."""
    if not items:
        raise ValueError("Add at least one competency to the rubric.")
    if len(items) > MAX_COMPETENCIES:
        raise ValueError(f"A rubric can have at most {MAX_COMPETENCIES} competencies.")
    seen: set[str] = set()
    for c in items:
        key = c.name.lower()
        if key in seen:
            raise ValueError(f"Competency names must be unique ('{c.name}' appears twice).")
        seen.add(key)
    return [c.model_dump() for c in items]


def with_percentages(rubric: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Add `weight_pct`: each weight as a whole percentage of the total, summing to exactly 100
    (largest-remainder rounding, so the numbers shown to a hiring team always add up)."""
    total = sum(max(0, int(c.get("weight") or 0)) for c in rubric)
    if total <= 0:
        return [{**c, "weight_pct": 0} for c in rubric]
    exact = [max(0, int(c.get("weight") or 0)) * 100 / total for c in rubric]
    floors = [int(x) for x in exact]
    leftover = 100 - sum(floors)
    order = sorted(range(len(rubric)), key=lambda i: exact[i] - floors[i], reverse=True)
    for i in order[:leftover]:
        floors[i] += 1
    return [{**c, "weight_pct": floors[i]} for i, c in enumerate(rubric)]


def _preset(label: str, role: str, comps: List[tuple]) -> Dict[str, Any]:
    return {
        "label": label,
        "role_title": role,
        "competencies": [
            {"name": n, "description": d, "weight": w, "questions": q, "expected_concepts": e}
            for n, d, w, q, e in comps
        ],
    }


# Starting points built from the three practice tracks, so a company does not begin
# from a blank page. They are copied into the template when chosen, then edited freely.
PRESETS: Dict[str, Dict[str, Any]] = {
    "ai_ml": _preset("AI / ML Engineer", "AI / ML Engineer", [
        ("ML fundamentals", "Understands supervised, unsupervised and reinforcement learning and when each fits.", 25,
         ["When would you use supervised vs unsupervised learning in a real product?"],
         "Bias-variance tradeoff; classical ML vs deep learning use cases; evaluation metrics beyond accuracy "
         "(precision, recall, F1, AUC)."),
        ("Generalization and overfitting", "Can detect and fix overfitting with specific techniques.", 25,
         ["How would you detect and address overfitting in a model you built?"],
         "Regularization (L1/L2, dropout); cross-validation; early stopping; more data; augmentation; simpler model."),
        ("Productionizing models", "Has taken a model from notebook to production and handled real constraints.", 30,
         ["Tell me about taking a model from prototype to production. What went wrong?"],
         "Data drift and monitoring; latency and throughput; scaling serving; embeddings and vector search basics."),
        ("Model tradeoffs", "Reasons about pretrained vs custom models.", 20,
         ["Large pretrained model or a smaller custom one for a specific use case? How do you decide?"],
         "Transfer learning and fine-tuning; cost, latency and accuracy tradeoffs."),
    ]),
    "web_dev": _preset("Web Developer", "Web Developer", [
        ("Browser and network fundamentals", "Explains what happens from URL to rendered page.", 25,
         ["Walk me through what happens between typing a URL and the page fully rendering."],
         "DNS, TCP, TLS; HTTP request/response; critical rendering path; render-blocking CSS and JS."),
        ("API design", "Compares REST and GraphQL with real tradeoffs.", 25,
         ["REST or GraphQL: how do you choose?"],
         "REST statelessness; GraphQL single endpoint; over/under-fetching; caching layers; CORS."),
        ("Debugging and performance", "Finds and fixes hard bugs and performance problems systematically.", 25,
         ["Tell me about a hard bug or performance problem you debugged in a web app."],
         "Profiling tools; network waterfall; memory leaks; caching (browser, CDN, server)."),
        ("Architecture", "Designs real-time, multi-user frontends.", 25,
         ["How would you architect a real-time collaborative editor on the frontend?"],
         "WebSockets vs polling vs SSE; operational transforms and CRDTs; session vs JWT auth."),
    ]),
    "dsa": _preset("Software Engineer (DSA)", "Software Engineer", [
        ("Problem solving", "Breaks down a classic problem and states complexity.", 30,
         ["How would you find two numbers in an array that add up to a target? What is the complexity?"],
         "Hash map O(1) average lookup; two-pointer and sliding window; Big-O time and space."),
        ("Data structure tradeoffs", "Chooses between hash map, balanced BST and heap with reasons.", 30,
         ["Compare a hash map, a balanced BST and a heap. When is each the best choice?"],
         "BST balancing (AVL, red-black) and O(log n); heap O(log n) insert/extract; priority queues."),
        ("Optimization and depth", "Has solved and optimized a hard problem.", 20,
         ["What is the hardest algorithmic problem you solved, and how did you optimize it?"],
         "Dynamic programming vs greedy; recursion vs iteration; BFS/DFS use cases."),
        ("Pointer techniques", "Applies constant-space techniques.", 20,
         ["How would you detect a cycle in a linked list using O(1) extra space?"],
         "Floyd's tortoise and hare."),
    ]),
}


def normalize_draft(raw: Any) -> List[Dict[str, Any]]:
    """Turn a model-drafted rubric into a valid one, or an empty list if nothing is usable.

    The model's output is never trusted: names are de-duplicated, text is trimmed, at most
    MAX_COMPETENCIES are kept, and the weights are rescaled to whole numbers that add up to 100
    (every competency keeps at least 1).
    """
    items = raw.get("competencies") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return []
    kept: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for it in items:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "").strip()[:60]
        if len(name) < 2 or name.lower() in seen:
            continue
        try:
            w = float(it.get("weight"))
        except (TypeError, ValueError):
            w = 10.0
        qs = it.get("questions") if isinstance(it.get("questions"), list) else []
        try:
            c = CompetencyIn(
                name=name,
                description=str(it.get("description") or "")[:500],
                weight=1,
                questions=[str(q).strip()[:300] for q in qs if str(q).strip()][:MAX_QUESTIONS],
                expected_concepts=str(it.get("expected_concepts") or "")[:600],
            )
        except ValueError:
            continue
        seen.add(name.lower())
        kept.append({**c.model_dump(), "_w": max(w, 0.0)})
        if len(kept) == MAX_COMPETENCIES:
            break
    if not kept:
        return []
    total = sum(k["_w"] for k in kept) or float(len(kept))
    raw_shares = [(k["_w"] or 0.0) * 100 / total if total else 100 / len(kept) for k in kept]
    # Give each at least 1, then largest-remainder to land on exactly 100.
    floors = [max(1, int(x)) for x in raw_shares]
    diff = 100 - sum(floors)
    order = sorted(range(len(kept)), key=lambda i: raw_shares[i] - int(raw_shares[i]), reverse=True)
    i = 0
    while diff != 0 and kept:
        idx = order[i % len(order)] if diff > 0 else order[::-1][i % len(order)]
        if diff > 0:
            floors[idx] += 1
            diff -= 1
        elif floors[idx] > 1:
            floors[idx] -= 1
            diff += 1
        i += 1
        if i > 1000:
            break
    out = []
    for k, w in zip(kept, floors):
        k.pop("_w")
        out.append({**k, "weight": w})
    return out
