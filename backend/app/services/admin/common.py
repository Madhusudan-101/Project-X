"""Shared plumbing for the /admin routers.

Every admin metric is computed in Postgres by an `admin_*` function
(db/admin_portal_migration.sql) that only the service role may execute. This
module is the one place the API calls them, so date-range validation, paging,
error mapping and CSV export behave identically across every admin endpoint.
"""

from __future__ import annotations

import csv
import io
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from fastapi import HTTPException, Query
from fastapi.responses import StreamingResponse
from postgrest.exceptions import APIError

from ...deps import db_client

log = logging.getLogger(__name__)

_MAX_RANGE = timedelta(days=366 * 20)

# CSV export. A page must stay <= PostgREST's `max-rows` (Supabase default 1000) or
# the API silently returns fewer rows than asked for. EXPORT_MAX_ROWS is a guard
# against accidental huge exports; hitting it is reported, never silent.
EXPORT_PAGE_SIZE = 1000
EXPORT_MAX_ROWS = 50_000

# Bucket the trend series by the span of the requested range.
_DAY_BUCKET_MAX = timedelta(days=45)
_WEEK_BUCKET_MAX = timedelta(days=200)


# ── Date range ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class DateRange:
    """Half-open [start, end). Both None = all time."""

    start: Optional[datetime]
    end: Optional[datetime]

    def params(self) -> Dict[str, Optional[str]]:
        return {
            "p_from": self.start.isoformat() if self.start else None,
            "p_to": self.end.isoformat() if self.end else None,
        }

    @property
    def bucket(self) -> str:
        if not self.start or not self.end:
            return "month"
        span = self.end - self.start
        if span <= _DAY_BUCKET_MAX:
            return "day"
        return "week" if span <= _WEEK_BUCKET_MAX else "month"


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def date_range(
    date_from: Optional[datetime] = Query(None, alias="from", description="Range start (inclusive), ISO 8601"),
    date_to: Optional[datetime] = Query(None, alias="to", description="Range end (exclusive), ISO 8601"),
) -> DateRange:
    """FastAPI dependency. The browser resolves presets ("last 7 days", "this
    month") in the admin's own time zone and sends the instants; omit both
    for all time."""
    if (date_from is None) != (date_to is None):
        raise HTTPException(status_code=422, detail="Provide both 'from' and 'to', or neither.")
    if date_from is None or date_to is None:
        return DateRange(None, None)
    start, end = _as_utc(date_from), _as_utc(date_to)
    if end <= start:
        raise HTTPException(status_code=422, detail="'to' must be after 'from'.")
    if end - start > _MAX_RANGE:
        raise HTTPException(status_code=422, detail="Date range is too large (max 20 years).")
    return DateRange(start, end)


# ── Paging & sorting ───────────────────────────────────────────────────

@dataclass(frozen=True)
class Page:
    number: int
    size: int

    @property
    def offset(self) -> int:
        return (self.number - 1) * self.size


def page_params(
    page: int = Query(1, ge=1, le=100_000),
    page_size: int = Query(25, ge=1, le=100),
) -> Page:
    return Page(page, page_size)


def clean_sort(sort: Optional[str], direction: str, allowed: Sequence[str], default: str) -> Tuple[str, str]:
    """Whitelist the sort key (SQL also falls back on unknown keys, but an
    explicit 422 tells the caller what they did wrong)."""
    if direction not in ("asc", "desc"):
        raise HTTPException(status_code=422, detail="dir must be 'asc' or 'desc'.")
    key = sort or default
    if key not in allowed:
        raise HTTPException(status_code=422, detail=f"sort must be one of {list(allowed)}.")
    return key, direction


def one_of(value: Optional[str], allowed: Sequence[str], name: str) -> Optional[str]:
    if value in (None, ""):
        return None
    if value not in allowed:
        raise HTTPException(status_code=422, detail=f"{name} must be one of {list(allowed)}.")
    return value


