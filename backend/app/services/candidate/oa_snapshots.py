"""Storage for webcam snapshots taken during an Online Assessment.

Photos go to a PRIVATE Supabase Storage bucket and are only handed out as short-lived
signed URLs to the company that owns the assessment. Mirrors services/candidate/resume_pdf.py.
"""

from __future__ import annotations

import base64
import binascii
import logging
import os
from typing import List, Optional

from ...deps import db_client

log = logging.getLogger(__name__)

BUCKET = "oa-proctoring"
MAX_BYTES = 150_000          # a 320x240 JPEG at q~0.6 is ~10-25 KB
MAX_PER_ATTEMPT = 400
MIN_SECONDS_BETWEEN = 8      # server-side floor, whatever the client's timer says
DEFAULT_INTERVAL_SECONDS = 60
SIGNED_URL_SECONDS = 600


class BadSnapshot(ValueError):
    """The upload isn't an acceptable JPEG."""


def interval_seconds() -> int:
    try:
        return max(15, int(os.getenv("OA_SNAPSHOT_INTERVAL_SECONDS") or DEFAULT_INTERVAL_SECONDS))
    except ValueError:
        return DEFAULT_INTERVAL_SECONDS


def retention_days() -> int:
    try:
        return max(1, int(os.getenv("OA_SNAPSHOT_RETENTION_DAYS") or 30))
    except ValueError:
        return 30


def decode_jpeg(image: str) -> bytes:
    """Accepts a data URL or bare base64; returns JPEG bytes or raises BadSnapshot."""
    if image.startswith("data:"):
        head, _, image = image.partition(",")
        if "image/jpeg" not in head:
            raise BadSnapshot("Snapshots must be JPEG images.")
    if len(image) > MAX_BYTES * 4 // 3 + 16:
        raise BadSnapshot("Snapshot is too large.")
    try:
        data = base64.b64decode(image, validate=True)
    except (binascii.Error, ValueError):
        raise BadSnapshot("Snapshot isn't valid base64.")
    if len(data) > MAX_BYTES:
        raise BadSnapshot("Snapshot is too large.")
    if not (data[:3] == b"\xff\xd8\xff" and data[-2:] == b"\xff\xd9"):
        raise BadSnapshot("Snapshots must be JPEG images.")
    return data


def _ensure_bucket() -> None:
    try:
        db_client.storage.get_bucket(BUCKET)
    except Exception:  # noqa: BLE001 — not found / not permitted
        try:
            db_client.storage.create_bucket(BUCKET, options={"public": False})
        except Exception as exc:  # noqa: BLE001 — already exists / race
            log.info("Bucket %s create skipped: %s", BUCKET, exc)


def upload(path: str, data: bytes) -> None:
    _ensure_bucket()
    db_client.storage.from_(BUCKET).upload(path, data, {"content-type": "image/jpeg", "upsert": "false"})


def signed_urls(paths: List[str]) -> dict:
    """{path: url} for the paths that could be signed."""
    if not paths:
        return {}
    out = {}
    bucket = db_client.storage.from_(BUCKET)
    try:
        for item in bucket.create_signed_urls(paths, SIGNED_URL_SECONDS) or []:
            url = item.get("signedURL") or item.get("signedUrl")
            if url and item.get("path"):
                out[item["path"]] = url
    except Exception as exc:  # noqa: BLE001
        log.warning("Signing %d snapshot URLs failed: %s", len(paths), exc)
    return out


def delete(paths: List[str]) -> Optional[str]:
    """Remove objects; returns an error string, or None."""
    if not paths:
        return None
    try:
        db_client.storage.from_(BUCKET).remove(paths)
        return None
    except Exception as exc:  # noqa: BLE001
        return str(exc)
