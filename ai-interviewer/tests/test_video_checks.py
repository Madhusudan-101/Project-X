"""Unit tests for the interviewer's video check (no network, no real room, no real model).

Run from ai-interviewer/:  python -m pytest tests
"""
import asyncio
import json
import os
import sys
from types import SimpleNamespace

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import reporting  # noqa: E402
import video_checks as vc  # noqa: E402
from video_checks import (  # noqa: E402
    CAMERA_BLOCKED,
    CLEARED,
    FLAGGED,
    MULTIPLE_FACES,
    NO_FACE,
    FrameVerdict,
    GeminiFrameAnalyzer,
    VideoMonitor,
    ViolationTracker,
    parse_verdict,
    violation_of,
)

OK = FrameVerdict(face_count=1, camera_blocked=False)
NONE_ = FrameVerdict(face_count=0, camera_blocked=False)
TWO = FrameVerdict(face_count=2, camera_blocked=False)
BLOCKED = FrameVerdict(face_count=0, camera_blocked=True)


# ─── verdicts ─────────────────────────────────────────────────────────────────

def test_violation_kinds():
    assert violation_of(OK) is None
    assert violation_of(NONE_) == NO_FACE
    assert violation_of(TWO) == MULTIPLE_FACES
    assert violation_of(FrameVerdict(5, False)) == MULTIPLE_FACES
    # A blocked camera is reported as blocked, not as "no face".
    assert violation_of(BLOCKED) == CAMERA_BLOCKED


def test_parse_verdict_accepts_dicts_and_objects_and_rejects_junk():
    assert parse_verdict({"face_count": 2, "camera_blocked": False}) == TWO
    assert parse_verdict(SimpleNamespace(face_count="1", camera_blocked=0)) == OK
    assert parse_verdict({"face_count": -3, "camera_blocked": False}).face_count == 0
    assert parse_verdict({"face_count": "many"}) is None
    assert parse_verdict({}) is None
    assert parse_verdict(None) is None


# ─── tracker ──────────────────────────────────────────────────────────────────

def test_a_single_bad_frame_is_not_flagged():
    t = ViolationTracker(confirm=2)
    assert t.observe(NONE_) == []
    assert t.observe(OK) == []  # recovered before it was confirmed
    assert t.observe(NONE_) == []  # streak restarted


def test_confirmed_violation_is_flagged_once_per_episode():
    t = ViolationTracker(confirm=2)
    assert t.observe(NONE_) == []
    assert t.observe(NONE_) == [(FLAGGED, NO_FACE)]
    assert t.observe(NONE_) == []  # same episode, not re-reported
    assert t.observe(NONE_) == []


def test_violation_clears_on_a_normal_frame_and_can_flag_again():
    t = ViolationTracker(confirm=2)
    t.observe(TWO)
    assert t.observe(TWO) == [(FLAGGED, MULTIPLE_FACES)]
    assert t.observe(OK) == [(CLEARED, MULTIPLE_FACES)]
    assert t.observe(OK) == []
    t.observe(TWO)
    assert t.observe(TWO) == [(FLAGGED, MULTIPLE_FACES)]


def test_switching_violation_clears_the_old_one_and_needs_its_own_confirmation():
    t = ViolationTracker(confirm=2)
    t.observe(NONE_)
    t.observe(NONE_)
    assert t.observe(TWO) == []  # only one sighting of the new kind so far
    assert t.observe(TWO) == [(CLEARED, NO_FACE), (FLAGGED, MULTIPLE_FACES)]


def test_unanalysable_frames_change_nothing():
    t = ViolationTracker(confirm=2)
    t.observe(NONE_)
    assert t.observe(None) == []  # a model failure must not reset or confirm anything
    assert t.observe(NONE_) == [(FLAGGED, NO_FACE)]
    assert t.observe(None) == []
    assert t.active == NO_FACE


def test_confirm_is_at_least_one():
    t = ViolationTracker(confirm=0)
    assert t.observe(NONE_) == [(FLAGGED, NO_FACE)]


# ─── analyzer (fake model) ────────────────────────────────────────────────────

class FakeChain:
    def __init__(self, result=None, error=None):
        self.result, self.error, self.calls = result, error, []

    async def ainvoke(self, messages):
        self.calls.append(messages)
        if self.error:
            raise self.error
        return self.result


class FakeLLM:
    def __init__(self, chain):
        self.chain = chain

    def with_structured_output(self, schema):
        self.schema = schema
        return self.chain


