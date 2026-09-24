"""Admin Management — /admin/me · /admin/permissions/catalog · /admin/admin-users

Grants a Super Admin fine-grained, combinable control over what a delegated
admin can do in the Admin Portal, on top of the existing role='admin' gate.
See services/admin/permissions.py for the model.

Creating a delegated admin reuses services/admin/provisioning.provision_account
(role="admin") — the SAME path College accounts are created through; disabling
one reuses the EXISTING /admin/users/{id}/block · /unblock (services/admin/blocking.py)
— a "disabled delegated admin" is simply a blocked profiles row, enforced
everywhere by deps.get_current_user exactly like any other blocked account.
This router only adds what did not already exist: creating an admin account
from the Portal itself, and granting/revoking/viewing permissions.

Every mutating route here requires require_super_admin — a delegated admin
cannot reach any of them, at any permission level, which is what makes "a
delegated admin can never grant themselves or anyone else a permission" true
by construction rather than by an extra runtime check.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ...deps import require_admin_role
from ...schemas import CreateDelegatedAdminIn, GrantPermissionIn
from ...services.admin.common import rpc
from ...services.admin.permissions import (
    grant_permission,
    grants_for_display,
    own_permissions,
    permission_catalog,
    require_super_admin,
    revoke_all_permissions,
    revoke_permission,
)
from ...services.admin.provisioning import provision_account

router = APIRouter(prefix="/admin", tags=["admin-permissions"])


@router.get("/me")
def me(admin: dict = Depends(require_admin_role)):
    """The current session's own admin identity + permissions — a
    convenience for the frontend to decide what to render. Not itself an
    authorization boundary: every route still enforces its own permission."""
    return own_permissions(admin)


@router.get("/permissions/catalog")
def catalog(admin: dict = Depends(require_admin_role)):
    """Every permission this backend understands, grouped by module — read-only
    reference data for the Admin Management UI's matrix. Any admin can read
    it (it names no user or grant), but only a Super Admin can act on it."""
    return {"modules": permission_catalog()}


@router.post("/admin-users", status_code=201)
def create_delegated_admin(payload: CreateDelegatedAdminIn, admin: dict = Depends(require_super_admin)):
    """Create a delegated Admin account with NO permissions yet — grant them
    afterwards via POST /admin/admin-users/{user_id}/permissions. Reuses the
    same provisioning path as College accounts (services/admin/provisioning)."""
    result = provision_account(
        email=payload.email, role="admin",
        first_name=payload.first_name.strip(), last_name=payload.last_name.strip(),
        actor=admin, is_super_admin=False,
    )
    return result


@router.get("/admin-users/{user_id}/permissions")
def get_permissions(user_id: str, admin: dict = Depends(require_admin_role)):
    """A Super Admin can view any admin's permissions; a delegated admin can
    only view their own (a low-risk convenience, not a management capability)."""
    if not admin.get("is_super_admin") and user_id != admin["id"]:
        raise HTTPException(status_code=403, detail="Super Admin access required.")
    grants = grants_for_display(user_id)
    history = rpc("admin_list_events", {
        "p_from": None, "p_to": None, "p_search": None, "p_event_type": None,
        "p_actor_role": None, "p_target_type": "admin_permission", "p_result": None,
        "p_target_id": user_id, "p_sort": "created_at", "p_dir": "desc",
        "p_limit": 100, "p_offset": 0,
    }) or []
    return {"user_id": user_id, "permissions": grants, "history": history}


@router.post("/admin-users/{user_id}/permissions", status_code=201)
def grant(user_id: str, payload: GrantPermissionIn, admin: dict = Depends(require_super_admin)):
    return grant_permission(user_id, payload, admin)


@router.post("/admin-users/{user_id}/permissions/{permission_id}/revoke")
def revoke(user_id: str, permission_id: str, admin: dict = Depends(require_super_admin)):
    """POST, not DELETE — every other mutation in the Admin Portal API (block,
    unblock, provision) is POST; this matches that, rather than being the one
    DELETE verb in the whole surface."""
    return revoke_permission(user_id, permission_id, admin)


@router.post("/admin-users/{user_id}/permissions/revoke-all")
def revoke_all(user_id: str, admin: dict = Depends(require_super_admin)):
    return revoke_all_permissions(user_id, admin)
