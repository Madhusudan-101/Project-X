"""PeerMeet pre-call rules: per-session consent, no-show records, and the interviewer onboarding flag.

The meeting server (a separate process with no database) calls these through signed internal
endpoints. Everything that decides something lives here so it is enforced and testable in one place.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from postgrest.exceptions import APIError

from ..deps import db_client

logger = logging.getLogger(__name__)

# The wording people answer Yes or No to. Bump the version when the wording changes: a Yes recorded
# against an older version does not count.
SESSION_CONSENT_VERSION = "2026-10-session-v1"
SESSION_CONSENT_TEXT = (
    "This session may be recorded and reviewed by AI for scoring and safety purposes. Continue?"
)

# How long after the scheduled start a waiting person may mark "partner did not show".
# The scheduler's automatic no-show uses the same window.
NO_SHOW_GRACE = timedelta(minutes=10)


def now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ── who the partner is (shown on the Ready screen) ───────────────────────────

def card_fields(user_id: str) -> Dict[str, Optional[str]]:
    """First name and college/branch only. No surname, email, phone or links."""
    try:
        p = db_client.table("profiles").select("name, first_name, branch, college_id").eq("id", user_id).maybe_single().execute()
        d = getattr(p, "data", None) or {}
    except APIError:
        return {"first_name": None, "college_branch": None}
    first = (d.get("first_name") or (d.get("name") or "").split(" ")[0] or "").strip()
    if "@" in first:
        first = ""
    college = None
    if d.get("college_id"):
        try:
            c = db_client.table("colleges").select("name").eq("id", d["college_id"]).maybe_single().execute()
            college = (getattr(c, "data", None) or {}).get("name")
        except APIError:
            college = None
    parts = [x for x in (college, d.get("branch")) if x]
    return {"first_name": first[:40] or None, "college_branch": (", ".join(parts))[:120] or None}


# ── per-session consent ──────────────────────────────────────────────────────

def record_session_consent(student_id: str, room_id: str, answer: bool, version: str) -> Dict[str, Any]:
    if version != SESSION_CONSENT_VERSION:
        raise HTTPException(status_code=409, detail="The consent wording was updated. Please read it again.")
    from ..routers.candidate.peer import _may_enter_room  # same rule as the room token: you must belong there
    if not _may_enter_room(student_id, room_id):
        raise HTTPException(status_code=403, detail="That person is not part of this session.")
    db_client.table("peer_session_consents").upsert({
        "student_id": student_id, "room_id": room_id, "answer": bool(answer),
        "consent_version": version, "answered_at": now().isoformat(),
    }, on_conflict="student_id,room_id").execute()
    return {"ok": True, "answer": bool(answer)}


def everyone_said_yes(room_id: str, student_ids: List[str]) -> Dict[str, Any]:
    """True only when every listed person has a stored Yes, for the current wording, for this session."""
    ids = list(dict.fromkeys(student_ids))
    if len(ids) != 2:
        return {"all_yes": False, "missing": ids}
    try:
        rows = db_client.table("peer_session_consents").select("student_id, answer, consent_version").eq("room_id", room_id).execute().data or []
    except APIError:
        logger.exception("consent lookup failed")
        return {"all_yes": False, "missing": ids}
    yes = {r["student_id"] for r in rows if r.get("answer") is True and r.get("consent_version") == SESSION_CONSENT_VERSION}
    missing = [i for i in ids if i not in yes]
    return {"all_yes": not missing, "missing": missing}


# ── per-person flags ─────────────────────────────────────────────────────────

def _flags(student_id: str) -> dict:
    try:
        res = db_client.table("peer_user_flags").select("*").eq("student_id", student_id).maybe_single().execute()
    except APIError:
        return {}
    return getattr(res, "data", None) or {}


def onboarding_seen(student_id: str) -> bool:
    return bool(_flags(student_id).get("interviewer_onboarding_seen_at"))


def mark_onboarding_seen(student_id: str) -> None:
    existing = _flags(student_id)
    if existing.get("interviewer_onboarding_seen_at"):
        return  # keep the first time they saw it
    db_client.table("peer_user_flags").upsert({
        "student_id": student_id,
        "interviewer_onboarding_seen_at": now().isoformat(),
        "no_show_count": existing.get("no_show_count", 0),
        "updated_at": now().isoformat(),
    }, on_conflict="student_id").execute()


def _bump_no_show(student_id: str) -> None:
    existing = _flags(student_id)
    db_client.table("peer_user_flags").upsert({
        "student_id": student_id,
        "no_show_count": int(existing.get("no_show_count", 0)) + 1,
        "interviewer_onboarding_seen_at": existing.get("interviewer_onboarding_seen_at"),
        "updated_at": now().isoformat(),
    }, on_conflict="student_id").execute()


# ── no-show ──────────────────────────────────────────────────────────────────

def absent_person(meeting: dict, waiting_id: str) -> Optional[str]:
    """Who did not show: the other named person. An open meeting has no named partner, so nobody."""
    others = [x for x in (meeting.get("creator_id"), meeting.get("invitee_id")) if x and x != waiting_id]
    return others[0] if others else None


def record_no_show(meeting: dict) -> bool:
    """Flip a waiting meeting to no_show, note who was absent and count it. Returns False when somebody
    else already did (so the count is never added twice). No score and no feedback report is made."""
    waiting_id = meeting.get("first_joiner_id")
    absent = absent_person(meeting, waiting_id) if waiting_id else None
    res = (
        db_client.table("peer_scheduled_meetings")
        .update({"status": "no_show", "no_show_at": now().isoformat(), "absent_id": absent})
        .eq("id", meeting["id"]).eq("status", "waiting").execute()
    )
    if not (res.data or []):
        return False
    if absent:
        _bump_no_show(absent)
    return True


def mark_partner_no_show(room_id: str, reporter_id: str) -> Dict[str, Any]:
    """The person who has been waiting says their partner did not show."""
    try:
        res = db_client.table("peer_scheduled_meetings").select("*").eq("room_id", room_id).maybe_single().execute()
    except APIError:
        raise HTTPException(status_code=500, detail="Lookup failed")
    m = getattr(res, "data", None)
    if not m:
        raise HTTPException(status_code=404, detail="This is not a scheduled meeting.")
    if m["status"] == "no_show":
        return {"ok": True, "already": True}
    if m.get("first_joiner_id") != reporter_id:
        raise HTTPException(status_code=403, detail="Only the person who has been waiting can do this.")
    if m["status"] != "waiting":
        raise HTTPException(status_code=409, detail="Your partner has already joined, or the meeting is over.")
    start = _parse(m["scheduled_at"])
    allowed_at = start + NO_SHOW_GRACE
    if now() < allowed_at:
        wait = int((allowed_at - now()).total_seconds())
        raise HTTPException(status_code=409, detail=f"Please wait {max(1, -(-wait // 60))} more minute(s) before marking this.")
    record_no_show(m)
    return {"ok": True, "already": False}