def test_analyzer_sends_the_frame_with_a_narrow_prompt_and_parses_the_answer():
    chain = FakeChain(result={"face_count": 2, "camera_blocked": False})
    verdict = asyncio.run(GeminiFrameAnalyzer(FakeLLM(chain)).analyze(b"\xff\xd8jpegbytes"))
    assert verdict == TWO
    content = chain.calls[0][0].content
    assert content[0]["text"] == vc.FRAME_PROMPT
    assert content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    # The prompt must forbid judging gaze, emotion or appearance.
    for word in ("gaze", "emotion", "appearance", "Do not identify"):
        assert word in vc.FRAME_PROMPT


def test_analyzer_returns_none_instead_of_raising_when_the_model_fails():
    chain = FakeChain(error=RuntimeError("quota"))
    assert asyncio.run(GeminiFrameAnalyzer(FakeLLM(chain)).analyze(b"x")) is None


# ─── monitor loop ─────────────────────────────────────────────────────────────

class ScriptedAnalyzer:
    def __init__(self, *verdicts):
        self.verdicts, self.calls = list(verdicts), 0

    async def analyze(self, jpeg):
        self.calls += 1
        return self.verdicts.pop(0)


def make_monitor(frames, analyzer, confirm=2):
    clock = iter(range(0, 1000, 15))
    events = []

    async def emit(state, kind, offset):
        events.append((state, kind, offset))

    it = iter(frames)
    mon = VideoMonitor(
        get_frame=lambda: next(it),
        analyzer=analyzer,
        tracker=ViolationTracker(confirm=confirm),
        emit=emit,
        clock=lambda: next(clock),
    )
    return mon, events


def test_monitor_skips_the_model_when_there_is_no_frame_yet():
    an = ScriptedAnalyzer()
    mon, events = make_monitor([None], an)
    asyncio.run(mon.check_once())
    assert an.calls == 0 and events == []


def test_monitor_emits_flag_with_offset_then_clear():
    an = ScriptedAnalyzer(NONE_, NONE_, OK)
    mon, events = make_monitor([b"a", b"b", b"c"], an)

    async def run():
        for _ in range(3):
            await mon.check_once()

    asyncio.run(run())
    # clock ticks 0 (start), 15, 30, 45 ... so offsets are seconds since the monitor began
    assert events == [(FLAGGED, NO_FACE, 30), (CLEARED, NO_FACE, 45)]


# ─── delivery to the backend ──────────────────────────────────────────────────

class Resp:
    def __init__(self, code, text=""):
        self.status_code, self.text = code, text


@pytest.fixture()
def hook_env(monkeypatch):
    monkeypatch.setenv("MIRRACLE_WEBHOOK_URL", "http://backend.test/")
    monkeypatch.setenv("AI_INTERVIEW_SHARED_SECRET", "s3cret")
    monkeypatch.setattr(reporting.time, "sleep", lambda s: None)


def test_integrity_events_post_to_the_internal_endpoint_with_the_secret(hook_env, monkeypatch):
    seen = {}

    def post(url, json=None, headers=None, timeout=None):
        seen.update(url=url, json=json, headers=headers)
        return Resp(201)

    monkeypatch.setattr(reporting.httpx, "post", post)
    ev = [{"kind": "no_face", "offset_seconds": 40}]
    assert reporting.submit_integrity_events("ai-room1", ev) is True
    assert seen["url"] == "http://backend.test/internal/ai-interview-integrity"
    assert seen["json"] == {"room_id": "ai-room1", "events": ev}
    assert seen["headers"] == {"Authorization": "Bearer s3cret"}


def test_integrity_events_retry_once_on_server_error_but_not_on_rejection(hook_env, monkeypatch):
    calls = []

    def flaky(*a, **k):
        calls.append(1)
        return Resp(503) if len(calls) == 1 else Resp(201)

    monkeypatch.setattr(reporting.httpx, "post", flaky)
    assert reporting.submit_integrity_events("r", [{"kind": "no_face", "offset_seconds": 1}])
    assert len(calls) == 2

    calls.clear()
    monkeypatch.setattr(reporting.httpx, "post", lambda *a, **k: (calls.append(1), Resp(403, "no consent"))[1])
    assert not reporting.submit_integrity_events("r", [{"kind": "no_face", "offset_seconds": 1}])
    assert len(calls) == 1  # a 403 will not get better by retrying


