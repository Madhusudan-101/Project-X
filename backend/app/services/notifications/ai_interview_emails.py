"""AI interview invitation email. Same transport as the online assessment emails:
sent through Resend when RESEND_API_KEY and OA_EMAIL_FROM are set, otherwise a logged
no-op returning "skipped". Never raises: a failed email must not fail an invite, because
the candidate always sees the invitation on their dashboard anyway."""

from __future__ import annotations

import html
import os
from datetime import datetime
from typing import Optional

from .oa_emails import _shell, send_email


def interview_link(invite_id: str) -> str:
    base = (os.getenv("APP_BASE_URL") or "").rstrip("/")
    return f"{base}/candidate?ai_interview_invite={invite_id}"


def _fmt(iso: Optional[str]) -> str:
    if not iso:
        return "soon"
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).strftime("%a %d %b %Y, %H:%M UTC")
    except ValueError:
        return str(iso)


def send_invite(*, invite_id: str, to: str, company: str, role: str, duration_minutes: int,
                expires_at: str, instructions: str = "", reminder: bool = False) -> str:
    """Returns "sent" | "skipped" | "failed"."""
    link = html.escape(interview_link(invite_id))
    subject = (f"Reminder: your {company} AI interview" if reminder
               else f"{company} invited you to an AI interview")
    extra = f"<p>{html.escape(instructions)}</p>" if instructions.strip() else ""
    inner = (
        "<p>Hi,</p>"
        f"<p><b>{html.escape(company)}</b> has invited you to an AI interview for "
        f"<b>{html.escape(role)}</b>.</p>"
        f"<p>It takes up to <b>{int(duration_minutes)} minutes</b> and you can take it once. "
        f"Please start before <b>{html.escape(_fmt(expires_at))}</b>.</p>"
        f"{extra}"
        "<p>You will need a quiet room, a working camera and microphone, and a stable connection. "
        "Your camera and microphone must stay on, and the interviewer will ask for your permission "
        "before you begin.</p>"
        f'<p><a href="{link}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;'
        'text-decoration:none">Open your interview</a></p>'
        "<p>Sign in with this email address to see it. You can also practice first from the "
        "AI Interview tab.</p>"
    )
    return send_email(to, subject, _shell("AI interview invitation", inner))
