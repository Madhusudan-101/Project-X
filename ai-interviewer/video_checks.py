# video_checks.py
# Decision logic for the interviewer's video check. No LiveKit or model imports,
# so it can be unit tested on its own.
#
# What the check looks at is deliberately narrow and objective: how many faces
# are in frame, and whether the camera looks blocked. It never judges gaze,
# emotion, attention or appearance, and nothing from the video is stored.
from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional, Protocol

# Must match VIDEO_KINDS in backend/app/routers/candidate/ai_interview.py and
# the CHECK constraint in backend/db/ai_interview_integrity_migration.sql.
NO_FACE = "no_face"
MULTIPLE_FACES = "multiple_faces"
CAMERA_BLOCKED = "camera_blocked"

FLAGGED = "flagged"
CLEARED = "cleared"

FRAME_PROMPT = (
    "This is a single frame from a candidate's webcam during an online interview. "
    "Report only two things. face_count: how many distinct human faces are clearly "
    "visible (0 if none). camera_blocked: true if the image is black, covered, or too "
    "dark or obscured to show a scene. Do not identify anyone, and do not describe "
    "emotion, gaze, attention, clothing or appearance."
)


@dataclass(frozen=True)
class FrameVerdict:
    face_count: int
    camera_blocked: bool


def parse_verdict(raw: Any) -> Optional[FrameVerdict]:
    """Turn a model result (dict or object) into a verdict, or None if it is unusable."""
    try:
        get = raw.get if isinstance(raw, dict) else lambda k: getattr(raw, k)
        count = int(get("face_count"))
        blocked = bool(get("camera_blocked"))
    except (AttributeError, KeyError, TypeError, ValueError):
        return None
    return FrameVerdict(face_count=max(0, count), camera_blocked=blocked)


def violation_of(v: FrameVerdict) -> Optional[str]:
    if v.camera_blocked:
        return CAMERA_BLOCKED
    if v.face_count == 0:
        return NO_FACE
    if v.face_count >= 2:
        return MULTIPLE_FACES
    return None


class ViolationTracker:
    """Turns noisy per-frame verdicts into stable flagged / cleared transitions.

    A violation must be seen on `confirm` consecutive checks before it is flagged,
    so one blurry frame or a quick glance away does not count. It is reported once
    per episode and cleared as soon as a normal frame is seen. A frame the model
    could not analyse (None) changes nothing.
    """

    def __init__(self, confirm: int = 2) -> None:
        self.confirm = max(1, confirm)
        self.active: Optional[str] = None
        self._candidate: Optional[str] = None
        self._streak = 0

    def observe(self, verdict: Optional[FrameVerdict]) -> list[tuple[str, str]]:
        if verdict is None:
            return []
        kind = violation_of(verdict)
        out: list[tuple[str, str]] = []
        if kind is None:
            self._candidate, self._streak = None, 0
            if self.active:
                out.append((CLEARED, self.active))
                self.active = None
            return out

        if kind == self._candidate:
            self._streak += 1
        else:
            self._candidate, self._streak = kind, 1
        if self._streak >= self.confirm and kind != self.active:
            if self.active:
                out.append((CLEARED, self.active))
            out.append((FLAGGED, kind))
            self.active = kind
        return out


class FrameAnalyzer(Protocol):
    async def analyze(self, jpeg: bytes) -> Optional[FrameVerdict]: ...


class GeminiFrameAnalyzer:
    """Asks a vision-capable chat model (same Gemini family the interview uses) about one frame."""

    def __init__(self, llm: Any) -> None:
        from pydantic import BaseModel, Field

        class _Schema(BaseModel):
            face_count: int = Field(ge=0, le=20)
            camera_blocked: bool

        self._chain = llm.with_structured_output(_Schema)

    async def analyze(self, jpeg: bytes) -> Optional[FrameVerdict]:
        from langchain_core.messages import HumanMessage

        b64 = base64.b64encode(jpeg).decode("ascii")
        msg = HumanMessage(
            content=[
                {"type": "text", "text": FRAME_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            ]
        )
        try:
            return parse_verdict(await self._chain.ainvoke([msg]))
        except Exception as exc:  # noqa: BLE001 - one failed check must never end the interview
            print(f"Video frame analysis failed: {exc}")
            return None


# emit(state, kind, offset_seconds): called on every flagged / cleared transition.
Emit = Callable[[str, str, int], Awaitable[None]]


class VideoMonitor:
    """Every `interval` seconds, grabs the latest frame, asks the analyzer, and emits transitions."""

    def __init__(
        self,
        *,
        get_frame: Callable[[], Optional[bytes]],
        analyzer: FrameAnalyzer,
        tracker: ViolationTracker,
        emit: Emit,
        clock: Callable[[], float],
    ) -> None:
        self._get_frame = get_frame
        self._analyzer = analyzer
        self._tracker = tracker
        self._emit = emit
        self._clock = clock
        self._t0 = clock()

    async def check_once(self) -> None:
        jpeg = self._get_frame()
        if not jpeg:
            return  # no video yet (or the browser reports the camera loss itself)
        verdict = await self._analyzer.analyze(jpeg)
        offset = max(0, int(self._clock() - self._t0))
        for state, kind in self._tracker.observe(verdict):
            await self._emit(state, kind, offset)