def test_integrity_events_survive_network_errors(hook_env, monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(reporting.httpx, "post", boom)
    assert reporting.submit_integrity_events("r", [{"kind": "no_face", "offset_seconds": 1}]) is False


def test_integrity_events_need_config_room_and_events(monkeypatch):
    monkeypatch.delenv("MIRRACLE_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("AI_INTERVIEW_SHARED_SECRET", raising=False)
    assert reporting.submit_integrity_events("r", [{"kind": "no_face", "offset_seconds": 1}]) is False
    monkeypatch.setenv("MIRRACLE_WEBHOOK_URL", "http://b")
    monkeypatch.setenv("AI_INTERVIEW_SHARED_SECRET", "s")
    assert reporting.submit_integrity_events("", [{"kind": "no_face", "offset_seconds": 1}]) is False
    assert reporting.submit_integrity_events("r", []) is False


# ─── consent gate on a (fake) room ────────────────────────────────────────────

@pytest.fixture()
def vm():
    import video_monitor

    return video_monitor


def fake_room():
    from livekit import rtc

    published, handlers = [], {}

    async def publish_data(payload, **kw):
        published.append((json.loads(payload), kw))

    track = SimpleNamespace(kind=rtc.TrackKind.KIND_VIDEO)
    pub = SimpleNamespace(set_subscribed=lambda v: pub.calls.append(v), calls=[], track=None)
    candidate = SimpleNamespace(kind=rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD)
    room = SimpleNamespace(
        on=lambda ev, fn: handlers.setdefault(ev, fn),
        remote_participants={},
        local_participant=SimpleNamespace(publish_data=publish_data),
    )
    return room, handlers, published, track, pub, candidate


def test_without_consent_the_candidates_video_is_unsubscribed_and_never_analysed(vm, monkeypatch):
    room, handlers, published, track, pub, candidate = fake_room()
    started = []
    monkeypatch.setattr(vm.LatestFrameSource, "start", lambda self, t: started.append(t))
    handle = vm.start_video_check(room, "ai-room1", video_consent=False)
    handlers["track_subscribed"](track, pub, candidate)
    assert pub.calls == [False]  # explicitly unsubscribed
    assert started == []  # no frames are read
    handle.stop()


def test_with_consent_the_track_is_read_and_a_confirmed_problem_is_flagged_and_reported(vm, monkeypatch):
    room, handlers, published, track, pub, candidate = fake_room()
    sent = []
    monkeypatch.setattr(vm, "CHECK_SECONDS", 0.01)
    monkeypatch.setattr(vm, "submit_integrity_events", lambda rid, ev: sent.append((rid, ev)) or True)
    started = []
    monkeypatch.setattr(vm.LatestFrameSource, "start", lambda self, t: started.append(t))
    monkeypatch.setattr(vm.LatestFrameSource, "jpeg", lambda self: b"jpeg")

    async def run():
        handle = vm.start_video_check(
            room, "ai-room1", True, analyzer=ScriptedAnalyzer(NONE_, NONE_, OK, OK, OK, OK, OK, OK)
        )
        handlers["track_subscribed"](track, pub, candidate)
        await asyncio.sleep(0.15)
        handle.stop()

    asyncio.run(run())
    assert started == [track] and pub.calls == []
    assert sent and sent[0][0] == "ai-room1"
    assert sent[0][1][0]["kind"] == NO_FACE
    states = [p[0]["state"] for p in published]
    assert states[:2] == [FLAGGED, CLEARED]  # candidate is told when it starts and when it clears
    assert all(p[1]["topic"] == "integrity" for p in published)
    assert len(sent) == 1  # only the flag goes to the backend, not the clear


# ─── audio consent ────────────────────────────────────────────────────────────

def test_audio_and_video_consent_are_separate_and_need_an_explicit_true():
    import consent

    assert consent.has_audio_consent({"audio_consent": True})
    assert not consent.has_audio_consent({})
    assert not consent.has_audio_consent({"video_consent": True})  # video consent is not audio consent
    for not_true in (False, None, "true", 1, "yes", []):
        assert not consent.has_audio_consent({"audio_consent": not_true})
        assert not consent.has_video_consent({"video_consent": not_true})
    assert consent.has_video_consent({"video_consent": True})
    assert not consent.has_video_consent({"audio_consent": True})


def test_agent_refuses_to_start_the_voice_pipeline_without_audio_consent():
    """agent.py needs the full voice stack to import, so check its ordering from source:
    the consent guard must come before the pipeline is built or started."""
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "agent.py")).read()
    guard = src.index("if not has_audio_consent(meta):")
    after_guard = src[guard:]
    assert "ctx.shutdown(reason=\"no audio consent\")" in after_guard.split("video_consent =")[0]
    for pipeline_step in ("create_workflow(", "AgentSession(", "session.start(", "start_video_check("):
        assert src.index(pipeline_step, src.index("async def entrypoint")) > guard, pipeline_step
