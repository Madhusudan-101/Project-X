"""Central event/audit log writer — public.admin_events.

Every INSERT here goes through the service-role `db_client`, same as the rest
of the codebase; RLS on the table denies anon/authenticated entirely (see
db/admin_portal_migration.sql, 6.1), so this module is the only writer.

Logging never breaks the action it describes: a failure here is caught and
logged to the application log instead of raised, mirroring the existing
`_send_set_password_email` pattern in services/admin/provisioning.py.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from postgrest.exceptions import APIError

from ...deps import db_client

log = logging.getLogger(__name__)

# Event types this backend actually emits. Kept as a single source of truth
# (used by log_event's assertion and worth grepping) rather than a free string
# at every call site — matches the "no event type the code doesn't emit"
# instruction: nothing in this list is aspirational.
EVENT_TYPES = frozenset({
    "user_login",
    "account_provisioned",
    "user_blocked",
    "user_unblocked",
    "csv_exported",
    "report_generated",
    "permission_granted",
    "permission_revoked",
})


def log_event(
    event_type: str,
    *,
    actor_user_id: Optional[str] = None,
    actor_role: Optional[str] = None,
    actor_label: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    target_label: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    result: str = "success",
) -> None:
    assert event_type in EVENT_TYPES, f"Unregistered event type: {event_type!r}"
    assert result in ("success", "failure")
    try:
        db_client.table("admin_events").insert({
            "event_type": event_type,
            "actor_user_id": actor_user_id,
            "actor_role": actor_role,
            "actor_label": actor_label,
            "target_type": target_type,
            "target_id": target_id,
            "target_label": target_label,
            "metadata": metadata or {},
            "result": result,
        }).execute()
    except APIError as e:
        log.warning("Could not record %s event (%s): %s", event_type, result, e)
