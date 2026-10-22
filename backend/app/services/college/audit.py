"""Audit trail for College Portal actions.

A thin wrapper over the existing central log (services/admin/events.log_event -> public.admin_events),
so what a TPO does to the roster, campus drives, departments and onboarding shows up in the Admin
Portal's Audit Log next to what admins do, with the same actor / target / time / result columns.

Rules: one event per ACTION (an import of 5,000 rows is one event with counts); record what changed
(field names, counts), never credentials, tokens or whole records; and never let logging break the
action it describes — log_event already swallows its own database errors. Only successful actions are
logged here: a refused request (wrong role, wrong college) never reaches a handler.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from ..admin.events import log_event


def log_college_action(
    event_type: str,
    tpo: Dict[str, Any],
    *,
    target_type: str,
    target_id: Optional[str] = None,
    target_label: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    log_event(
        event_type,
        actor_user_id=tpo["id"], actor_role="college", actor_label=tpo.get("email"),
        target_type=target_type, target_id=target_id, target_label=target_label,
        metadata=metadata,
    )
