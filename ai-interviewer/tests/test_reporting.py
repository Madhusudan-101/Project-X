"""Unit tests for the report-delivery client (no network: httpx.post is faked).

Run from ai-interviewer/:  python -m pytest tests
"""
import os
import sys

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import reporting  # noqa: E402
from domains import DOMAIN_LABELS  # noqa: E402


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("MIRRACLE_WEBHOOK_URL", "http://backend.test/")
    monkeypatch.setenv("AI_INTERVIEW_SHARED_SECRET", "s3cret")
    monkeypatch.setattr(reporting.time, "sleep", lambda s: None)


class Resp:
    def __init__(self, code, text=""): self.status_code, self.text = code, text


def test_success_posts_to_internal_endpoint_with_bearer_secret(monkeypatch):
    seen = {}

    def fake_post(url, json, headers, timeout):
        seen.update(url=url, json=json, headers=headers, timeout=timeout)
        return Resp(200)

    monkeypatch.setattr(reporting.httpx, "post", fake_post)
    assert reporting.submit_report({"room_id": "r1", "score": 7}) is True
    assert seen["url"] == "http://backend.test/internal/ai-interview-reports"      # trailing slash normalised
    assert seen["headers"] == {"Authorization": "Bearer s3cret"}
    assert seen["json"] == {"room_id": "r1", "score": 7}


@pytest.mark.parametrize("missing", ["MIRRACLE_WEBHOOK_URL", "AI_INTERVIEW_SHARED_SECRET"])
def test_missing_configuration_does_not_call_the_network(monkeypatch, missing):
    monkeypatch.delenv(missing)
    monkeypatch.setattr(reporting.httpx, "post", lambda *a, **k: pytest.fail("must not post"))
    assert reporting.submit_report({"room_id": "r1"}) is False


def test_missing_room_id_is_refused(monkeypatch):
    monkeypatch.setattr(reporting.httpx, "post", lambda *a, **k: pytest.fail("must not post"))
    assert reporting.submit_report({}) is False
    assert reporting.submit_report({"room_id": ""}) is False


def test_retries_5xx_then_succeeds(monkeypatch):
    codes = iter([503, 500, 200])
    calls = []
    monkeypatch.setattr(reporting.httpx, "post", lambda *a, **k: (calls.append(1), Resp(next(codes)))[1])
    assert reporting.submit_report({"room_id": "r1"}) is True
    assert len(calls) == 3


def test_retries_429_and_network_errors(monkeypatch):
    seq = iter([Resp(429), httpx.ConnectError("down"), Resp(204)])

    def fake_post(*a, **k):
        v = next(seq)
        if isinstance(v, Exception):
            raise v
        return v

    monkeypatch.setattr(reporting.httpx, "post", fake_post)
    assert reporting.submit_report({"room_id": "r1"}) is True


@pytest.mark.parametrize("code", [400, 401, 403, 404, 422])
def test_client_errors_are_not_retried(monkeypatch, code):
    calls = []
    monkeypatch.setattr(reporting.httpx, "post", lambda *a, **k: (calls.append(1), Resp(code, "nope"))[1])
    assert reporting.submit_report({"room_id": "r1"}) is False
    assert len(calls) == 1


def test_gives_up_after_max_attempts(monkeypatch):
    calls = []
    monkeypatch.setattr(reporting.httpx, "post", lambda *a, **k: (calls.append(1), Resp(500))[1])
    assert reporting.submit_report({"room_id": "r1"}) is False
    assert len(calls) == reporting.MAX_ATTEMPTS


def test_backoff_doubles_between_attempts(monkeypatch):
    sleeps = []
    monkeypatch.setattr(reporting.time, "sleep", lambda s: sleeps.append(s))
    monkeypatch.setattr(reporting.httpx, "post", lambda *a, **k: Resp(500))
    reporting.submit_report({"room_id": "r1"})
    assert sleeps == [2, 4, 8]                 # no sleep after the final attempt


def test_domain_labels_match_the_backend_contract():
    assert set(DOMAIN_LABELS) == {"ai_ml", "web_dev", "dsa"}
