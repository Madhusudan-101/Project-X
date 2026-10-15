"""CSV cell hardening shared by the exports.

Names, e-mails and branches are user-supplied; a cell that starts with
=, +, - or @ is executed as a formula by Excel / Sheets when the export is
opened. Prefixing a quote makes it inert text.
"""

from typing import Any

_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value: Any) -> Any:
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value
