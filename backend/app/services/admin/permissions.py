"""Granular Admin permission system — catalog, grant/revoke, and the
`require_permission` FastAPI dependency that enforces them.

Sits on top of the existing role='admin' gate (require_admin_role in
deps.py) and the Super Admin flag (profiles.is_super_admin): a Super Admin
has unconditional full access; a delegated admin's access is exactly the
set of their non-expired rows in admin_user_permissions, each optionally
scoped to one college or company. See db/admin_permissions_migration.sql
for the schema and full design rationale.

There is no "revoked" flag on a grant — revoking deletes its row, and
admin_events (reused, not duplicated) is the history of every grant/revoke.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException, Request
from postgrest.exceptions import APIError

from ...crud import get_profile_by_id
from ...deps import db_client, require_admin_role
from .events import log_event

log = logging.getLogger(__name__)

GLOBAL_SCOPE_ID = "00000000-0000-0000-0000-000000000000"

# ── Catalog ──────────────────────────────────────────────────────────
# Every permission this backend actually enforces, grouped by the same
# module boundaries as the Admin Portal's own nav (AdminShell.tsx). Built
# from what each router's endpoints actually do — no permission here gates
# functionality that doesn't exist (e.g. no colleges.edit/delete: the Admin
# Portal has no such endpoints; no billing.edit: finance.py is read-only).
ALL_PERMISSIONS = frozenset({
    "analytics.view",
    "colleges.view", "colleges.create", "colleges.export",
    "companies.view", "companies.export",
    "candidates.view", "candidates.export",
    "drives.view", "drives.export",
    "partnerships.view", "partnerships.export",
    "users.view", "users.export", "users.block", "users.unblock",
    "audit.view", "audit.export",
    "alerts.view",
    "system.view",
    "reports.view", "reports.export",
    "billing.view",
})

# Which scope types a permission can be narrowed to, beyond 'global' — only
# where the existing data model actually has that single-resource shape
# (a college_id / company_id to filter by). Everything else is global-only:
# there is no single-resource meaning for "all users" or "the audit log".
SCOPABLE: Dict[str, tuple] = {
    "colleges.view": ("college",), "colleges.export": ("college",),
    "candidates.view": ("college",), "candidates.export": ("college",),
    "companies.view": ("company",), "companies.export": ("company",),
    "drives.view": ("college", "company"), "drives.export": ("college", "company"),
    "partnerships.view": ("college", "company"), "partnerships.export": ("college", "company"),
}

MODULE_LABELS = {
    "analytics": "Analytics", "colleges": "Colleges", "companies": "Companies",
    "candidates": "Candidates", "drives": "Drives", "partnerships": "Partnerships",
    "users": "Users & Access", "audit": "Audit & Activity", "alerts": "Alerts",
    "system": "System Health", "reports": "Reports", "billing": "Billing / Revenue",
}

_SCOPE_TABLE = {"college": "colleges", "company": "companies"}


def permission_catalog() -> List[Dict[str, Any]]:
    """Grouped by module, for the Admin Management UI's permission matrix."""
    by_module: Dict[str, List[str]] = {}
    for perm in sorted(ALL_PERMISSIONS):
        by_module.setdefault(perm.split(".", 1)[0], []).append(perm)
    return [
        {
            "module": m, "label": MODULE_LABELS.get(m, m), "permissions": perms,
            "scopable_as": sorted({s for p in perms for s in SCOPABLE.get(p, ())}),
        }
        for m, perms in by_module.items()
    ]


# ── Timestamps ───────────────────────────────────────────────────────

def _parse_ts(value: Optional[str]):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _is_active(grant: Dict[str, Any]) -> bool:
    expires = _parse_ts(grant.get("expires_at"))
    return expires is None or expires > datetime.now(timezone.utc)


def _public_grant(row: Dict[str, Any]) -> Dict[str, Any]:
    """API/UI shape: a global grant's scope_id is null, not the sentinel."""
    out = dict(row)
    if out.get("scope_type") == "global":
        out["scope_id"] = None
    out["is_active"] = _is_active(row)
    return out


