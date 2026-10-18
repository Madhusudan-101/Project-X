# consent.py
# What the candidate agreed to, read from the room metadata the Mirracle backend
# stamps when it creates the room. The backend only starts an interview when
# audio and video consent were given, so these flags are normally both true;
# the agent still checks them itself and treats anything but an explicit true as "no".
from __future__ import annotations

from typing import Any, Mapping


def has_audio_consent(meta: Mapping[str, Any]) -> bool:
    """The candidate allowed the interviewer to listen and transcribe their voice."""
    return meta.get("audio_consent") is True


def has_video_consent(meta: Mapping[str, Any]) -> bool:
    """The candidate allowed the interviewer to view their camera."""
    return meta.get("video_consent") is True
