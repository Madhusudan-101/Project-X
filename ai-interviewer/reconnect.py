# reconnect.py
# A dropped connection should not end an interview. When the candidate's connection drops, the
# interviewer keeps the session open for a short grace period. If the candidate rejoins in time (the
# frontend asks the backend for a fresh token), the interview carries on. If not, the interview is
# closed and graded on what was answered, exactly as before.
#
# This file holds only the timing decision, so it can be tested without a LiveKit room.
from __future__ import annotations

import asyncio
import os
from typing import Callable, Optional


def grace_seconds() -> float:
    """How long to wait for the candidate to come back (RECONNECT_GRACE_SECONDS, default 90)."""
    try:
        return max(0.0, float(os.getenv("RECONNECT_GRACE_SECONDS", "90")))
    except ValueError:
        return 90.0


class ReconnectGuard:
    """Starts a countdown when the candidate leaves, cancels it if they return, and calls `on_expire`
    if they do not. Anyone else joining or leaving (the agent itself, an observer) is ignored."""

    def __init__(self, candidate_identity: Optional[str], grace: float, on_expire: Callable[[], None]) -> None:
        self._identity = candidate_identity
        self._grace = grace
        self._on_expire = on_expire
        self._handle: Optional[asyncio.TimerHandle] = None
        self.expired = False

    @property
    def waiting(self) -> bool:
        return self._handle is not None

    def _is_candidate(self, identity: str) -> bool:
        return self._identity is not None and identity == self._identity

    def on_disconnect(self, identity: str) -> None:
        if not self._is_candidate(identity) or self.expired or self._handle is not None:
            return
        self._handle = asyncio.get_running_loop().call_later(self._grace, self._expire)

    def on_connect(self, identity: str) -> None:
        if self._is_candidate(identity):
            self.cancel()

    def cancel(self) -> None:
        if self._handle is not None:
            self._handle.cancel()
            self._handle = None

    def _expire(self) -> None:
        self._handle = None
        self.expired = True
        self._on_expire()
