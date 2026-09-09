"""
Peer Interview Router — /candidate/peer-*
──────────────────────────────────────────────────────────────────────────────
Three feature slices, all authenticated by the candidate JWT:

  POST /candidate/peer-session-token
      Mint the short-lived HS256 JWT PeerMeet verifies to attach identity.

  Matchmaking (real, server-authoritative pairing):
      POST   /candidate/peer-matchmaking/request   — poll-style; enters queue
                                                     OR returns a match when
                                                     one is available.
      POST   /candidate/peer-matchmaking/cancel    — leave the queue.

  Scheduling:
      GET    /candidate/peer-meetings              — list upcoming for me.
      POST   /candidate/peer-meetings              — create scheduled meeting.
      DELETE /candidate/peer-meetings/{id}         — cancel my scheduled meeting.
      POST   /candidate/peer-meetings/{id}/join    — validate + return join info.

The dashboard NEVER generates room IDs client-side any more — every room ID
that reaches PeerMeet was issued by this server, so two students who both
click "Peer Interview" are guaranteed to end up in the same room via
`claim_peer_matchmaking_ticket()` (see the SQL migration).
"""

from __future__ import annotations

import os
import time
import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field, field_validator

from ...deps import get_current_user, db_client
from postgrest.exceptions import APIError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/candidate", tags=["peer-interview"])

PEERMEET_SHARED_SECRET = os.getenv("PEERMEET_SHARED_SECRET")
PEERMEET_TOKEN_TTL_SECONDS = 10 * 60  # 10 minutes


# ─── Shared helpers ───────────────────────────────────────────────────────────

def _generate_room_id() -> str:
    """Same short readable UUID shape PeerMeet's Home.jsx used before."""
    return uuid.uuid4().hex[:12]


def _resolve_display_name(user_id: str, fallback_email: Optional[str]) -> str:
    try:
        res = (
            db_client.table("profiles")
            .select("name, first_name, last_name, email")
            .eq("id", user_id)
            .single()
            .execute()
        )
        row = res.data or {}
        name = row.get("name") or (
            " ".join(filter(None, [row.get("first_name"), row.get("last_name")])).strip()
            or row.get("email")
        )
        if name:
            return name
    except APIError:
        pass
    return fallback_email or "Peer"


def _resolve_display_names(user_ids: list[str]) -> dict[str, str]:
    """Batch equivalent of _resolve_display_name for many ids at once.

    Fixes the N+1 profile-fetch pattern in the public-list endpoint: one query
    per row was previously issued to fetch the host's display name. Returns a
    {user_id: display_name} map that falls back to "Peer" for any id the
    profiles table doesn't know about (or that errors during read).
    """
    unique_ids = list({uid for uid in user_ids if uid})
    if not unique_ids:
        return {}
    try:
        res = (
            db_client.table("profiles")
            .select("id, name, first_name, last_name, email")
            .in_("id", unique_ids)
            .execute()
        )
    except APIError:
        logger.exception("batch profile lookup failed")
        return {uid: "Peer" for uid in unique_ids}

    out: dict[str, str] = {}
    for row in res.data or []:
        name = row.get("name") or (
            " ".join(filter(None, [row.get("first_name"), row.get("last_name")])).strip()
            or row.get("email")
        )
        out[row["id"]] = name or "Peer"
    for uid in unique_ids:
        out.setdefault(uid, "Peer")
    return out


def _mint_token_for(user_id: str, name: str) -> str:
    """Sign the identity blob PeerMeet's signaling server verifies offline."""
    if not PEERMEET_SHARED_SECRET:
        raise HTTPException(status_code=503, detail="PeerMeet integration is not configured")
    now = int(time.time())
    payload = {
        "student_id": user_id,
        "name": name or "Peer",
        "iat": now,
        "exp": now + PEERMEET_TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, PEERMEET_SHARED_SECRET, algorithm="HS256")


