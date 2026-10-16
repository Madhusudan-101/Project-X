# video_monitor.py
# LiveKit glue for the interviewer's video check. The decisions live in
# video_checks.py; this file only wires them to a room.
#
# Consent: the backend stamps `video_consent` into the room metadata only when
# the candidate explicitly allowed video analysis. Without it this worker
# unsubscribes from the candidate's video track and never looks at a frame.
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, Optional

from reporting import submit_integrity_events
from video_checks import (
    FLAGGED,
    FrameAnalyzer,
    GeminiFrameAnalyzer,
    VideoMonitor,
    ViolationTracker,
)

CHECK_SECONDS = float(os.getenv("VIDEO_CHECK_SECONDS", "15"))
CONFIRM_CHECKS = int(os.getenv("VIDEO_CONFIRM_CHECKS", "2"))
# Small, compressed frames: enough to count faces, cheap to send.
FRAME_WIDTH, FRAME_HEIGHT, JPEG_QUALITY = 512, 288, 70


class LatestFrameSource:
    """Keeps only the newest frame of one video track; older frames are dropped."""

    def __init__(self) -> None:
        self._frame: Any = None
        self._task: Optional[asyncio.Task] = None

    def start(self, track: Any) -> None:
        from livekit import rtc

        self.stop()
        self._task = asyncio.create_task(self._pump(rtc.VideoStream(track)))

    async def _pump(self, stream: Any) -> None:
        async for event in stream:
            self._frame = event.frame

    def jpeg(self) -> Optional[bytes]:
        frame = self._frame
        if frame is None:
            return None
        from livekit.agents.utils.images import EncodeOptions, ResizeOptions, encode

        return encode(
            frame,
            EncodeOptions(
                format="JPEG",
                quality=JPEG_QUALITY,
                resize_options=ResizeOptions(
                    width=FRAME_WIDTH, height=FRAME_HEIGHT, strategy="scale_aspect_fit"
                ),
            ),
        )

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
        self._frame = None


class VideoCheckHandle:
    def __init__(self, source: LatestFrameSource, task: Optional[asyncio.Task]) -> None:
        self._source, self._task = source, task

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
        self._source.stop()


def _default_analyzer() -> FrameAnalyzer:
    from langchain_google_genai import ChatGoogleGenerativeAI

    model = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
    return GeminiFrameAnalyzer(ChatGoogleGenerativeAI(model=model, temperature=0, max_retries=1))


def start_video_check(
    room: Any,
    room_name: str,
    video_consent: bool,
    analyzer: Optional[FrameAnalyzer] = None,
) -> VideoCheckHandle:
    """Attach to the room. Returns a handle; call stop() on shutdown.

    With `video_consent` False this only makes sure the candidate's video is not
    subscribed, and no analysis runs.
    """
    from livekit import rtc

    source = LatestFrameSource()

    def is_candidate_video(track: Any, participant: Any) -> bool:
        return (
            track.kind == rtc.TrackKind.KIND_VIDEO
            and participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD
        )

    def on_track(track: Any, publication: Any, participant: Any) -> None:
        if not is_candidate_video(track, participant):
            return
        if not video_consent:
            publication.set_subscribed(False)
            return
        source.start(track)

    room.on("track_subscribed", on_track)
    # Tracks that were subscribed before we attached.
    for p in room.remote_participants.values():
        for pub in p.track_publications.values():
            if pub.track is not None and is_candidate_video(pub.track, p):
                on_track(pub.track, pub, p)

    if not video_consent:
        print("Candidate did not consent to video analysis: video is not used")
        return VideoCheckHandle(source, None)

    analyzer = analyzer or _default_analyzer()

    async def emit(state: str, kind: str, offset: int) -> None:
        # Tell the candidate right away, so supervision is visible, not silent.
        try:
            await room.local_participant.publish_data(
                json.dumps({"kind": kind, "state": state}),
                reliable=True,
                topic="integrity",
            )
        except Exception as exc:  # noqa: BLE001
            print(f"Could not notify candidate: {exc}")
        if state == FLAGGED:
            await asyncio.to_thread(
                submit_integrity_events, room_name, [{"kind": kind, "offset_seconds": offset}]
            )

    monitor = VideoMonitor(
        get_frame=source.jpeg,
        analyzer=analyzer,
        tracker=ViolationTracker(confirm=CONFIRM_CHECKS),
        emit=emit,
        clock=time.monotonic,
    )

    async def loop() -> None:
        while True:
            await asyncio.sleep(CHECK_SECONDS)
            try:
                await monitor.check_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - never let the check break the interview
                print(f"Video check error: {exc}")

    return VideoCheckHandle(source, asyncio.create_task(loop()))
