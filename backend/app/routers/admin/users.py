"""Admin Users & Access — /admin/users

List / detail / CSV export are read-only aggregates from `admin_list_users`.
Block / unblock are the only two mutations: everything else about a user
(role, college/company link) is set at provisioning time (see colleges.py /
provision_admin.py) and never edited here. Hard delete is intentionally NOT
offered — see the module docstring in services/admin/blocking.py.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ...crud import list_applications_for_student
from ...deps import require_admin_role
from ...schemas import BlockUserIn, UnblockUserIn
from ...services.admin.blocking import block_user, unblock_user
from ...services.admin.common import (
    DateRange, Page, clean_search, clean_sort, csv_response, date_range, one_of,
    page_params, rpc, rpc_all, rpc_one, rpc_page,
)
from ...services.admin.events import log_event

router = APIRouter(prefix="/admin/users", tags=["admin-users"], dependencies=[Depends(require_admin_role)])

_SORTS = ("name", "email", "role", "created_at", "last_activity")
_ROLES = ("admin", "college", "company", "candidate")
_STATUSES = ("active", "blocked")

_EXPORT_COLUMNS = [
    ("name", "Name"), ("email", "Email"), ("role", "Role"),
    ("college_name", "College"), ("company_name", "Company"),
    ("created_at", "Registered"), ("is_blocked", "Blocked"),
    ("blocked_permanent", "Permanently blocked"), ("blocked_until", "Blocked until"),
    ("blocked_reason", "Block reason"), ("last_activity", "Last activity"),
]


def _list_params(
    rng: DateRange, search: Optional[str], role: Optional[str], status: Optional[str],
    sort: Optional[str], direction: str,
) -> dict:
    key, direction = clean_sort(sort, direction, _SORTS, "created_at")
    return {
        **rng.params(),
        "p_search": clean_search(search),
        "p_role": one_of(role, _ROLES, "role"),
        "p_status": one_of(status, _STATUSES, "status"),
        "p_user_id": None,
        "p_sort": key,
        "p_dir": direction,
    }


@router.get("")
def list_users(
    rng: DateRange = Depends(date_range),
    page: Page = Depends(page_params),
    search: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
):
    return rpc_page("admin_list_users", _list_params(rng, search, role, status, sort, dir), page)


@router.get("/export")
def export_users(
    rng: DateRange = Depends(date_range),
    search: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    sort: Optional[str] = Query(None),
    dir: str = Query("desc"),
    admin: dict = Depends(require_admin_role),
):
    result = rpc_all("admin_list_users", _list_params(rng, search, role, status, sort, dir))
    log_event("csv_exported", actor_user_id=admin["id"], actor_role=admin["profile_role"], actor_label=admin["email"],
              target_type="users", metadata={"rows": len(result.rows), "total": result.total, "truncated": result.truncated})
    return csv_response(result, _EXPORT_COLUMNS, "users.csv")


# Registered after /export so "export" is never captured as a user id.
@router.get("/{user_id}")
def user_detail(user_id: str, rng: DateRange = Depends(date_range)):
    row = rpc_one("admin_list_users", {
        **rng.params(), "p_search": None, "p_role": None, "p_status": None,
        "p_user_id": user_id, "p_sort": "created_at", "p_dir": "asc",
    })
    if not row:
        raise HTTPException(status_code=404, detail="User not found.")

    applications: list = []
    drives: dict = {"items": [], "total": 0, "page": 1, "page_size": 10}
    if row["role"] == "candidate":
        applications = list_applications_for_student(user_id)[:25]
    elif row["role"] == "company" and row.get("company_id"):
        drives = rpc_page("admin_list_drives", {
            **rng.params(), "p_search": None, "p_status": None,
            "p_company_id": row["company_id"], "p_college_id": None,
            "p_sort": "created_at", "p_dir": "desc",
        }, Page(1, 10))
    elif row["role"] == "college" and row.get("college_id"):
        drives = rpc_page("admin_list_drives", {
            **rng.params(), "p_search": None, "p_status": None,
            "p_company_id": None, "p_college_id": row["college_id"],
            "p_sort": "created_at", "p_dir": "desc",
        }, Page(1, 10))

    audit = rpc("admin_list_events", {
        "p_from": None, "p_to": None, "p_search": None, "p_event_type": None,
        "p_actor_role": None, "p_target_type": "user", "p_result": None,
        "p_target_id": user_id, "p_sort": "created_at", "p_dir": "desc",
        "p_limit": 25, "p_offset": 0,
    }) or []

    return {"user": row, "applications": applications, "drives": drives, "audit": audit}


@router.post("/{user_id}/block")
def block_user_route(user_id: str, payload: BlockUserIn, admin: dict = Depends(require_admin_role)):
    return block_user(user_id, payload, admin)


@router.post("/{user_id}/unblock")
def unblock_user_route(user_id: str, payload: UnblockUserIn, admin: dict = Depends(require_admin_role)):
    return unblock_user(user_id, payload, admin)
