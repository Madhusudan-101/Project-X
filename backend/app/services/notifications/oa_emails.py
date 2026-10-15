"""Online Assessment emails (invite, reminder, submission receipt).

Sent through Resend's HTTP API when `RESEND_API_KEY` and `OA_EMAIL_FROM` are
set. With no key configured every send is a logged no-op returning "skipped",
so the OA works without email — invited candidates always see the assessment
on their dashboard regardless.

Every function returns "sent" | "skipped" | "failed" and never raises:
notifications must not break invites or submissions.
"""

from __future__ import annotations

import html
import logging
import os
from datetime import datetime
from typing import Optional

import httpx

from ...crud import get_application, get_company_names, get_job, get_profiles_basic

log = logging.getLogger(__name__)


def _fmt(iso: Optional[str]) -> str:
    if not iso:
        return "to be announced"
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).strftime("%a %d %b %Y, %H:%M UTC")
    except ValueError:
        return str(iso)


def assessment_link(application_id: str) -> str:
    base = (os.getenv("APP_BASE_URL") or "").rstrip("/")
    return f"{base}/candidate-oa/{application_id}" if base else f"/candidate-oa/{application_id}"


def send_email(to: str, subject: str, body_html: str) -> str:
    key, sender = os.getenv("RESEND_API_KEY"), os.getenv("OA_EMAIL_FROM")
    if not key or not sender:
        log.info("OA email skipped (RESEND_API_KEY / OA_EMAIL_FROM not set): %s", subject)
        return "skipped"
    try:
        res = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {key}"},
            json={"from": sender, "to": [to], "subject": subject, "html": body_html},
            timeout=10,
        )
        if res.status_code >= 300:
            log.warning("OA email failed (%s): %s", res.status_code, res.text[:200])
            return "failed"
        return "sent"
    except httpx.HTTPError:
        log.exception("OA email transport error")
        return "failed"


def _shell(title: str, inner: str) -> str:
    return (
        '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">'
        f'<h2 style="margin-bottom:8px">{html.escape(title)}</h2>{inner}'
        '<p style="color:#666;font-size:12px;margin-top:24px">Sent by Mirracle.</p></div>'
    )


def _context(application_id: str) -> Optional[dict]:
    app = get_application(application_id)
    if not app:
        return None
    job = get_job(app["job_id"]) or {}
    company = get_company_names([app["company_id"]]).get(app["company_id"], "the company")
    profile = get_profiles_basic([app["student_id"]]).get(app["student_id"], {})
    return {
        "email": profile.get("email"),
        "name": profile.get("first_name") or profile.get("name") or "there",
        "job": job.get("title", "the role"),
        "company": company,
    }


def send_invite(application_id: str, window_start: Optional[str], window_end: Optional[str],
                *, reminder: bool = False) -> str:
    ctx = _context(application_id)
    if not ctx or not ctx["email"]:
        return "skipped"
    link = html.escape(assessment_link(application_id))
    subject = (f"Reminder: your {ctx['company']} online assessment" if reminder
               else f"You're invited to the {ctx['company']} online assessment")
    inner = (
        f"<p>Hi {html.escape(ctx['name'])},</p>"
        f"<p><b>{html.escape(ctx['company'])}</b> has invited you to take the online assessment for "
        f"<b>{html.escape(ctx['job'])}</b>.</p>"
        f"<p>Window: <b>{html.escape(_fmt(window_start))}</b> to <b>{html.escape(_fmt(window_end))}</b>.</p>"
        "<p>Read the instructions first. The test has timed sections — once you move past a section you "
        "can't go back, and time doesn't roll over. Use a laptop with a stable connection.</p>"
        f'<p><a href="{link}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;'
        'text-decoration:none">Open the assessment</a></p>'
        "<p>You'll need to be signed in to your Mirracle account.</p>"
    )
    return send_email(ctx["email"], subject, _shell("Online assessment", inner))


def send_submitted_confirmation(attempt: dict) -> str:
    ctx = _context(attempt["application_id"])
    if not ctx or not ctx["email"]:
        return "skipped"
    inner = (
        f"<p>Hi {html.escape(ctx['name'])},</p>"
        f"<p>We received your assessment for <b>{html.escape(ctx['job'])}</b> at "
        f"<b>{html.escape(ctx['company'])}</b>. It can't be changed now.</p>"
        f"<p>{html.escape(ctx['company'])} will review it and share next steps. "
        "Check your Mirracle dashboard for updates.</p>"
    )
    return send_email(ctx["email"], f"We received your {ctx['company']} assessment", _shell("Submission received", inner))
