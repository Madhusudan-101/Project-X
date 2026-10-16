"""Scheduled upkeep so an interview can never get stuck. Run by POST /internal/ai-interview/maintenance
(call it every 15 minutes from any scheduler).

  * expiry reminders   an invitation expiring within 24 hours gets one reminder email
  * stuck sessions     a session with no report well after its time limit is closed as incomplete, so the
                       hiring team sees it and can allow a retake instead of waiting forever
  * retention          optionally blank old transcripts and written reports (scores are kept)
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from ...crud import get_company_names
from ...deps import db_client
from ..notifications import ai_interview_emails
from .invites import parse_ts

log = logging.getLogger(__name__)

REMINDER_WINDOW = timedelta(hours=24)
STALE_GRACE = timedelta(minutes=10)


def _default_minutes() -> int:
    try:
        return max(5, int(os.getenv("AI_INTERVIEW_MAX_MINUTES") or 20))
    except ValueError:
        return 20


def send_expiry_reminders(now: datetime) -> int:
    invites = [
        i for i in db_client.table("ai_interview_invites").select("*").eq("status", "invited").execute().data or []
        if not i.get("reminded_at")
        and (exp := parse_ts(i.get("expires_at"))) is not None and now < exp <= now + REMINDER_WINDOW
    ]
    if not invites:
        return 0
    templates = {
        t["id"]: t for t in db_client.table("ai_interview_templates").select("*")
        .in_("id", list({i["template_id"] for i in invites})).execute().data or []
    }
    companies = get_company_names(list({i["company_id"] for i in invites}))
    sent = 0
    for inv in invites:
        t = templates.get(inv["template_id"])
        if not t or t.get("status") != "active":
            continue
        status = ai_interview_emails.send_invite(
            invite_id=inv["id"], to=inv["email"], company=companies.get(inv["company_id"], "A company"),
            role=t["role_title"], duration_minutes=t["duration_minutes"], expires_at=inv["expires_at"],
            instructions=t.get("instructions") or "", reminder=True,
        )
        if status == "sent":  # unsent reminders stay eligible for the next run
            db_client.table("ai_interview_invites").update({"reminded_at": now.isoformat()}).eq("id", inv["id"]).execute()
            sent += 1
    return sent


def sweep_stale_sessions(now: datetime) -> int:
    open_sessions = db_client.table("ai_voice_interview_sessions").select("*").eq("status", "started").execute().data or []
    if not open_sessions:
        return 0
    templates = {
        t["id"]: t for t in db_client.table("ai_interview_templates").select("id, duration_minutes")
        .in_("id", list({s["template_id"] for s in open_sessions if s.get("template_id")}) or ["-"]).execute().data or []
    }
    swept = 0
    for s in open_sessions:
        started = parse_ts(s.get("started_at"))
        if started is None:
            continue
        minutes = int((templates.get(s.get("template_id")) or {}).get("duration_minutes") or _default_minutes())
        if now <= started + timedelta(minutes=minutes) + STALE_GRACE:
            continue
        has_report = db_client.table("ai_voice_interview_reports").select("id").eq("room_id", s["room_id"]).limit(1).execute().data
        if has_report:
            continue  # the webhook already finished it; nothing to repair here
        db_client.table("ai_voice_interview_sessions").update(
            {"status": "abandoned", "ended_at": now.isoformat(), "ended_reason": "swept"}
        ).eq("room_id", s["room_id"]).execute()
        if s.get("invite_id"):
            db_client.table("ai_interview_invites").update(
                {"status": "completed", "completed_at": now.isoformat()}
            ).eq("id", s["invite_id"]).eq("status", "started").execute()
        swept += 1
    return swept


def redact_old_transcripts(now: datetime, days: int) -> int:
    if days <= 0:
        return 0
    cutoff = (now - timedelta(days=days)).isoformat()
    rows = db_client.table("ai_voice_interview_reports").select("id, transcript, report_markdown") \
        .lt("created_at", cutoff).execute().data or []
    n = 0
    for r in rows:
        if r.get("transcript") is None and r.get("report_markdown") is None:
            continue
        db_client.table("ai_voice_interview_reports").update(
            {"transcript": None, "report_markdown": None}
        ).eq("id", r["id"]).execute()
        n += 1
    return n


def run_maintenance(now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    try:
        days = int(os.getenv("AI_INTERVIEW_TRANSCRIPT_RETENTION_DAYS") or 0)
    except ValueError:
        days = 0
    result: Dict[str, Any] = {}
    for key, fn in (
        ("reminders_sent", lambda: send_expiry_reminders(now)),
        ("swept", lambda: sweep_stale_sessions(now)),
        ("redacted", lambda: redact_old_transcripts(now, days)),
    ):
        try:  # one failing step must not stop the others
            result[key] = fn()
        except Exception:  # noqa: BLE001
            log.exception("maintenance step %s failed", key)
            result[key] = None
    return result