# ─── Token handoff (existing) ─────────────────────────────────────────────────

@router.post("/peer-session-token")
def mint_peer_session_token(current_user: dict = Depends(get_current_user)) -> dict:
    """Return a short-lived signed token PeerMeet can verify offline."""
    name = _resolve_display_name(current_user["id"], current_user.get("email"))
    token = _mint_token_for(current_user["id"], name)
    return {"token": token, "expires_in": PEERMEET_TOKEN_TTL_SECONDS}


# ─── Matchmaking ──────────────────────────────────────────────────────────────

class MatchmakingRequest(BaseModel):
    keep_private: bool = False


class MatchmakingStatus(BaseModel):
    status: str  # 'waiting' | 'matched'
    ticket_id: str
    room_id: Optional[str] = None
    token: Optional[str] = None
    partner_name: Optional[str] = None
    keep_private: bool = False
    waiting_since: Optional[str] = None


def _row_to_status(row: dict, current_user_id: str, current_user_email: Optional[str]) -> MatchmakingStatus:
    """Shape a matchmaking row for the caller (whose token we mint on match)."""
    status = row["status"]
    token: Optional[str] = None
    partner_name: Optional[str] = None
    if status == "matched" and row.get("room_id") and row.get("matched_with"):
        # Mint a fresh identity token for the calling user (never for the peer).
        name = _resolve_display_name(current_user_id, current_user_email)
        token = _mint_token_for(current_user_id, name)
        partner_name = _resolve_display_name(row["matched_with"], None)
    return MatchmakingStatus(
        status=status,
        ticket_id=row["id"],
        room_id=row.get("room_id"),
        token=token,
        partner_name=partner_name,
        keep_private=bool(row.get("keep_private", False)),
        waiting_since=row.get("created_at"),
    )