def clean_search(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    return value[:100] or None


# ── RPC ────────────────────────────────────────────────────────────────

def rpc(name: str, params: Dict[str, Any]) -> Any:
    """Call an admin_* SQL function with the service client."""
    try:
        return db_client.rpc(name, params).execute().data
    except APIError as e:
        # PGRST202 = function not found: the migration has not been applied.
        if getattr(e, "code", None) == "PGRST202":
            log.error("Admin function %s is missing — apply db/admin_portal_migration.sql", name)
            raise HTTPException(
                status_code=503,
                detail="Admin analytics are not installed on this database yet "
                       "(db/admin_portal_migration.sql has not been applied).",
            )
        log.error("Admin RPC %s failed: %s", name, e)
        raise HTTPException(status_code=500, detail="Failed to load admin analytics.")


def _split_total(rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    total = int(rows[0]["total_count"]) if rows else 0
    return [{k: v for k, v in r.items() if k != "total_count"} for r in rows], total


def rpc_page(name: str, params: Dict[str, Any], page: Page) -> Dict[str, Any]:
    """Run a paged list function. `total` counts the filtered set."""
    rows = rpc(name, {**params, "p_limit": page.size, "p_offset": page.offset}) or []
    items, total = _split_total(rows)
    if not rows and page.offset > 0:
        # Paged past the end: the empty page carries no total_count — ask again.
        _, total = _split_total(rpc(name, {**params, "p_limit": 1, "p_offset": 0}) or [])
    return {"items": items, "total": total, "page": page.number, "page_size": page.size}


def rpc_one(name: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """First row of a list function (used with its id filter for detail views)."""
    rows = rpc(name, {**params, "p_limit": 1, "p_offset": 0}) or []
    return _split_total(rows)[0][0] if rows else None


@dataclass(frozen=True)
class ExportResult:
    """Every row of a filtered list, and whether it is the COMPLETE set."""

    rows: List[Dict[str, Any]]
    total: int          # rows matching the filters
    truncated: bool     # True when fewer than `total` rows are in `rows`


def rpc_all(name: str, params: Dict[str, Any]) -> ExportResult:
    """Fetch a filtered list in pages of <= EXPORT_PAGE_SIZE until it is
    exhausted or EXPORT_MAX_ROWS is reached.

    Completeness is judged against the function's own `total_count`, and the
    offset advances by the rows actually RECEIVED — so a server-side row cap
    lower than our page size can shorten a page but never skips rows. The
    SQL functions order by a unique tie-breaker, so offset paging is stable.
    """
    rows: List[Dict[str, Any]] = []
    total: Optional[int] = None
    offset = 0
    while len(rows) < EXPORT_MAX_ROWS:
        want = min(EXPORT_PAGE_SIZE, EXPORT_MAX_ROWS - len(rows))
        page = rpc(name, {**params, "p_limit": want, "p_offset": offset}) or []
        if not page:
            break
        if total is None:
            total = int(page[0]["total_count"])
        items, _ = _split_total(page)
        rows.extend(items)
        offset += len(items)
        if offset >= total:
            break
    total = total or 0
    return ExportResult(rows=rows, total=total, truncated=len(rows) < total)


# ── CSV export ─────────────────────────────────────────────────────────

_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_cell(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    # Names, emails and company names are user-supplied; a leading =,+,-,@ is
    # executed as a formula by Excel/Sheets when the export is opened.
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


# Custom response headers are invisible to browser JS across origins unless
# exposed; scoped to the export responses rather than widening global CORS.
_EXPORT_HEADERS = ("Content-Disposition", "X-Export-Rows", "X-Export-Total", "X-Export-Truncated")


def csv_response(result: ExportResult, columns: Sequence[Tuple[str, str]], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([header for _, header in columns])
    for row in result.rows:
        writer.writerow([_csv_cell(row.get(key)) for key, _ in columns])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Export-Rows": str(len(result.rows)),
            "X-Export-Total": str(result.total),
            "X-Export-Truncated": "true" if result.truncated else "false",
            "Access-Control-Expose-Headers": ", ".join(_EXPORT_HEADERS),
        },
    )


# ── Derived KPIs ───────────────────────────────────────────────────────

def ratio(numerator: Optional[float], denominator: Optional[float], digits: int = 4) -> Optional[float]:
    """None (shown as N/A) when the denominator is zero — never a fake 0."""
    if not denominator:
        return None
    return round((numerator or 0) / denominator, digits)