# ── Grant lookup ─────────────────────────────────────────────────────

def list_grants(user_id: str, *, include_expired: bool = False) -> List[Dict[str, Any]]:
    try:
        rows = (
            db_client.table("admin_user_permissions").select("*").eq("user_id", user_id).execute()
        ).data or []
    except APIError as e:
        log.error("Permission lookup failed for %s: %s", user_id, e)
        raise HTTPException(status_code=500, detail="Failed to load permissions.")
    return rows if include_expired else [g for g in rows if _is_active(g)]


class Scope:
    """The access a caller's active grants of ONE permission add up to.
    `global=True` means unrestricted (a global grant is a strict superset of
    any scoped one, so its presence alone decides this). Otherwise
    `college_ids` / `company_ids` are the UNION of every scoped grant's
    resource id in that dimension — two grants of the same permission for
    two different colleges means access to both, not just one. An empty
    tuple in a dimension means "not restricted along that dimension" (no
    grant scoped that way), never "restricted to nothing"."""

    __slots__ = ("global_", "college_ids", "company_ids")

    def __init__(self, global_: bool, college_ids: tuple = (), company_ids: tuple = ()):
        self.global_ = global_
        self.college_ids = college_ids
        self.company_ids = company_ids

    def allows_resource(self, resource_id: str) -> bool:
        return self.global_ or resource_id in self.college_ids or resource_id in self.company_ids

    def college_id_list(self) -> Optional[List[str]]:
        """The permitted college ids to force into a p_college_ids filter, or
        None when unrestricted along this dimension (global, or every active
        grant of this permission is scoped some other way)."""
        return list(self.college_ids) if self.college_ids else None

    def company_id_list(self) -> Optional[List[str]]:
        return list(self.company_ids) if self.company_ids else None


def _scope_for(user_id: str, permission: str) -> Optional[Scope]:
    """None = no active grant of `permission` at all (caller has no access).
    Otherwise the combined Scope across every active grant of it — see Scope
    above. Expired grants are excluded by list_grants(); a revoked grant has
    no row at all, so it was never a candidate in the first place."""
    grants = [g for g in list_grants(user_id) if g["permission"] == permission]
    if not grants:
        return None
    if any(g["scope_type"] == "global" for g in grants):
        return Scope(global_=True)
    college_ids = tuple({g["scope_id"] for g in grants if g["scope_type"] == "college"})
    company_ids = tuple({g["scope_id"] for g in grants if g["scope_type"] == "company"})
    return Scope(global_=False, college_ids=college_ids, company_ids=company_ids)


def has_permission(user_id: str, permission: str) -> bool:
    return _scope_for(user_id, permission) is not None


def grants_for_display(user_id: str) -> List[Dict[str, Any]]:
    """Every grant (including expired ones — the UI shows them as expired,
    not as if they never existed) in the public API shape."""
    return [_public_grant(g) for g in list_grants(user_id, include_expired=True)]


def own_permissions(admin: Dict[str, Any]) -> Dict[str, Any]:
    """Used by GET /admin/me — what the CURRENT session can do, so the
    frontend can hide nav it has no access to (a convenience only; the
    backend is the actual gate, enforced by require_permission below)."""
    return {
        "id": admin["id"], "email": admin.get("email"),
        "is_super_admin": bool(admin.get("is_super_admin")),
        "permissions": [] if admin.get("is_super_admin") else [_public_grant(g) for g in list_grants(admin["id"])],
    }


# ── FastAPI dependencies (the actual enforcement) ───────────────────

