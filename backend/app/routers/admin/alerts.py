"""Admin Alerts — /admin/alerts

Computed live from current data on every call (see admin_alerts() for exactly
which conditions are covered and why); nothing is stored, so there is no
"stale alert" and no job keeping it correct. There is therefore no
persistent per-admin dismiss either — see AlertsPanel.tsx on the frontend
for the (session-local, non-persistent) alternative and why.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ...deps import require_admin_role
from ...services.admin.common import rpc
from ...services.admin.permissions import require_permission

router = APIRouter(prefix="/admin/alerts", tags=["admin-alerts"], dependencies=[Depends(require_admin_role)])


@router.get("")
def list_alerts(admin: dict = Depends(require_permission("alerts.view"))):
    return {"items": rpc("admin_alerts", {}) or []}
