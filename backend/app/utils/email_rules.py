"""Email validation rules shared across signup routes."""

import re

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def is_valid_email_format(email: str) -> bool:
    return bool(_EMAIL_RE.match(email or ""))
