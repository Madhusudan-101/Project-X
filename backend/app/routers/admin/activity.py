"""Admin Live Activity & Audit Log — /admin/live-activity · /admin/audit-log

Two different read models over the same underlying data (admin_activity_feed
merges derived platform events with successful admin_events; admin_list_events
is the raw, unfiltered admin_events table) — see db/admin_portal_migration.sql,
6.3/6.4 for why they are not the same endpoint. The Overview's compact panel
keeps using the original /admin/activity (unchanged).
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from ...deps import require_admin_role
from ...services.admin.common import (
    DateRange, Page, clean_search, clean_sort, csv_response, date_range, one_of,
    page_params, rpc, rpc_all, rpc_page,
)
from ...services.admin.events import EVENT_TYPES, log_event

router = APIRouter(prefix="/admin", tags=["admin-activity"], dependencies=[Depends(require_admin_role)])

_EVENT_TYPES = tuple(sorted(EVENT_TYPES))

# Derived kinds (see the original admin_activity) plus every event type this
# backend actually emits — kept explicit so an unknown ?kind= is a 422, not a
# silently-empty filter.
_FEED_KINDS = (
    "candidate_registered", "company_registered", "college_registered",
    "drive_created", "application_submitted", "candidate_selected",
    *_EVENT_TYPES,
)
# Every target_type an event is actually logged with (see services/admin/events.py
# call sites): the block/unblock target ("user"), each table's csv_exported target,
# the audit log's own export, and the two aggregate reports.
_TARGET_TYPES = ("user", "colleges", "companies", "candidates", "drives", "partnerships",
                  "users", "audit_log", "application_funnel", "compensation")
_ACTOR_ROLES = ("admin", "college", "company", "candidate")
_RESULTS = ("success", "failure")

_AUDIT_COLUMNS = [
    ("event_type", "Event"), ("occurred_at", "When"), ("actor_role", "Actor role"),
    ("actor_label", "Actor"), ("target_type", "Target type"), ("target_label", "Target"),
    ("result", "Result"),
]


@router.get("/live-activity")
def live_activity(
    rng: DateRange = Depends(date_range),
    before: Optional[datetime] = Query(None, description="Keyset cursor: the oldest occurred_at already shown."),
    kind: Optional[str] = Query(None),
    limit: int = Query(30, ge=1, le=100),
):
    items = rpc("admin_activity_feed", {
        **rng.params(),
        "p_before": before.isoformat() if before else None,
        "p_kind": one_of(kind, _FEED_KINDS, "kind"),
        "p_limit": limit,
    }) or []
    return {"items": items, "has_more": len(items) == limit}


def _audit_params(
    rng: DateRange, search: Optional[str], event_type: Optional[str], actor_role: Optional[str],
    target_type: Optional[str], result: Optional[str], target_id: Optional[UUID],
) -> dict:
    return {
        **rng.params(),
        "p_search": clean_search(search),
        "p_event_type": one_of(event_type, _EVENT_TYPES, "event_type"),
        "p_actor_role": one_of(actor_role, _ACTOR_ROLES, "actor_role"),
        "p_target_type": one_of(target_type, _TARGET_TYPES, "target_type"),
        "p_result": one_of(result, _RESULTS, "result"),
        "p_target_id": str(target_id) if target_id else None,
        "p_sort": "created_at",
        "p_dir": "desc",
    }


@router.get("/audit-log")
def audit_log(
    rng: DateRange = Depends(date_range),
    page: Page = Depends(page_params),
    search: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    actor_role: Optional[str] = Query(None),
    target_type: Optional[str] = Query(None),
    result: Optional[str] = Query(None),
    target_id: Optional[UUID] = Query(None),
):
    params = _audit_params(rng, search, event_type, actor_role, target_type, result, target_id)
    return rpc_page("admin_list_events", params, page)


@router.get("/audit-log/export")
def export_audit_log(
    rng: DateRange = Depends(date_range),
    search: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    actor_role: Optional[str] = Query(None),
    target_type: Optional[str] = Query(None),
    result: Optional[str] = Query(None),
    target_id: Optional[UUID] = Query(None),
    admin: dict = Depends(require_admin_role),
):
    params = _audit_params(rng, search, event_type, actor_role, target_type, result, target_id)
    export_result = rpc_all("admin_list_events", params)
    log_event("csv_exported", actor_user_id=admin["id"], actor_role=admin["profile_role"], actor_label=admin["email"],
              target_type="audit_log", metadata={"rows": len(export_result.rows), "total": export_result.total, "truncated": export_result.truncated})
    return csv_response(export_result, _AUDIT_COLUMNS, "audit_log.csv")
