"""The conversation graph, run for real against a scripted fake model (no network).

Covers both modes: practice (a built-in track, unchanged) and company interviews (the hiring
team's rubric). Only the vector-store import is stubbed; langgraph itself is the real thing.

Run from ai-interviewer/:  python -m pytest tests
"""
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.modules.setdefault("langchain_chroma", types.SimpleNamespace(Chroma=object))

from langchain_core.messages import AIMessage, HumanMessage  # noqa: E402

import graph  # noqa: E402

RUBRIC = [
    {"name": "System design", "description": "Designs for scale.", "weight": 60,
     "questions": ["How would you design a URL shortener?"], "expected_concepts": "Sharding; caching."},
    {"name": "Communication", "description": "Explains clearly.", "weight": 40},
]


class FakeLLM:
    """Stands in for ChatGoogleGenerativeAI. The interview model pops scripted replies and records
    every system prompt; the report model (temperature 0.3) returns canned grading."""

    instances: list = []
    script: list = []
    prompts: list = []
    bound: list = []
    grading = None
    grading_prompts: list = []
    markdown = "# Report"

    def __init__(self, model=None, temperature=0.7, max_retries=1, **_):
        self.is_report = temperature == 0.3
        FakeLLM.instances.append(self)

    def bind_tools(self, tools):
        FakeLLM.bound.append([t.name for t in tools])
        return self

    def invoke(self, msgs):
        if self.is_report:
            FakeLLM.grading_prompts.append(msgs[-1].content)
            return AIMessage(content=FakeLLM.markdown)
        FakeLLM.prompts.append(msgs[0].content)
        return FakeLLM.script.pop(0)

    def with_structured_output(self, schema):
        outer = self

        class _Graded:
            def invoke(self, msgs):
                FakeLLM.grading_prompts.append(msgs[-1].content)
                return FakeLLM.grading

        return _Graded()


def record(q="Q", a="A"):
    return AIMessage(content="", tool_calls=[{"name": "record_answer_tool", "args": {"question": q, "answer": a}, "id": "t1"}])


def say(text):
    return AIMessage(content=text)


@pytest.fixture(autouse=True)
def fake(monkeypatch):
    FakeLLM.instances, FakeLLM.script, FakeLLM.prompts = [], [], []
    FakeLLM.bound, FakeLLM.grading_prompts, FakeLLM.markdown = [], [], "# Report"
    FakeLLM.grading = graph.InterviewScores(
        overall_score=2, technical_score=7, communication_score=6, strengths=["clear"],
        final_recommendation="Hire",
        competency_scores=[graph.CompetencyGrade(name="System design", score=8, evidence="Sharded by hash."),
                           graph.CompetencyGrade(name="Communication", score=6, evidence="Clear.")])
    monkeypatch.setattr(graph, "ChatGoogleGenerativeAI", FakeLLM)
    monkeypatch.setattr(graph.time, "sleep", lambda s: None)
    sent = []
    monkeypatch.setattr(graph, "submit_report", lambda payload: sent.append(payload) or True)
    monkeypatch.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return sent


def turn(workflow, thread, text="(answer)"):
    out = workflow.invoke({"messages": [HumanMessage(content=text)]}, config={"configurable": {"thread_id": thread}})
    return out["messages"][-1].content


def run_company(sent, **over):
    """Greeting, then answer each of the 4 topics (intro, 2 competencies, closing)."""
    kw = dict(room_name="room-1", initial_domain="custom", rubric=RUBRIC, role_title="Backend Engineer",
              company_name="Acme", level="mid")
    kw.update(over)
    wf, _ = graph.create_workflow(**kw)
    FakeLLM.script = [say("Tell me about yourself."),
                      record("intro?", "I build APIs."), say("How would you design a URL shortener?"),
                      record("design?", "Hash and shard."), say("How do you explain trade-offs?"),
                      record("comm?", "With diagrams."), say("Any questions for me?"),
                      record("closing?", "None.")]
    replies = [turn(wf, "t")]
    for _ in range(4):
        replies.append(turn(wf, "t"))
    return replies


# ═══ company interview ══════════════════════════════════════════════
def test_company_interview_goes_straight_to_the_role_without_asking_for_a_domain(fake):
    run_company(fake)
    first = FakeLLM.prompts[0]
    assert "Backend Engineer" in first and "at Acme" in first and "mid level" in first
    assert "Warm introduction" in first
    assert "which domain" not in first.lower() and "select_domain_tool" not in first


def test_each_turn_asks_about_the_next_competency_with_its_seed_question_and_concepts(fake):
    run_company(fake)
    prompts = FakeLLM.prompts
    design = next(p for p in prompts if "System design - assess this competency" in p)
    assert "URL shortener" in design and "Sharding; caching." in design and "Designs for scale." in design
    comm = next(p for p in prompts if "Communication - assess this competency" in p)
    assert "Explains clearly." in comm and "URL shortener" not in comm.split("Current topic")[1]
    assert any("pass their questions to the hiring team" in p for p in prompts)


def test_company_interview_never_offers_mirracle_company_info(fake):
    run_company(fake)
    assert FakeLLM.bound[0] == ["record_answer_tool", "select_domain_tool"]
    assert not any("company_info_tool to find" in p for p in FakeLLM.prompts)
    assert any("hiring team will follow up" in p for p in FakeLLM.prompts)


