"""Admin System Health — /admin/system-health

Only checks this backend can actually verify are shown as operational/
degraded/unavailable; everything else is reported "unknown" rather than
faked. This process has no background job runner (no Celery/APScheduler/etc.
in requirements.txt) and does not use Supabase Realtime anywhere in the
codebase, so those two are always "unknown" — not because the check failed,
but because there is nothing here to check.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends

from ...deps import admin_client, db_client, require_admin_role
from ...services.admin.permissions import require_permission

router = APIRouter(prefix="/admin/system-health", tags=["admin-system"], dependencies=[Depends(require_admin_role)])

# Same private-storage bucket resume PDF rendering uses
# (app/services/candidate/resume_pdf.py); duplicated as a literal here rather
# than importing that module's private constant across an unrelated feature.
_RESUME_BUCKET = "tailored-resumes"


def _timed_check(fn) -> Dict[str, Any]:
    start = time.monotonic()
    try:
        fn()
        return {"status": "operational", "latency_ms": round((time.monotonic() - start) * 1000)}
    except Exception as e:  # noqa: BLE001 — this endpoint's whole job is to report ANY failure, not classify it
        return {"status": "unavailable", "latency_ms": round((time.monotonic() - start) * 1000), "detail": str(e)[:200]}


@router.get("")
def system_health(admin: dict = Depends(require_permission("system.view"))):
    checks = {
        # True by construction: this handler is running, so the API answered.
        "api": {"status": "operational", "latency_ms": 0},
        "database": _timed_check(lambda: db_client.table("profiles").select("id").limit(1).execute()),
        "authentication": _timed_check(lambda: admin_client.auth.admin.list_users(page=1, per_page=1)),
        "storage": _timed_check(lambda: db_client.storage.get_bucket(_RESUME_BUCKET)),
        "realtime": {"status": "unknown", "detail": "Not used by this application."},
        "background_jobs": {"status": "unknown", "detail": "No background job runner is configured."},
    }
    overall = "operational"
    if any(c["status"] == "unavailable" for c in checks.values()):
        overall = "degraded" if checks["database"]["status"] == "operational" else "unavailable"
    return {"overall": overall, "checked_at": datetime.now(timezone.utc).isoformat(), "checks": checks}
