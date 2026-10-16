"""Emails for peer interviews: invitations, cancellations, reminders and no-shows.

Nothing here can break the feature: a missing or failing email provider just means no email
(`send_email` reports "skipped" or "failed"), and every send respects the person's own settings.
The host's name is never put in an email when they chose to stay private.
"""
from __future__ import annotations

import html
import logging
import os
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..deps import db_client
from .notifications.oa_emails import send_email

log = logging.getLogger(__name__)
ANON = "a Mirracle candidate"


def dashboard_url() -> str:
    return (os.getenv("APP_BASE_URL") or "").rstrip("/") + "/candidate"


def format_time(when: datetime, tz_name: Optional[str]) -> str:
    """The time in the person's own timezone, with the zone named, so nobody has to guess."""
    zone = None
    if tz_name:
        try:
            zone = ZoneInfo(tz_name)
        except (ZoneInfoNotFoundError, ValueError):
            zone = None
    local = when.astimezone(zone) if zone else when
    label = tz_name if zone else "UTC"
    return f"{local.strftime('%a %d %b %Y, %H:%M')} ({label})"


def valid_timezone(name: Optional[str]) -> bool:
    if not name:
        return False
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return False


def get_preferences(student_id: str) -> dict:
    """A person's peer settings, with the defaults when they never set any."""
    try:
        res = db_client.table("peer_preferences").select("*").eq("student_id", student_id).maybe_single().execute()
        row = getattr(res, "data", None) or {}
    except Exception:  # noqa: BLE001 - settings must never break a notification
        row = {}
    return {
        "default_private": row.get("default_private", True),
        "timezone": row.get("timezone"),
        "email_invites": row.get("email_invites", True),
        "email_reminders": row.get("email_reminders", True),
    }


def _contact(student_id: str) -> tuple[Optional[str], str]:
    """(email, first name or 'there') for a person."""
    try:
        res = db_client.table("profiles").select("email, name, first_name").eq("id", student_id).maybe_single().execute()
        row = getattr(res, "data", None) or {}
    except Exception:  # noqa: BLE001
        return None, "there"
    name = (row.get("first_name") or (row.get("name") or "").split(" ")[0] or "there").strip()
    return row.get("email"), (name if name and "@" not in name else "there")


def _shell(title: str, inner: str) -> str:
    return (
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">'
        f'<h2 style="margin-bottom:8px">{html.escape(title)}</h2>{inner}'
        f'<p><a href="{html.escape(dashboard_url())}">Open your Mirracle dashboard</a></p>'
        '<p style="color:#666;font-size:12px;margin-top:24px">Sent by Mirracle. You can turn these emails off in your peer interview settings.</p></div>'
    )


def _send(student_id: str, subject: str, title: str, inner: str, *, kind: str) -> str:
    """kind: 'invites' or 'reminders' decides which setting to respect."""
    prefs = get_preferences(student_id)
    if not prefs[f"email_{kind}"]:
        return "skipped"
    email, _ = _contact(student_id)
    if not email:
        return "skipped"
    return send_email(email, subject, _shell(title, inner))


def _host_label(meeting: dict, creator_name: str) -> str:
    return ANON if meeting.get("keep_private") else creator_name


def send_invitation(meeting: dict, creator_id: str, invitee_id: str) -> str:
    prefs = get_preferences(invitee_id)
    _, creator_first = _contact(creator_id)
    host = _host_label(meeting, creator_first)
    when = format_time(datetime.fromisoformat(str(meeting["scheduled_at"]).replace("Z", "+00:00")), prefs["timezone"])
    return _send(
        invitee_id, "You have been invited to a peer interview",
        "You have been invited to a peer interview",
        f"<p>{html.escape(host[0].upper() + host[1:])} invited you to a practice interview on "
        f"<b>{html.escape(when)}</b> ({int(meeting['duration_minutes'])} minutes).</p>"
        "<p>Open your dashboard and look under Scheduled interviews. You can join from 5 minutes before the start.</p>",
        kind="invites",
    )


def send_cancellation(meeting: dict, creator_id: str, invitee_id: str) -> str:
    prefs = get_preferences(invitee_id)
    when = format_time(datetime.fromisoformat(str(meeting["scheduled_at"]).replace("Z", "+00:00")), prefs["timezone"])
    return _send(
        invitee_id, "A peer interview was cancelled", "A peer interview was cancelled",
        f"<p>The practice interview planned for <b>{html.escape(when)}</b> was cancelled. You do not need to do anything.</p>",
        kind="invites",
    )


def send_rescheduled(meeting: dict, creator_id: str, invitee_id: str) -> str:
    prefs = get_preferences(invitee_id)
    _, creator_first = _contact(creator_id)
    host = _host_label(meeting, creator_first)
    when = format_time(datetime.fromisoformat(str(meeting["scheduled_at"]).replace("Z", "+00:00")), prefs["timezone"])
    return _send(
        invitee_id, "A peer interview was moved", "A peer interview was moved",
        f"<p>{html.escape(host[0].upper() + host[1:])} moved your practice interview to <b>{html.escape(when)}</b> "
        f"({int(meeting['duration_minutes'])} minutes).</p>"
        "<p>If the new time does not work for you, ask them to pick another one.</p>",
        kind="invites",
    )


def send_reminder(meeting: dict, student_id: str, *, soon: bool) -> str:
    prefs = get_preferences(student_id)
    when = format_time(datetime.fromisoformat(str(meeting["scheduled_at"]).replace("Z", "+00:00")), prefs["timezone"])
    lead = "starts in about 15 minutes" if soon else "is tomorrow"
    return _send(
        student_id, "Your peer interview " + ("starts soon" if soon else "is coming up"),
        "Your peer interview " + ("starts soon" if soon else "is coming up"),
        f"<p>Your practice interview {lead}: <b>{html.escape(when)}</b>.</p>"
        "<p>Open your dashboard to join. Find a quiet place and check your camera and microphone first.</p>"
        "<p>If you cannot make it, please cancel so your partner is not left waiting.</p>",
        kind="reminders",
    )


def send_no_show(meeting: dict, waiting_student_id: str) -> str:
    return _send(
        waiting_student_id, "Your peer interview partner did not arrive",
        "Your partner did not arrive",
        "<p>We are sorry: nobody joined your practice interview in time. It was not your fault, and it does not count against you.</p>"
        "<p>You can find another partner right now from your dashboard, or schedule a new time.</p>",
        kind="reminders",
    )