def require_permission(permission: str, scope_param: Optional[str] = None):
    """FastAPI dependency: the caller must be an Admin (require_admin_role)
    AND either a Super Admin or hold `permission` (not expired, not revoked).
    If `scope_param` names a path parameter (e.g. "college_id") and the
    caller's grants for `permission` are scoped (not global), the requested
    resource must belong to at least one of the caller's permitted scopes —
    see Scope.allows_resource. Identity and permissions are derived ONLY
    from the authenticated session + database — nothing here trusts a
    client-supplied role, permission list, college_id, or user id.
    """
    assert permission in ALL_PERMISSIONS, f"Unknown permission: {permission!r}"

    def _dep(request: Request, admin: dict = Depends(require_admin_role)) -> dict:
        if admin.get("is_super_admin"):
            return {**admin, "_scope": None}

        scope = _scope_for(admin["id"], permission)
        if scope is None:
            raise HTTPException(status_code=403, detail=f"Missing permission: {permission}")

        if not scope.global_ and scope_param:
            requested = request.path_params.get(scope_param)
            if requested is not None and not scope.allows_resource(str(requested)):
                raise HTTPException(status_code=403, detail=f"Missing permission: {permission} for this resource")

        return {**admin, "_scope": None if scope.global_ else scope}

    return _dep


def require_super_admin(admin: dict = Depends(require_admin_role)) -> dict:
    """Managing OTHER admins' access is Super-Admin-exclusive — never a
    grantable permission. This is what makes 'a delegated admin can never
    grant themselves, or anyone else, a permission' true by construction:
    they cannot reach these routes at all, regardless of what they hold."""
    if not admin.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Super Admin access required.")
    return admin


def scope_college_ids(admin: dict) -> Optional[List[str]]:
    """None (unrestricted along this dimension) unless the grants that
    authorized THIS request include at least one scoped to a college. Route
    handlers that accept a college filter call this to FORCE the RPC's
    p_college_ids to the permitted set, overriding whatever the client
    asked for — never just one id, so two-college access isn't collapsed
    into one."""
    scope: Optional[Scope] = admin.get("_scope")
    return scope.college_id_list() if scope else None


def scope_company_ids(admin: dict) -> Optional[List[str]]:
    scope: Optional[Scope] = admin.get("_scope")
    return scope.company_id_list() if scope else None


def caller_scope(admin: dict, permission: str) -> Optional[Scope]:
    """Like require_permission, but never raises — for endpoints (e.g. global
    search) that combine several permissions' worth of data in one response
    and need to quietly omit what the caller can't see, rather than 403 the
    whole call. Returns None when the caller has no access to `permission`
    at all; Scope(global_=True) for a Super Admin or a global grant."""
    if admin.get("is_super_admin"):
        return Scope(global_=True)
    return _scope_for(admin["id"], permission)


# ── Grant / revoke (Super Admin only — enforced by the router's dependency) ──

