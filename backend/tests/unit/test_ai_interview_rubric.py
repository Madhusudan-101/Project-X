"""Unit tests for rubric drafting: whatever a model returns is validated and re-weighted before a company sees it."""
import asyncio
from types import SimpleNamespace

import pytest

from app.services.ai_interview import rubric_draft
from app.services.ai_interview.rubric import MAX_COMPETENCIES, normalize_draft, with_percentages


def comp(name, weight=10, **extra):
    return {"name": name, "weight": weight, **extra}


# ─── normalize_draft ──────────────────────────────────────────────────────────

def test_weights_are_rescaled_to_whole_numbers_that_add_up_to_100():
    out = normalize_draft([comp("Design", 60), comp("Comms", 40)])
    assert [c["weight"] for c in out] == [60, 40]
    for weights in ([1, 1, 1], [7, 11, 13], [33, 33, 34], [3, 5, 9, 1, 2], [1] * 8, [0.5, 0.25, 0.25]):
        out = normalize_draft([comp(f"Skill {i}", w) for i, w in enumerate(weights)])
        assert sum(c["weight"] for c in out) == 100 and all(c["weight"] >= 1 for c in out), weights


def test_a_tiny_weight_still_counts_for_at_least_one_percent():
    out = normalize_draft([comp("Big", 1000), comp("Tiny", 1)])
    assert [c["weight"] for c in out] == [99, 1]


def test_missing_zero_negative_or_junk_weights_do_not_break_it():
    out = normalize_draft([comp("A one", None), comp("B two", "lots"), comp("C three", -5)])
    assert sum(c["weight"] for c in out) == 100 and all(c["weight"] >= 1 for c in out)
    out = normalize_draft([comp("A one", 0), comp("B two", 0)])
    assert [c["weight"] for c in out] == [50, 50]


def test_names_are_deduplicated_trimmed_and_too_short_ones_dropped():
    out = normalize_draft([comp("  Design  "), comp("design"), comp("X"), comp(""), comp("Comms")])
    assert [c["name"] for c in out] == ["Design", "Comms"]


def test_junk_entries_are_skipped_instead_of_failing_the_whole_draft():
    out = normalize_draft(["nope", None, 5, {"weight": 3}, {"name": None}, comp("Real one")])
    assert [c["name"] for c in out] == ["Real one"]
    assert normalize_draft(None) == [] and normalize_draft("x") == [] and normalize_draft({}) == []
    assert normalize_draft([]) == [] and normalize_draft([{"name": ""}]) == []


def test_it_accepts_the_list_directly_or_wrapped_in_an_object():
    assert len(normalize_draft({"competencies": [comp("One"), comp("Two")]})) == 2
    assert normalize_draft({"competencies": "not a list"}) == []


def test_it_keeps_at_most_eight_competencies():
    out = normalize_draft([comp(f"Skill {i}") for i in range(20)])
    assert len(out) == MAX_COMPETENCIES and sum(c["weight"] for c in out) == 100


def test_text_fields_are_trimmed_and_limited():
    out = normalize_draft([comp("Depth", 10, description="d" * 900, expected_concepts="e" * 900,
                                questions=["a", " ", "b", "c", "d", "x" * 400])])[0]
    assert len(out["description"]) == 500 and len(out["expected_concepts"]) == 600
    assert out["questions"] == ["a", "b", "c"]
    assert normalize_draft([comp("Depth", 10, questions="not a list")])[0]["questions"] == []
    assert len(normalize_draft([comp("Depth", 10, questions=["x" * 400])])[0]["questions"][0]) == 300


def test_a_drafted_rubric_can_be_shown_with_percentages():
    out = with_percentages(normalize_draft([comp("A one", 2), comp("B two", 1)]))
    assert [c["weight_pct"] for c in out] == [67, 33]


# ─── parse_model_json ─────────────────────────────────────────────────────────

def test_json_is_found_plain_fenced_or_inside_chatter():
    assert rubric_draft.parse_model_json('[{"name": "A"}]') == [{"name": "A"}]
    assert rubric_draft.parse_model_json('```json\n[{"name": "A"}]\n```') == [{"name": "A"}]
    assert rubric_draft.parse_model_json('Sure! Here you go:\n[{"name": "A"}]\nHope that helps') == [{"name": "A"}]
    assert rubric_draft.parse_model_json('{"competencies": []}') == {"competencies": []}


def test_a_reply_with_no_json_is_an_error():
    with pytest.raises(ValueError):
        rubric_draft.parse_model_json("I cannot help with that.")
    with pytest.raises(ValueError):
        rubric_draft.parse_model_json("")


# ─── draft_rubric ─────────────────────────────────────────────────────────────

class FakeClient:
    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self._gen))

    async def _gen(self, model, contents, config):
        self.calls.append((model, contents, config))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return SimpleNamespace(text=reply)


GOOD = '[{"name": "Reasoning", "weight": 3, "questions": ["Why?"]}, {"name": "Communication", "weight": 1}]'


def test_a_good_answer_becomes_a_valid_rubric():
    client = FakeClient(GOOD)
    out = asyncio.run(rubric_draft.draft_rubric("Backend Engineer", "mid", "Build APIs.", client=client))
    assert [(c["name"], c["weight"]) for c in out] == [("Reasoning", 75), ("Communication", 25)]
    prompt = client.calls[0][1][0]
    assert "Role: Backend Engineer" in prompt and "Level: mid" in prompt and "Build APIs." in prompt


def test_the_prompt_forbids_protected_characteristics_and_asks_for_json_only():
    assert "protected characteristics" in rubric_draft._SYSTEM and "ONLY a JSON array" in rubric_draft._SYSTEM


def test_without_a_description_the_prompt_says_so_and_long_ones_are_cut():
    client = FakeClient(GOOD, GOOD)
    asyncio.run(rubric_draft.draft_rubric("Dev", "junior", "", client=client))
    assert "(none given)" in client.calls[0][1][0]
    asyncio.run(rubric_draft.draft_rubric("Dev", "junior", "x" * 9000, client=client))
    assert "…[truncated]" in client.calls[1][1][0] and len(client.calls[1][1][0]) < 6300


def test_it_falls_back_to_the_next_model_when_one_fails_or_returns_nonsense():
    client = FakeClient(RuntimeError("quota"), "no json here", GOOD)
    out = asyncio.run(rubric_draft.draft_rubric("Dev", "junior", "", client=client))
    assert len(out) == 2 and len(client.calls) == 3
    assert len({c[0] for c in client.calls}) == 3  # each attempt used a different model


def test_when_every_model_fails_it_raises_a_clear_error():
    n = len(rubric_draft._MODEL_CANDIDATES)
    with pytest.raises(ValueError, match="Could not draft a rubric"):
        asyncio.run(rubric_draft.draft_rubric("Dev", "junior", "", client=FakeClient(*[RuntimeError("x")] * n)))
    with pytest.raises(ValueError):  # valid JSON but nothing usable in it
        asyncio.run(rubric_draft.draft_rubric("Dev", "junior", "", client=FakeClient(*['[{"name": ""}]'] * n)))


def test_without_an_ai_key_it_says_so(monkeypatch):
    def no_key():
        raise RuntimeError("GEMINI_API_KEY is not set")

    monkeypatch.setattr(rubric_draft, "_get_client", no_key)
    with pytest.raises(RuntimeError):
        asyncio.run(rubric_draft.draft_rubric("Dev", "junior", ""))