def test_finishing_a_company_interview_reports_rubric_scores_and_a_weighted_overall(fake):
    replies = run_company(fake)
    (payload,) = fake
    assert payload["room_id"] == "room-1" and payload["partial"] is False
    assert [(c["name"], c["score"], c["weight"]) for c in payload["competency_scores"]] == [
        ("System design", 80.0, 60), ("Communication", 60.0, 40)]
    # The model said 2/10 overall; the company's weights decide: (80*60 + 60*40) / 100.
    assert payload["overall_score"] == 72.0
    assert payload["final_recommendation"] == "Hire" and payload["report_markdown"] == "# Report"
    assert payload["competency_scores"][0]["evidence"] == "Sharded by hash."
    # The closing exchange is not graded as a technical answer.
    assert "closing?" not in payload["transcript"] and "design?" in payload["transcript"]
    # The candidate is told it went to the hiring team, and not promised a report they will not get.
    farewell = replies[-1]
    assert "Acme" in farewell and "hiring team" in farewell and "dashboard" not in farewell


def test_the_grading_prompt_carries_the_rubric_and_asks_for_per_competency_scores(fake):
    run_company(fake)
    prompt = FakeLLM.grading_prompts[0]
    assert "Backend Engineer role (mid level) at Acme" in prompt
    assert "- System design (weight 60%): Designs for scale." in prompt
    assert "- Communication (weight 40%)" in prompt
    assert "competency_scores" in prompt and "Sharding; caching." in prompt


def test_an_unreached_competency_is_left_out_of_the_overall(fake):
    FakeLLM.grading = graph.InterviewScores(
        overall_score=9, competency_scores=[graph.CompetencyGrade(name="System design", score=7, evidence="ok")])
    wf, generate_report = graph.create_workflow(
        room_name="r", initial_domain="custom", rubric=RUBRIC, role_title="Backend Engineer", company_name="Acme")
    generate_report("custom", [{"question": "q", "answer": "a"}], True)  # candidate left early
    (payload,) = fake
    assert payload["partial"] is True
    assert [c["score"] for c in payload["competency_scores"]] == [70.0, None]
    assert payload["overall_score"] == 70.0
    assert "disconnected before completing" in FakeLLM.grading_prompts[0]


def test_the_model_cannot_add_rename_or_reweight_competencies(fake):
    FakeLLM.grading = graph.InterviewScores(competency_scores=[
        graph.CompetencyGrade(name="Hidden gem", score=10, evidence="made up"),
        graph.CompetencyGrade(name="communication", score=10, evidence="x")])
    _, generate_report = graph.create_workflow(room_name="r", initial_domain="custom", rubric=RUBRIC)
    generate_report("custom", [{"question": "q", "answer": "a"}])
    (payload,) = fake
    assert [c["name"] for c in payload["competency_scores"]] == ["System design", "Communication"]
    assert [c["weight"] for c in payload["competency_scores"]] == [60, 40]
    assert payload["competency_scores"][0]["score"] is None and payload["overall_score"] == 100.0


def test_a_company_interview_without_a_usable_rubric_falls_back_to_asking_for_a_domain(fake):
    wf, _ = graph.create_workflow(room_name="r", initial_domain="custom", rubric=[{"name": "", "weight": 0}])
    FakeLLM.script = [say("Which domain?")]
    turn(wf, "t")
    assert "which domain" in FakeLLM.prompts[0].lower()


# ═══ practice (unchanged) ═══════════════════════════════════════════
def test_practice_track_behaves_as_before(fake):
    wf, generate_report = graph.create_workflow(room_name="p1", initial_domain="dsa")
    FakeLLM.script = [say("Tell me about yourself.")]
    turn(wf, "t")
    first = FakeLLM.prompts[0]
    assert "Data Structures & Algorithms domain" in first and "Warm introduction" in first
    assert "Big-O time/space complexity" in first            # the track's reference concepts
    assert "company_info_tool" not in first or "Mirracle platform" in first
    assert "competency" not in first.lower()


def test_practice_report_has_no_competency_scores_and_keeps_the_models_overall(fake):
    wf, generate_report = graph.create_workflow(room_name="p1", initial_domain="web_dev")
    generate_report("web_dev", [{"question": "q", "answer": "a"}])
    (payload,) = fake
    assert "competency_scores" not in payload
    assert payload["overall_score"] == 20.0                   # the model's own 2/10
    prompt = FakeLLM.grading_prompts[0]
    assert "web development" in prompt.lower() and "competency_scores" not in prompt
    assert "hiring team defined this rubric" not in prompt


def test_practice_farewell_still_points_to_the_dashboard_report(fake):
    wf, _ = graph.create_workflow(room_name="p1", initial_domain="dsa")
    n = len(graph.build_plan("dsa").topics)
    FakeLLM.script = [say("Hi")] + [m for i in range(n) for m in ([record()] + ([say("next")] if i < n - 1 else []))]
    turn(wf, "t")
    last = ""
    for _ in range(n):
        last = turn(wf, "t")
    assert "dashboard" in last and "hiring team" not in last


def test_without_a_domain_the_interviewer_asks_the_candidate_to_choose(fake):
    wf, _ = graph.create_workflow(room_name="p1")
    FakeLLM.script = [say("Which domain would you like?")]
    turn(wf, "t")
    assert "AI/ML, Web Development, or Data Structures" in FakeLLM.prompts[0]
    assert "select_domain_tool" in FakeLLM.prompts[0]


def test_unknown_domains_are_ignored(fake):
    wf, _ = graph.create_workflow(room_name="p1", initial_domain="astrology")
    FakeLLM.script = [say("Which domain?")]
    turn(wf, "t")
    assert "select_domain_tool" in FakeLLM.prompts[0]
