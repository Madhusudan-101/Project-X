"""PeerMeet safety rules: blocks, suspensions, who-was-my-partner, and automatic suspension.

Kept separate from the HTTP routers so the same rules are enforced everywhere a person can enter the
peer feature (matching, scheduling, joining, getting a room token) and are unit-testable.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Set

from fastapi import HTTPException
from postgrest.exceptions import APIError

from ..deps import db_client

logger = logging.getLogger(__name__)

REPORT_REASONS = (
    "harassment",
    "inappropriate_content",
    "impersonation",
    "cheating_or_sharing_questions",
    "spam",
    "no_show",
    "other",
)
ANON_NAME = "Anonymous Candidate"

# Automatic rule: this many DIFFERENT people reporting the same person within the window suspends
# them from the peer feature until an admin reviews it.
AUTO_SUSPEND_REPORTERS = 3
AUTO_SUSPEND_WINDOW = timedelta(days=30)
AUTO_SUSPEND_DAYS = 7


def now() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ── blocks ───────────────────────────────────────────────────────────────────

def blocked_with(user_id: str) -> Set[str]:
    """Everyone this person has blocked or been blocked by. A block works in both directions, and the
    blocked person is never told: they simply stop being matched or shown to each other."""
    out: Set[str] = set()
    try:
        mine = db_client.table("peer_blocks").select("blocked_id").eq("blocker_id", user_id).execute().data or []
        theirs = db_client.table("peer_blocks").select("blocker_id").eq("blocked_id", user_id).execute().data or []
    except APIError:
        logger.exception("block lookup failed")
        return out
    out.update(r["blocked_id"] for r in mine)
    out.update(r["blocker_id"] for r in theirs)
    return out


# ── suspensions ──────────────────────────────────────────────────────────────

def active_suspension(user_id: str) -> Optional[dict]:
    try:
        rows = (
            db_client.table("peer_sanctions").select("*")
            .eq("student_id", user_id).eq("kind", "suspension").execute().data or []
        )
    except APIError:
        logger.exception("sanction lookup failed")
        return None
    for r in rows:
        if r.get("lifted_at"):
            continue
        ends = parse_ts(r.get("ends_at"))
        if ends is None or ends > now():
            return r
    return None


def require_not_suspended(user_id: str) -> None:
    s = active_suspension(user_id)
    if not s:
        return
    ends = parse_ts(s.get("ends_at"))
    until = f" until {ends.strftime('%d %b %Y')}" if ends else ""
    raise HTTPException(
        status_code=403,
        detail=f"Peer interviews are paused on your account{until} while a report is reviewed. "
               "You can still use the rest of Mirracle.",
    )


# ── who was my partner ───────────────────────────────────────────────────────

def _name_of(user_id: str) -> str:
    try:
        row = db_client.table("profiles").select("name, first_name, last_name").eq("id", user_id).maybe_single().execute()
        d = getattr(row, "data", None) or {}
    except APIError:
        return "Peer"
    name = d.get("name") or " ".join(x for x in (d.get("first_name"), d.get("last_name")) if x).strip()
    return name if name and "@" not in name else "Peer"


def partner_in_room(user_id: str, room_id: str) -> Optional[Dict[str, Any]]:
    """The other person in a room this user was in, or None. Returns {id, label} where label is the real
    name only if that person was not anonymous. Used so a report/block names a ROOM, never a person."""
    try:
        t = (
            db_client.table("peer_matchmaking_tickets")
            .select("matched_with, status").eq("student_id", user_id).eq("room_id", room_id)
            .in_("status", ["matched", "completed", "expired"]).maybe_single().execute()
        )
        ticket = getattr(t, "data", None)
        if ticket and ticket.get("matched_with"):
            pid = ticket["matched_with"]
            other = db_client.table("peer_matchmaking_tickets").select("keep_private").eq("room_id", room_id).eq("student_id", pid).maybe_single().execute()
            private = True if not getattr(other, "data", None) else bool(other.data.get("keep_private", True))
            return {"id": pid, "label": ANON_NAME if private else _name_of(pid)}
        m = db_client.table("peer_scheduled_meetings").select("*").eq("room_id", room_id).maybe_single().execute()
        meeting = getattr(m, "data", None)
    except APIError:
        logger.exception("partner lookup failed")
        return None
    if not meeting:
        return None
    creator = meeting["creator_id"]
    other = meeting.get("invitee_id") or meeting.get("second_joiner_id")
    if user_id == creator:
        pid, private = other, True  # the guest's privacy choice is not stored: treat as anonymous
    elif user_id in (meeting.get("invitee_id"), meeting.get("second_joiner_id")):
        pid, private = creator, bool(meeting.get("keep_private", False))
    else:
        return None
    if not pid or pid == user_id:
        return None
    return {"id": pid, "label": ANON_NAME if private else _name_of(pid)}


# ── reports ──────────────────────────────────────────────────────────────────

def add_block(blocker_id: str, blocked_id: str, label: str, room_id: Optional[str]) -> None:
    if blocker_id == blocked_id:
        return
    existing = (
        db_client.table("peer_blocks").select("id").eq("blocker_id", blocker_id).eq("blocked_id", blocked_id)
        .execute().data or []
    )
    if existing:
        return
    db_client.table("peer_blocks").insert({
        "blocker_id": blocker_id, "blocked_id": blocked_id, "label": label, "room_id": room_id,
    }).execute()


def file_report(
    *, reporter_id: str, room_id: str, reason: str, details: str = "", block: bool = False,
    evidence: Optional[dict] = None, source: str = "dashboard",
) -> Dict[str, Any]:
    """Create a report about the other person in `room_id`. Idempotent per (reporter, reported, room)."""
    if reason not in REPORT_REASONS:
        raise HTTPException(status_code=422, detail="Choose a reason from the list.")
    partner = partner_in_room(reporter_id, room_id)
    if not partner:
        raise HTTPException(status_code=422, detail="You can only report someone from a meeting you were in.")
    reported_id = partner["id"]

    found = (
        db_client.table("peer_user_reports").select("*")
        .eq("reporter_id", reporter_id).eq("reported_id", reported_id).eq("room_id", room_id).execute().data or []
    )
    if found:
        row = found[0]
        created = False
    else:
        row = db_client.table("peer_user_reports").insert({
            "reporter_id": reporter_id, "reported_id": reported_id, "room_id": room_id, "reason": reason,
            "details": (details or "").strip()[:1000] or None, "evidence": evidence, "source": source,
        }).execute().data[0]
        created = True
        maybe_auto_suspend(reported_id, row["id"])

    if block:
        add_block(reporter_id, reported_id, partner["label"], room_id)
    return {"id": row["id"], "status": row["status"], "created": created, "blocked": bool(block)}


def maybe_auto_suspend(reported_id: str, report_id: Optional[str]) -> bool:
    """Suspend someone reported by several different people recently, pending an admin's review."""
    since = now() - AUTO_SUSPEND_WINDOW
    rows = db_client.table("peer_user_reports").select("reporter_id, status, created_at").eq("reported_id", reported_id).execute().data or []
    recent = {
        r["reporter_id"] for r in rows
        if r.get("status") != "dismissed" and (parse_ts(r.get("created_at")) or now()) >= since
    }
    if len(recent) < AUTO_SUSPEND_REPORTERS or active_suspension(reported_id):
        return False
    db_client.table("peer_sanctions").insert({
        "student_id": reported_id, "kind": "suspension",
        "reason": f"Automatic: reported by {len(recent)} different people in 30 days",
        "ends_at": (now() + timedelta(days=AUTO_SUSPEND_DAYS)).isoformat(),
        "report_id": report_id, "created_by": None,
    }).execute()
    return True
