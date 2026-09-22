"""Admin global search — /admin/search?q=

Colleges, companies, candidates and drives only (see admin_global_search()
for why applications aren't a fifth branch). Results are grouped by entity
type; the frontend debounces so not every keystroke hits the database.
"""

from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, Query

from ...deps import require_admin_role
from ...services.admin.common import rpc

router = APIRouter(prefix="/admin/search", tags=["admin-search"], dependencies=[Depends(require_admin_role)])


@router.get("")
def global_search(q: str = Query("", max_length=100), limit_per_type: int = Query(6, ge=1, le=20)):
    q = q.strip()
    if not q:
        return {"query": "", "groups": {}}
    rows = rpc("admin_global_search", {"p_query": q, "p_limit": limit_per_type}) or []
    groups: dict = defaultdict(list)
    for r in rows:
        groups[r["entity_type"]].append({"id": r["id"], "title": r["title"], "subtitle": r["subtitle"]})
    return {"query": q, "groups": dict(groups)}