def _profile(user_id: str) -> Dict[str, Any]:
    profile = get_profile_by_id(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found.")
    return profile


def _resource_exists(table: str, resource_id: str) -> bool:
    try:
        rows = db_client.table(table).select("id").eq("id", resource_id).limit(1).execute().data
    except APIError:
        return False
    return bool(rows)


def grant_permission(user_id: str, payload, actor: Dict[str, Any]) -> Dict[str, Any]:
    if payload.permission not in ALL_PERMISSIONS:
        raise HTTPException(status_code=422, detail=f"Unknown permission: {payload.permission}")
    target = _profile(user_id)
    if target.get("role") != "admin":
        raise HTTPException(status_code=422, detail="Permissions can only be granted to Admin accounts.")
    if target.get("is_super_admin"):
        raise HTTPException(status_code=409, detail="This account is already a Super Admin with full access.")

    scope_type = payload.scope_type or "global"
    if scope_type == "global":
        scope_id = GLOBAL_SCOPE_ID
    else:
        allowed = SCOPABLE.get(payload.permission, ())
        if scope_type not in allowed:
            raise HTTPException(status_code=422, detail=f"{payload.permission} cannot be scoped to {scope_type}.")
        if not payload.scope_id:
            raise HTTPException(status_code=422, detail="scope_id is required for a scoped permission.")
        scope_id = str(payload.scope_id)
        if not _resource_exists(_SCOPE_TABLE[scope_type], scope_id):
            raise HTTPException(status_code=404, detail=f"No {scope_type} with that id.")

    expires_at = None
    if payload.expires_at:
        parsed = _parse_ts(payload.expires_at)
        if not parsed:
            raise HTTPException(status_code=422, detail="expires_at must be an ISO 8601 instant.")
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        if parsed <= datetime.now(timezone.utc):
            raise HTTPException(status_code=422, detail="expires_at must be in the future.")
        expires_at = parsed.isoformat()

    try:
        # Re-granting the same (user, permission, scope) replaces it — e.g. to change the expiry.
        (
            db_client.table("admin_user_permissions").delete()
            .eq("user_id", user_id).eq("permission", payload.permission)
            .eq("scope_type", scope_type).eq("scope_id", scope_id).execute()
        )
        inserted = db_client.table("admin_user_permissions").insert({
            "user_id": user_id, "permission": payload.permission, "scope_type": scope_type,
            "scope_id": scope_id, "granted_by": actor["id"],
            "granted_at": datetime.now(timezone.utc).isoformat(), "expires_at": expires_at,
        }).execute().data
    except APIError as e:
        log.error("Grant failed for %s/%s: %s", user_id, payload.permission, e)
        raise HTTPException(status_code=500, detail="Could not save this permission.")

    log_event(
        "permission_granted", actor_user_id=actor["id"], actor_role=actor["profile_role"], actor_label=actor["email"],
        target_type="admin_permission", target_id=user_id, target_label=target.get("email"),
        metadata={"permission": payload.permission, "scope_type": scope_type,
                  "scope_id": None if scope_type == "global" else scope_id, "expires_at": expires_at},
    )
    row = inserted[0] if inserted else {
        "user_id": user_id, "permission": payload.permission, "scope_type": scope_type,
        "scope_id": scope_id, "granted_by": actor["id"], "expires_at": expires_at,
    }
    return _public_grant(row)


def revoke_permission(user_id: str, permission_id: str, actor: Dict[str, Any]) -> Dict[str, Any]:
    target = _profile(user_id)
    try:
        rows = (
            db_client.table("admin_user_permissions").select("*")
            .eq("id", permission_id).eq("user_id", user_id).limit(1).execute()
        ).data or []
    except APIError as e:
        log.error("Permission lookup failed for %s: %s", permission_id, e)
        raise HTTPException(status_code=500, detail="Could not load this permission.")
    if not rows:
        raise HTTPException(status_code=404, detail="Permission grant not found.")
    grant = rows[0]

    try:
        db_client.table("admin_user_permissions").delete().eq("id", permission_id).execute()
    except APIError as e:
        log.error("Revoke failed for %s: %s", permission_id, e)
        raise HTTPException(status_code=500, detail="Could not revoke this permission.")

    log_event(
        "permission_revoked", actor_user_id=actor["id"], actor_role=actor["profile_role"], actor_label=actor["email"],
        target_type="admin_permission", target_id=user_id, target_label=target.get("email"),
        metadata={"permission": grant["permission"], "scope_type": grant["scope_type"],
                  "scope_id": None if grant["scope_type"] == "global" else grant.get("scope_id")},
    )
    return {"revoked": True}


def revoke_all_permissions(user_id: str, actor: Dict[str, Any]) -> Dict[str, Any]:
    target = _profile(user_id)
    grants = list_grants(user_id, include_expired=True)
    try:
        db_client.table("admin_user_permissions").delete().eq("user_id", user_id).execute()
    except APIError as e:
        log.error("Revoke-all failed for %s: %s", user_id, e)
        raise HTTPException(status_code=500, detail="Could not revoke permissions.")

    for grant in grants:
        log_event(
            "permission_revoked", actor_user_id=actor["id"], actor_role=actor["profile_role"], actor_label=actor["email"],
            target_type="admin_permission", target_id=user_id, target_label=target.get("email"),
            metadata={"permission": grant["permission"], "scope_type": grant["scope_type"],
                      "scope_id": None if grant["scope_type"] == "global" else grant.get("scope_id"), "bulk": True},
        )
    return {"revoked_count": len(grants)}
