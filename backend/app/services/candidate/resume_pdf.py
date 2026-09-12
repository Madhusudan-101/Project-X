"""
resume_pdf.py — render a tailored resume's final_text into a clean PDF and
upload it to Supabase Storage.

WeasyPrint is imported lazily: if it (or its system libs: pango / cairo /
gdk-pixbuf) is not installed, render_resume_pdf raises PdfRenderUnavailable
and the route returns a 503 with a clear message — the rest of the
tailoring feature still works without it.
"""

from __future__ import annotations

import html
import logging
import re

from ...deps import db_client
from ...utils.resume_diff import _is_heading  # heading heuristic, reused

logger = logging.getLogger(__name__)

_BUCKET = "tailored-resumes"

_CSS = """
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Georgia", "Times New Roman", serif; font-size: 10.5pt;
       line-height: 1.4; color: #1a1a1a; }
h1 { font-size: 16pt; margin: 0 0 2pt; }
h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .04em;
     border-bottom: 1px solid #999; padding-bottom: 2pt; margin: 14pt 0 6pt; }
p { margin: 2pt 0; }
ul { margin: 2pt 0 6pt; padding-left: 16pt; }
li { margin: 1.5pt 0; }
.header { margin-bottom: 8pt; }
"""


class PdfRenderUnavailable(RuntimeError):
    """WeasyPrint (or its system deps) is not installed."""


def _text_to_html(text: str) -> str:
    lines = text.splitlines()
    parts: list[str] = ['<div class="header">']
    in_list = False
    seen_heading = False

    def close_list() -> None:
        nonlocal in_list
        if in_list:
            parts.append("</ul>")
            in_list = False

    for raw in lines:
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            close_list()
            continue
        if _is_heading(line):
            close_list()
            if not seen_heading:
                parts.append("</div>")  # close .header block
                seen_heading = True
            parts.append(f"<h2>{html.escape(stripped.rstrip(':'))}</h2>")
            continue
        bullet = re.match(r"^[-*•·]\s+(.*)$", stripped)
        if bullet:
            if not in_list:
                parts.append("<ul>")
                in_list = True
            parts.append(f"<li>{html.escape(bullet.group(1))}</li>")
            continue
        close_list()
        tag = "h1" if not seen_heading and len(parts) <= 2 else "p"
        parts.append(f"<{tag}>{html.escape(stripped)}</{tag}>")

    close_list()
    if not seen_heading:
        parts.append("</div>")
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>{_CSS}</style></head><body>{''.join(parts)}</body></html>"
    )


def render_resume_pdf(final_text: str) -> bytes:
    try:
        from weasyprint import HTML  # noqa: PLC0415 — lazy on purpose
    except Exception as exc:  # noqa: BLE001 — ImportError or missing system libs
        raise PdfRenderUnavailable(
            "PDF rendering is not available on this server. Install weasyprint and its "
            "system libraries (libpango, libcairo, libgdk-pixbuf)."
        ) from exc

    return HTML(string=_text_to_html(final_text)).write_pdf()


def _ensure_bucket() -> None:
    try:
        db_client.storage.get_bucket(_BUCKET)
    except Exception:  # noqa: BLE001 — not found / not permitted
        try:
            db_client.storage.create_bucket(_BUCKET, options={"public": False})
        except Exception as exc:  # noqa: BLE001 — already exists / race
            logger.info("Bucket %s create skipped: %s", _BUCKET, exc)


def upload_and_sign(path: str, pdf_bytes: bytes, expires_in: int = 3600) -> str:
    """Upload the PDF (overwriting any prior render at this path) and return
    a signed URL."""
    _ensure_bucket()
    bucket = db_client.storage.from_(_BUCKET)
    try:
        bucket.upload(
            path,
            pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"},
        )
    except Exception as exc:  # noqa: BLE001 — storage3 raises on existing object without upsert
        logger.warning("Upload of %s hit %s — retrying via update", path, exc)
        bucket.update(path, pdf_bytes, {"content-type": "application/pdf"})

    signed = bucket.create_signed_url(path, expires_in)
    return (
        signed.get("signedURL")
        or signed.get("signedUrl")
        or signed.get("signed_url")
        or ""
    )
