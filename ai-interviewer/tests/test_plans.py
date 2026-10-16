"""Unit tests for interview plans and rubric scoring (pure: no model, no network).

Run from ai-interviewer/:  python -m pytest tests
"""
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import plans  # noqa: E402
from plans import (  # noqa: E402
    build_plan,
    coerce_rubric,
    rubric_block,
    score100,
    score_competencies,
    to_ten,
    weighted_overall,
)

RUBRIC = [
    {"name": "System design", "description": "Designs for scale.", "weight": 60,
     "questions": ["How would you design a URL shortener?"], "expected_concepts": "Sharding; caching."},
    {"name": "Communication", "weight": 40},
]


# ─── score normalisation ──────────────────────────────────────────────────────

def test_scores_accept_a_ten_or_hundred_scale_and_clamp():
    assert to_ten(7) == 7 and to_ten(70) == 7 and to_ten(100) == 10
    assert to_ten(-3) == 0 and to_ten(None) is None
    assert score100(7) == 70.0 and score100(85) == 85.0 and score100(None) is None


# ─── coerce_rubric ────────────────────────────────────────────────────────────

def test_coerce_keeps_good_competencies_and_fills_defaults():
    (a, b) = coerce_rubric(RUBRIC)
    assert a["name"] == "System design" and a["weight"] == 60 and a["questions"] == RUBRIC[0]["questions"]
    assert b == {"name": "Communication", "description": "", "weight": 40, "questions": [], "expected_concepts": ""}


def test_coerce_drops_unusable_entries_instead_of_failing():
    raw = ["junk", None, 5, {"weight": 10}, {"name": "  ", "weight": 10}, {"name": "No weight"},
           {"name": "Zero", "weight": 0}, {"name": "Bad weight", "weight": "lots"},
           {"name": "Fine", "weight": "30"}]
    assert [c["name"] for c in coerce_rubric(raw)] == ["Fine"]
    assert coerce_rubric(None) == [] and coerce_rubric("x") == [] and coerce_rubric({}) == []


def test_coerce_limits_size_and_trims_text():
    many = [{"name": f"Skill {i}", "weight": 5} for i in range(20)]
    assert len(coerce_rubric(many)) == plans.MAX_COMPETENCIES
    c = coerce_rubric([{"name": "N" * 100, "weight": 500, "description": "d" * 900,
                        "questions": ["a", " ", "b", "c", "d", "e"], "expected_concepts": "x" * 900}])[0]
    assert len(c["name"]) == 60 and c["weight"] == 100 and len(c["description"]) == 500
    assert c["questions"] == ["a", "b", "c"] and len(c["expected_concepts"]) == 600
    assert coerce_rubric([{"name": "Q", "weight": 5, "questions": "not a list"}])[0]["questions"] == []


# ─── build_plan ───────────────────────────────────────────────────────────────

def test_company_plan_is_intro_then_each_competency_then_closing():
    p = build_plan("custom", RUBRIC, "Backend Engineer", "Acme", "mid")
    assert p.custom and p.label == "Backend Engineer" and p.company_name == "Acme" and p.level == "mid"
    assert len(p.topics) == 4 and p.topic_competency == [None, 0, 1, None]
    assert "Backend Engineer" in p.topics[0] and "Acme" in p.topics[0]
    assert p.topics[1].startswith("System design - assess this competency: Designs for scale.")
    assert "URL shortener" in p.topics[1] and "never read them out" in p.topics[1]
    assert p.topics[2].startswith("Communication - assess this competency.")
    assert "hiring team" in p.topics[3]
    assert "System design: Sharding; caching." in p.knowledge


def test_company_plan_needs_a_usable_rubric():
    assert build_plan("custom", None) is None
    assert build_plan("custom", []) is None
    assert build_plan("custom", [{"name": "", "weight": 1}]) is None


def test_a_rubric_alone_selects_the_company_plan_but_a_known_track_wins_over_none():
    assert build_plan(None, RUBRIC).custom is True
    assert build_plan(None) is None
    assert build_plan("nope") is None


def test_practice_tracks_are_unchanged():
    for domain in ("ai_ml", "web_dev", "dsa"):
        p = build_plan(domain)
        assert not p.custom and p.topics is plans.QUESTION_TOPICS[domain]
        assert p.knowledge == plans.DOMAIN_KNOWLEDGE[domain] and p.competencies == []
        assert p.topics[0].startswith("Warm introduction") and p.topics[-1].startswith("Closing")
    assert build_plan("dsa").label == "Data Structures & Algorithms"
    # A stray rubric never turns a practice track into a company interview.
    assert not build_plan("ai_ml", RUBRIC).custom


# ─── rubric_block ─────────────────────────────────────────────────────────────

def test_rubric_block_shows_each_weight_as_a_share_of_the_total():
    text = rubric_block(coerce_rubric(RUBRIC))
    assert "- System design (weight 60%): Designs for scale." in text
    assert "- Communication (weight 40%)" in text
    half = rubric_block(coerce_rubric([{"name": "A one", "weight": 1}, {"name": "B two", "weight": 1}]))
    assert half.count("50%") == 2


# ─── score_competencies / weighted_overall ────────────────────────────────────

def comps():
    return coerce_rubric(RUBRIC)


def test_scores_follow_the_rubric_order_names_and_weights_not_the_models():
    graded = [
        {"name": "communication", "score": 6, "evidence": "Clear."},      # case differs, order swapped
        {"name": "System Design", "score": 85, "evidence": "Sharded."},    # 0-100 scale
        {"name": "Invented skill", "score": 10, "evidence": "made up"},   # not in the rubric
    ]
    out = score_competencies(comps(), graded)
    assert [(o["name"], o["score"], o["weight"]) for o in out] == [
        ("System design", 85.0, 60), ("Communication", 60.0, 40)]
    assert out[0]["evidence"] == "Sharded."


def test_missing_competencies_stay_unscored_and_objects_work_too():
    out = score_competencies(comps(), [SimpleNamespace(name="System design", score=7, evidence="ok")])
    assert out[0]["score"] == 70.0 and out[1] == {"name": "Communication", "score": None, "weight": 40, "evidence": ""}
    assert [o["score"] for o in score_competencies(comps(), None)] == [None, None]
    assert [o["score"] for o in score_competencies(comps(), [])] == [None, None]


def test_first_grade_for_a_competency_wins_and_evidence_is_capped():
    out = score_competencies(comps(), [
        {"name": "System design", "score": 9, "evidence": "e" * 900},
        {"name": "System design", "score": 1, "evidence": "later"}])
    assert out[0]["score"] == 90.0 and len(out[0]["evidence"]) == 600


def test_weighted_overall_uses_the_companys_weights():
    scored = [{"score": 80.0, "weight": 60}, {"score": 60.0, "weight": 40}]
    assert weighted_overall(scored) == 72.0
    # Same scores, flipped weights: a different answer. The weights decide, not the model.
    assert weighted_overall([{"score": 80.0, "weight": 40}, {"score": 60.0, "weight": 60}]) == 68.0


def test_unreached_competencies_do_not_count_against_the_candidate():
    scored = [{"score": 80.0, "weight": 60}, {"score": None, "weight": 40}]
    assert weighted_overall(scored) == 80.0
    assert weighted_overall([{"score": None, "weight": 10}]) is None
    assert weighted_overall([]) is None
    assert weighted_overall([{"score": 50.0, "weight": 0}]) is None
