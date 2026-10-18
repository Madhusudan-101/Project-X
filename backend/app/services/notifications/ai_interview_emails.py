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
                expires_at: str, instructions: str = "", reminder: bool = False,
                retake: bool = False) -> str:
    """Returns "sent" | "skipped" | "failed"."""
    link = html.escape(interview_link(invite_id))
    subject = (f"Reminder: your {company} AI interview" if reminder
               else f"{company} has given you another go at the AI interview" if retake
               else f"{company} invited you to an AI interview")
    extra = f"<p>{html.escape(instructions)}</p>" if instructions.strip() else ""
    lead = ("has given you another attempt at" if retake else "has invited you to")
    inner = (
        "<p>Hi,</p>"
        f"<p><b>{html.escape(company)}</b> {lead} an AI interview for "
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


def company_link() -> str:
    base = (os.getenv("APP_BASE_URL") or "").rstrip("/")
    return f"{base}/company" if base else "/company"


def send_submission_confirmation(*, to: str, company: str, role: str) -> str:
    """Tell the candidate their interview arrived. The report belongs to the company."""
    inner = (
        "<p>Hi,</p>"
        f"<p>We received your AI interview for <b>{html.escape(role)}</b> at "
        f"<b>{html.escape(company)}</b>. It was submitted and cannot be changed.</p>"
        f"<p>{html.escape(company)}'s hiring team will review it and a person there makes the decision. "
        "They will contact you about next steps. You will not see a report for this interview.</p>"
    )
    return send_email(to, f"We received your {company} interview", _shell("Interview submitted", inner))


def send_report_ready(*, to: str, company: str, role: str, candidate: str, partial: bool) -> str:
    """Tell the hiring team a candidate finished, so they do not have to keep checking."""
    link = html.escape(company_link())
    note = " They left before the end, so the report covers only what they answered." if partial else ""
    inner = (
        f"<p><b>{html.escape(candidate)}</b> finished the AI interview for "
        f"<b>{html.escape(role)}</b>.{note}</p>"
        f'<p><a href="{link}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;'
        'text-decoration:none">Read the report</a></p>'
        "<p>Open the Interviews tab, then Results. The AI recommends; you make the decision.</p>"
    )
    return send_email(to, f"{candidate} finished the {role} interview", _shell("Report ready", inner))


def send_outcome(*, to: str, company: str, role: str, decision: str, message: str = "") -> str:
    """The hiring team's outcome, sent only when they choose to (never for 'hold')."""
    extra = f"<p>{html.escape(message)}</p>" if message.strip() else ""
    if decision == "advance":
        subject = f"Update on your {role} application at {company}"
        body = (f"<p>Thank you for completing the AI interview. <b>{html.escape(company)}</b> would like to "
                "move you forward. They will contact you about next steps.</p>")
    else:
        subject = f"Update on your {role} application at {company}"
        body = (f"<p>Thank you for the time you put into the AI interview for <b>{html.escape(role)}</b>. "
                f"After review, <b>{html.escape(company)}</b> has decided not to move forward at this time.</p>")
    return send_email(to, subject, _shell("Application update", "<p>Hi,</p>" + body + extra))


def send_accommodation_request(*, to: str, company: str, role: str, candidate_email: str, message: str) -> str:
    """A candidate asked for an accommodation. Goes to the hiring team, who can extend or allow a retake."""
    link = html.escape(company_link())
    inner = (
        f"<p>A candidate invited to the <b>{html.escape(role)}</b> interview asked for an accommodation.</p>"
        f"<p><b>From:</b> {html.escape(candidate_email)}</p>"
        f"<blockquote style=\"border-left:3px solid #ccc;margin:12px 0;padding-left:12px\">{html.escape(message)}</blockquote>"
        f'<p><a href="{link}">Open your interviews</a> to extend their deadline or reply to them directly.</p>'
    )
    return send_email(to, f"Accommodation request for {role}", _shell("Accommodation request", inner))
