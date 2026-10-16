"""The reconnect grace period: a dropped connection should not end an interview, but a candidate who
never comes back must not keep it open forever. (No LiveKit room needed.)"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import reconnect  # noqa: E402
from reconnect import ReconnectGuard  # noqa: E402

CAND = "stu-1"


def run(coro):
    return asyncio.run(coro)


def test_the_interview_closes_if_the_candidate_never_comes_back():
    async def go():
        closed = []
        g = ReconnectGuard(CAND, 0.05, lambda: closed.append(1))
        g.on_disconnect(CAND)
        assert g.waiting and not closed
        await asyncio.sleep(0.12)
        return closed, g

    closed, g = run(go())
    assert closed == [1] and g.expired and not g.waiting


def test_rejoining_in_time_keeps_the_interview_going():
    async def go():
        closed = []
        g = ReconnectGuard(CAND, 0.08, lambda: closed.append(1))
        g.on_disconnect(CAND)
        await asyncio.sleep(0.02)
        g.on_connect(CAND)
        assert not g.waiting
        await asyncio.sleep(0.15)
        return closed, g

    closed, g = run(go())
    assert closed == [] and not g.expired


def test_it_can_survive_several_drops():
    async def go():
        closed = []
        g = ReconnectGuard(CAND, 0.06, lambda: closed.append(1))
        for _ in range(3):
            g.on_disconnect(CAND)
            await asyncio.sleep(0.01)
            g.on_connect(CAND)
        await asyncio.sleep(0.12)
        return closed

    assert run(go()) == []


def test_only_the_candidate_matters():
    async def go():
        closed = []
        g = ReconnectGuard(CAND, 0.04, lambda: closed.append(1))
        g.on_disconnect("agent-1")          # someone else leaving does not start a countdown
        assert not g.waiting
        g.on_disconnect(CAND)
        g.on_connect("agent-1")             # someone else joining does not cancel it
        assert g.waiting
        await asyncio.sleep(0.1)
        return closed

    assert run(go()) == [1]


def test_a_second_drop_does_not_restart_the_clock():
    async def go():
        closed = []
        g = ReconnectGuard(CAND, 0.1, lambda: closed.append(1))
        g.on_disconnect(CAND)
        await asyncio.sleep(0.06)
        g.on_disconnect(CAND)               # a duplicate event must not give them extra time
        await asyncio.sleep(0.07)
        return closed

    assert run(go()) == [1]


def test_cancel_stops_the_countdown_and_nothing_happens_after_expiry():
    async def go():
        closed = []
        g = ReconnectGuard(CAND, 0.04, lambda: closed.append(1))
        g.on_disconnect(CAND)
        g.cancel()
        await asyncio.sleep(0.09)
        assert closed == []
        g2 = ReconnectGuard(CAND, 0.02, lambda: closed.append(2))
        g2.on_disconnect(CAND)
        await asyncio.sleep(0.06)
        g2.on_disconnect(CAND)              # after it has expired, nothing more is scheduled
        g2.on_connect(CAND)
        await asyncio.sleep(0.05)
        return closed

    assert run(go()) == [2]


def test_an_unknown_candidate_never_triggers_anything():
    async def go():
        closed = []
        g = ReconnectGuard(None, 0.01, lambda: closed.append(1))
        g.on_disconnect("anyone")
        await asyncio.sleep(0.05)
        return closed

    assert run(go()) == []


@pytest.mark.parametrize("value, expected", [(None, 90.0), ("30", 30.0), ("0", 0.0), ("-5", 0.0), ("soon", 90.0)])
def test_grace_comes_from_the_environment(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv("RECONNECT_GRACE_SECONDS", raising=False)
    else:
        monkeypatch.setenv("RECONNECT_GRACE_SECONDS", value)
    assert reconnect.grace_seconds() == expected
