"""Admin global search — /admin/search?q=

Colleges, companies, candidates and drives only (see admin_global_search()
for why applications aren't a fifth branch). Results are grouped by entity
type; the frontend debounces so not every keystroke hits the database.

Gated by require_admin_role PLUS, per entity type, the same view permission
its own module already requires — reusing the existing colleges.view /
companies.view / candidates.view / drives.view checks rather than inventing
a search-specific permission. This matters because the candidate branch's
subtitle is a real email address: a delegated admin with no candidates.view
at all must not be able to discover one by searching. A caller missing a
type's permission simply gets that group omitted, not a 403 for the whole
call, since a query legitimately spans types the caller may only partly
have access to. The candidate branch is also scope-aware: a candidates.view
scoped to specific colleges narrows search results the same way it narrows
/admin/candidates. Colleges/companies/drives carry no personal data (an
institution/company/job name), so they are gated but not scope-narrowed.
"""

from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, Query

from ...deps import require_admin_role
from ...services.admin.common import rpc
from ...services.admin.permissions import caller_scope

router = APIRouter(prefix="/admin/search", tags=["admin-search"], dependencies=[Depends(require_admin_role)])

_ENTITY_PERMISSION = {
    "college": "colleges.view", "company": "companies.view",
    "candidate": "candidates.view", "drive": "drives.view",
}


@router.get("")
def global_search(q: str = Query("", max_length=100), limit_per_type: int = Query(6, ge=1, le=20),
                   admin: dict = Depends(require_admin_role)):
    q = q.strip()
    if not q:
        return {"query": "", "groups": {}}

    params = {"p_query": q, "p_limit": limit_per_type}
    candidate_scope = caller_scope(admin, "candidates.view")
    if candidate_scope and not candidate_scope.global_:
        college_ids = candidate_scope.college_id_list()
        if college_ids:
            params["p_college_ids"] = college_ids

    rows = rpc("admin_global_search", params) or []
    groups: dict = defaultdict(list)
    for r in rows:
        entity_type = r["entity_type"]
        permission = _ENTITY_PERMISSION.get(entity_type)
        if permission and caller_scope(admin, permission) is None:
            continue
        groups[entity_type].append({"id": r["id"], "title": r["title"], "subtitle": r["subtitle"]})
    return {"query": q, "groups": dict(groups)}