@router.post("/peer-matchmaking/request", response_model=MatchmakingStatus)
def request_matchmaking(
    body: MatchmakingRequest,
    current_user: dict = Depends(get_current_user),
) -> MatchmakingStatus:
    """Idempotent poll-style entry point.

    Behavior:
      1. If the caller already has a matched ticket → return it (with a fresh
         PeerMeet token so a page-refresh still works).
      2. Else, try to claim the oldest waiting ticket that is NOT the caller.
         If claimed → also insert a matched ticket for the caller and return.
      3. Else, insert (or reuse) a waiting ticket for the caller and return.

    The atomic peer-claim uses `SELECT ... FOR UPDATE SKIP LOCKED` via the
    `claim_peer_matchmaking_ticket` RPC to make two simultaneous callers safe.
    """
    user_id = current_user["id"]
    email = current_user.get("email")

    # ── 1. Existing matched ticket → hand back immediately.
    try:
        existing = (
            db_client.table("peer_matchmaking_tickets")
            .select("id, status, room_id, matched_with, keep_private, created_at")
            .eq("student_id", user_id)
            .in_("status", ["waiting", "matched"])
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Queue lookup failed: {e.message}")

    row = (existing.data or [None])[0]

    if row and row["status"] == "matched":
        return _row_to_status(row, user_id, email)

    # ── 2. Try to claim someone else's waiting ticket.
    proposed_room_id = _generate_room_id()
    try:
        rpc = db_client.rpc(
            "claim_peer_matchmaking_ticket",
            {"p_student_id": user_id, "p_room_id": proposed_room_id},
        ).execute()
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Matcher failed: {e.message}")

    claimed = (rpc.data or [None])[0]
    if claimed:
        peer_id = claimed["peer_id"]
        # Insert (or upgrade) our own ticket as matched with the same room_id.
        try:
            if row:  # we already had a waiting ticket — flip it to matched.
                db_client.table("peer_matchmaking_tickets").update({
                    "status": "matched",
                    "room_id": proposed_room_id,
                    "matched_with": peer_id,
                    "matched_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", row["id"]).execute()
                own_id = row["id"]
                keep_private = bool(row.get("keep_private", False))
            else:
                own = db_client.table("peer_matchmaking_tickets").insert({
                    "student_id": user_id,
                    "status": "matched",
                    "room_id": proposed_room_id,
                    "matched_with": peer_id,
                    "matched_at": datetime.now(timezone.utc).isoformat(),
                    "keep_private": bool(body.keep_private),
                }).execute()
                own_row = (own.data or [{}])[0]
                own_id = own_row.get("id", "")
                keep_private = bool(body.keep_private)
        except APIError as e:
            # Roll back the peer's claim so nobody's stuck matched-with-nobody.
            db_client.table("peer_matchmaking_tickets").update({
                "status": "waiting",
                "room_id": None,
                "matched_with": None,
                "matched_at": None,
            }).eq("id", claimed["ticket_id"]).execute()
            raise HTTPException(status_code=500, detail=f"Match write failed: {e.message}")

        return _row_to_status({
            "id": own_id,
            "status": "matched",
            "room_id": proposed_room_id,
            "matched_with": peer_id,
            "keep_private": keep_private,
            "created_at": None,
        }, user_id, email)

    # ── 3. Nothing to match → make sure we have a waiting ticket.
    if row and row["status"] == "waiting":
        # Refresh the privacy preference in case the user toggled it since.
        if bool(row.get("keep_private", False)) != bool(body.keep_private):
            db_client.table("peer_matchmaking_tickets").update({
                "keep_private": bool(body.keep_private),
            }).eq("id", row["id"]).execute()
            row["keep_private"] = bool(body.keep_private)
        return _row_to_status(row, user_id, email)

    # No prior ticket — insert one. The partial unique index guards
    # against a concurrent duplicate from a second tab.
    try:
        inserted = db_client.table("peer_matchmaking_tickets").insert({
            "student_id": user_id,
            "status": "waiting",
            "keep_private": bool(body.keep_private),
        }).execute()
    except APIError as e:
        # Unique violation → the other request won; re-read and return.
        try:
            existing2 = (
                db_client.table("peer_matchmaking_tickets")
                .select("id, status, room_id, matched_with, keep_private, created_at")
                .eq("student_id", user_id)
                .in_("status", ["waiting", "matched"])
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
        except APIError as e2:
            raise HTTPException(status_code=500, detail=f"Queue lookup failed: {e2.message}")
        row2 = (existing2.data or [None])[0]
        if not row2:
            raise HTTPException(status_code=500, detail=f"Queue insert failed: {e.message}")
        return _row_to_status(row2, user_id, email)

    new_row = (inserted.data or [{}])[0]
    return _row_to_status(new_row, user_id, email)


@router.post("/peer-matchmaking/cancel", status_code=204)
def cancel_matchmaking(current_user: dict = Depends(get_current_user)) -> None:
    """Remove the caller's waiting ticket. Matched tickets are left alone so
    a peer that has already been paired isn't silently orphaned."""
    try:
        db_client.table("peer_matchmaking_tickets").update({
            "status": "cancelled",
        }).eq("student_id", current_user["id"]).eq("status", "waiting").execute()
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Cancel failed: {e.message}")


# ─── Scheduling ───────────────────────────────────────────────────────────────

class ScheduledMeetingIn(BaseModel):
    title: Optional[str] = Field(default=None, max_length=120)
    scheduled_at: datetime  # ISO 8601 with timezone
    duration_minutes: int = Field(default=30, ge=5, le=240)
    keep_private: bool = False
    invitee_email: Optional[str] = Field(default=None, max_length=254)

    @field_validator("scheduled_at")
    @classmethod
    def not_too_far_in_past(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        # Small grace so a "schedule for now" click isn't rejected by clock skew.
        if v < datetime.now(timezone.utc) - timedelta(minutes=1):
            raise ValueError("scheduled_at cannot be in the past")
        return v


class ScheduledMeetingOut(BaseModel):
    id: str
    room_id: str
    title: Optional[str] = None
    scheduled_at: datetime
    duration_minutes: int
    keep_private: bool
    status: str  # scheduled | waiting | live | completed | cancelled
    creator_id: str
    invitee_id: Optional[str] = None
    role: str  # 'creator' | 'invitee'


class PublicScheduledMeetingOut(BaseModel):
    """Public-list shape — visible to any authenticated student, so private
    fields (creator_id UUID, invitee_id UUID, keep_private flag) are
    redacted. Only the peer-visible display name of the host is exposed,
    and only when the host did not opt into privacy.
    """
    id: str
    room_id: str
    title: Optional[str] = None
    scheduled_at: datetime
    duration_minutes: int
    status: str
    host_display_name: str  # "Anonymous Candidate" if creator kept private
    is_open: bool          # true = anyone may join; false = invitation-only
    is_authorized: bool    # true iff the caller may join this specific meeting
    can_join_now: bool     # is_authorized AND we're inside the join window


class JoinScheduledOut(BaseModel):
    room_id: str
    token: str
    keep_private: bool
    starts_at: datetime
    is_ready: bool  # false if the meeting time hasn't arrived yet
    status: str     # meeting status AFTER this join (may have advanced)


JOIN_GRACE_MINUTES_BEFORE = 5  # allow entering the room 5 min ahead of time
JOIN_GRACE_MINUTES_AFTER = 60  # meeting stays joinable for its duration + slack

# Cap the public upcoming-list payload. Bounded so a busy platform can't push
# a giant JSON list to every polling dashboard tab; the client pages naturally
# by dropping meetings past the join window, and 200 is well above what any
# single candidate needs to browse at once.
PUBLIC_UPCOMING_LIMIT = 200
# Cap the caller's own peer-reports history returned by /peer-reports.
PEER_REPORTS_LIMIT = 200


def _row_to_meeting(row: dict, viewer_id: str) -> ScheduledMeetingOut:
    return ScheduledMeetingOut(
        id=row["id"],
        room_id=row["room_id"],
        title=row.get("title"),
        scheduled_at=row["scheduled_at"],
        duration_minutes=row["duration_minutes"],
        keep_private=bool(row.get("keep_private", False)),
        status=row["status"],
        creator_id=row["creator_id"],
        invitee_id=row.get("invitee_id"),
        role="creator" if row["creator_id"] == viewer_id else "invitee",
    )


ACTIVE_STATUSES = ("scheduled", "waiting", "live")


@router.get("/peer-meetings", response_model=list[ScheduledMeetingOut])
def list_scheduled_meetings(
    current_user: dict = Depends(get_current_user),
) -> list[ScheduledMeetingOut]:
    """List MY still-active meetings -- as creator OR as invitee. Excludes
    completed/cancelled meetings and anything past its join window."""
    user_id = current_user["id"]
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=JOIN_GRACE_MINUTES_AFTER + 30)).isoformat()
    try:
        res = (
            db_client.table("peer_scheduled_meetings")
            .select("*")
            .or_(f"creator_id.eq.{user_id},invitee_id.eq.{user_id}")
            .in_("status", list(ACTIVE_STATUSES))
            .gte("scheduled_at", cutoff)
            .order("scheduled_at", desc=False)
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"List failed: {e.message}")
    return [_row_to_meeting(r, user_id) for r in (res.data or [])]


@router.get("/peer-meetings/upcoming", response_model=list[PublicScheduledMeetingOut])
def list_public_upcoming_meetings(
    current_user: dict = Depends(get_current_user),
) -> list[PublicScheduledMeetingOut]:
    """PUBLIC listing: every authenticated student sees every still-active
    scheduled meeting (open OR invitation-based).

    Private fields (creator_id/invitee_id UUIDs, keep_private) are redacted;
    the caller learns only the host's display name (or "Anonymous Candidate"
    if the host opted for privacy) and whether THEY personally are
    authorized to join this specific meeting."""
    user_id = current_user["id"]
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=JOIN_GRACE_MINUTES_AFTER + 30)).isoformat()
    try:
        res = (
            db_client.table("peer_scheduled_meetings")
            .select("*")
            .in_("status", list(ACTIVE_STATUSES))
            .gte("scheduled_at", cutoff)
            .order("scheduled_at", desc=False)
            .limit(PUBLIC_UPCOMING_LIMIT)
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Upcoming list failed: {e.message}")

    now = datetime.now(timezone.utc)
    rows = res.data or []
    # Batch-resolve host display names for every non-private host in one query
    # so we don't issue M+1 profile fetches per public-list poll.
    name_map = _resolve_display_names(
        [r["creator_id"] for r in rows if not bool(r.get("keep_private", False))]
    )
    out: list[PublicScheduledMeetingOut] = []
    for r in rows:
        host_private = bool(r.get("keep_private", False))
        host_name = "Anonymous Candidate" if host_private else name_map.get(r["creator_id"], "Peer")
        is_open = r.get("invitee_id") is None
        is_authorized = _is_authorized_to_join(r, user_id)

        scheduled_at = r["scheduled_at"]
        if isinstance(scheduled_at, str):
            scheduled_at_dt = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
        else:
            scheduled_at_dt = scheduled_at
        earliest = scheduled_at_dt - timedelta(minutes=JOIN_GRACE_MINUTES_BEFORE)
        latest = scheduled_at_dt + timedelta(minutes=r["duration_minutes"] + JOIN_GRACE_MINUTES_AFTER)

        out.append(PublicScheduledMeetingOut(
            id=r["id"],
            room_id=r["room_id"],
            title=r.get("title"),
            scheduled_at=scheduled_at_dt,
            duration_minutes=r["duration_minutes"],
            status=r["status"],
            host_display_name=host_name,
            is_open=is_open,
            is_authorized=is_authorized,
            can_join_now=is_authorized and earliest <= now <= latest,
        ))
    return out


def _is_authorized_to_join(row: dict, user_id: str) -> bool:
    """Open meetings (no invitee) are joinable by any authenticated student.
    Invitation-only meetings are joinable only by the creator or the invitee.
    """
    if row.get("invitee_id") is None:
        return True
    return user_id in (row.get("creator_id"), row.get("invitee_id"))


@router.post("/peer-meetings", response_model=ScheduledMeetingOut, status_code=201)
def create_scheduled_meeting(
    body: ScheduledMeetingIn,
    current_user: dict = Depends(get_current_user),
) -> ScheduledMeetingOut:
    user_id = current_user["id"]

    invitee_id: Optional[str] = None
    if body.invitee_email:
        try:
            inv = (
                db_client.table("profiles")
                .select("id, email")
                .eq("email", body.invitee_email.strip().lower())
                .maybe_single()
                .execute()
            )
        except APIError:
            inv = None
        # Silent if not found — the room can still be joined by ID; we just
        # don't have RLS access to publish the meeting to that account.
        inv_row = getattr(inv, "data", None) if inv is not None else None
        if inv_row:
            invitee_id = inv_row["id"]
            if invitee_id == user_id:
                raise HTTPException(status_code=422, detail="Cannot invite yourself")

    row_in = {
        "room_id": _generate_room_id(),
        "creator_id": user_id,
        "invitee_id": invitee_id,
        "title": (body.title or "").strip() or None,
        "scheduled_at": body.scheduled_at.astimezone(timezone.utc).isoformat(),
        "duration_minutes": body.duration_minutes,
        "keep_private": bool(body.keep_private),
        "status": "scheduled",
    }
    try:
        inserted = db_client.table("peer_scheduled_meetings").insert(row_in).execute()
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Create failed: {e.message}")
    row = (inserted.data or [None])[0]
    if not row:
        raise HTTPException(status_code=500, detail="Create returned no row")
    return _row_to_meeting(row, user_id)


@router.delete("/peer-meetings/{meeting_id}", status_code=204)
def cancel_scheduled_meeting(
    meeting_id: str = Path(..., min_length=8),
    current_user: dict = Depends(get_current_user),
) -> None:
    user_id = current_user["id"]
    try:
        res = (
            db_client.table("peer_scheduled_meetings")
            .select("id, creator_id, status")
            .eq("id", meeting_id)
            .maybe_single()
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Lookup failed: {e.message}")
    row = getattr(res, "data", None) if res is not None else None
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if row["creator_id"] != user_id:
        raise HTTPException(status_code=403, detail="Only the creator can cancel this meeting")
    if row["status"] != "scheduled":
        return
    try:
        db_client.table("peer_scheduled_meetings").update({"status": "cancelled"}).eq("id", meeting_id).execute()
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Cancel failed: {e.message}")


@router.post("/peer-meetings/{meeting_id}/join", response_model=JoinScheduledOut)
def join_scheduled_meeting(
    meeting_id: str = Path(..., min_length=8),
    current_user: dict = Depends(get_current_user),
) -> JoinScheduledOut:
    user_id = current_user["id"]
    try:
        res = (
            db_client.table("peer_scheduled_meetings")
            .select("*")
            .eq("id", meeting_id)
            .maybe_single()
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Lookup failed: {e.message}")
    row = getattr(res, "data", None) if res is not None else None
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Meeting must still be live for this feature (waiting / live / scheduled).
    # Completed & cancelled short-circuit with a clear reason.
    if row["status"] in ("cancelled", "completed"):
        raise HTTPException(status_code=410, detail=f"Meeting is {row['status']}")

    # Authorization: invitation-based meetings are restricted to creator +
    # invitee; open meetings (no invitee) are joinable by any authenticated
    # student. This is the ONLY authorization gate for /join.
    if not _is_authorized_to_join(row, user_id):
        raise HTTPException(status_code=403, detail="You are not authorized to join this meeting")

    scheduled_at = row["scheduled_at"]
    if isinstance(scheduled_at, str):
        # Supabase returns ISO strings
        scheduled_at = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    earliest = scheduled_at - timedelta(minutes=JOIN_GRACE_MINUTES_BEFORE)
    latest = scheduled_at + timedelta(minutes=row["duration_minutes"] + JOIN_GRACE_MINUTES_AFTER)

    is_ready = earliest <= now <= latest
    if now > latest:
        raise HTTPException(status_code=410, detail="Meeting window has passed")

    # Lifecycle transitions — only apply inside the join window so a "peek
    # ahead" click well before the meeting doesn't flip the status.
    new_status = row["status"]
    if is_ready:
        if row["status"] == "scheduled":
            new_status = "waiting"
            try:
                db_client.table("peer_scheduled_meetings").update({
                    "status": "waiting",
                    "first_joiner_id": user_id,
                }).eq("id", meeting_id).eq("status", "scheduled").execute()
            except APIError:
                pass
        elif row["status"] == "waiting" and row.get("first_joiner_id") and row["first_joiner_id"] != user_id:
            new_status = "live"
            try:
                db_client.table("peer_scheduled_meetings").update({
                    "status": "live",
                    "live_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", meeting_id).eq("status", "waiting").execute()
            except APIError:
                pass

    name = _resolve_display_name(user_id, current_user.get("email"))
    token = _mint_token_for(user_id, name)

    return JoinScheduledOut(
        room_id=row["room_id"],
        token=token,
        keep_private=bool(row.get("keep_private", False)),
        starts_at=scheduled_at,
        is_ready=is_ready,
        status=new_status,
    )


# ─── Peer interview reports (dashboard read side) ─────────────────────────────

class PeerReportOut(BaseModel):
    """Summary shape returned to the caller for their own peer-interview
    reports. Only fields the dashboard renders are included -- large per-turn
    payloads (question_timeline) stay in the DB row and can be fetched by a
    detail endpoint later if needed.
    """
    id: str
    room_id: str
    role: str  # 'candidate' | 'interviewer'
    partner_display_name: Optional[str] = None
    overall_score: Optional[float] = None
    technical_score: Optional[float] = None
    communication_score: Optional[float] = None
    confidence_score: Optional[float] = None
    problem_solving_score: Optional[float] = None
    topics_covered: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    final_recommendation: Optional[str] = None
    created_at: datetime


@router.get("/peer-reports", response_model=list[PeerReportOut])
def list_my_peer_reports(
    current_user: dict = Depends(get_current_user),
) -> list[PeerReportOut]:
    """Return the caller's own peer-interview reports, newest first.

    Backs the dashboard's learning-curve, streak, and Recent panels. The
    peer_interview_reports table has a student-scoped RLS SELECT policy, but
    the service-role client bypasses RLS -- we filter by student_id
    explicitly here so a bug in the service-role query cannot leak someone
    else's rows.
    """
    user_id = current_user["id"]
    try:
        res = (
            db_client.table("peer_interview_reports")
            .select(
                "id, room_id, role, partner_student_id, overall_score, technical_score, "
                "communication_score, confidence_score, problem_solving_score, "
                "topics_covered, strengths, weaknesses, suggestions, final_recommendation, "
                "created_at"
            )
            .eq("student_id", user_id)
            .order("created_at", desc=True)
            .limit(PEER_REPORTS_LIMIT)
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=f"Reports list failed: {e.message}")

    rows = res.data or []
    name_map = _resolve_display_names([r.get("partner_student_id") for r in rows])
    out: list[PeerReportOut] = []
    for r in rows:
        partner_id = r.get("partner_student_id")
        out.append(PeerReportOut(
            id=r["id"],
            room_id=r["room_id"],
            role=r["role"],
            partner_display_name=name_map.get(partner_id) if partner_id else None,
            overall_score=r.get("overall_score"),
            technical_score=r.get("technical_score"),
            communication_score=r.get("communication_score"),
            confidence_score=r.get("confidence_score"),
            problem_solving_score=r.get("problem_solving_score"),
            topics_covered=r.get("topics_covered") or [],
            strengths=r.get("strengths") or [],
            weaknesses=r.get("weaknesses") or [],
            suggestions=r.get("suggestions") or [],
            final_recommendation=r.get("final_recommendation"),
            created_at=r["created_at"],
        ))
    return out


def _complete_scheduled_meeting_for_room(room_id: str) -> None:
    """Called by /internal/peer-reports when a report lands. If the room
    is tied to a scheduled meeting, flip that meeting to 'completed' -- the
    report is the authoritative "the interview actually ended" signal.
    Idempotent; safe if the room is a matchmaking room with no scheduled row.

    Both DB failures are logged (not raised): the caller is the webhook that
    already persisted the report row, and re-raising here would fail the
    webhook after the durable write. Logging preserves the audit trail.
    """
    try:
        res = (
            db_client.table("peer_scheduled_meetings")
            .select("id, status")
            .eq("room_id", room_id)
            .in_("status", list(ACTIVE_STATUSES))
            .maybe_single()
            .execute()
        )
    except APIError:
        logger.exception("scheduled-meeting lookup for completion failed | room_id=%s", room_id)
        return
    row = getattr(res, "data", None) if res is not None else None
    if not row:
        return
    try:
        db_client.table("peer_scheduled_meetings").update({
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", row["id"]).execute()
    except APIError:
        logger.exception(
            "scheduled-meeting completion flip failed | room_id=%s | meeting_id=%s",
            room_id,
            row["id"],
        )
