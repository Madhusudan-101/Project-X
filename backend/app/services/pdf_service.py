"""
PDF Service — pdf_service.py
────────────────────────────
Extracts plain text from an uploaded PDF (job description) so it can be
handed to the Gemini extraction agent. Deliberately narrow in scope —
just bytes in, text out.
"""

from __future__ import annotations

import io
import logging

from pypdf import PdfReader
from pypdf.errors import PdfReadError

logger = logging.getLogger(__name__)

# Keep the prompt token-efficient — a JD rarely needs more than this to
# capture skills, experience level, role type, and preferred qualifications.
MAX_EXTRACTED_CHARS = 12_000


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """
    Extract text from a PDF's raw bytes.

    Raises:
        ValueError: if the file isn't a readable PDF, or no extractable
            text is found (e.g. a scanned/image-only PDF).
    """
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
    except PdfReadError as exc:
        raise ValueError(f"Could not read PDF file: {exc}") from exc

    pages_text: list[str] = []
    for page in reader.pages:
        try:
            pages_text.append(page.extract_text() or "")
        except Exception as exc:  # pypdf can raise various parsing errors per-page
            logger.warning("Failed to extract a page from JD PDF: %s", exc)

    text = "\n".join(pages_text).strip()

    if len(text) < 50:
        raise ValueError(
            "Could not extract text from this PDF. It may be a scanned image "
            "without a text layer — please upload a text-based PDF."
        )

    return text[:MAX_EXTRACTED_CHARS]
