"""Admin moderation of PeerMeet reports — /admin/peer-safety

  GET  /admin/peer-safety/reports?status=open   the queue
  GET  /admin/peer-safety/reports/{id}          evidence, both people, the reported person's history
  POST /admin/peer-safety/reports/{id}/resolve  dismiss | warn | suspend | lift
"""
from __future__ import annotations

from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from ...deps import db_client, require_admin_role
from ...services import peer_safety as safety
from ...services.admin.events import log_event
from ...services.admin.permissions import require_permission

router = APIRouter(prefix="/admin/peer-safety", tags=["admin-peer-safety"], dependencies=[Depends(require_admin_role)])

STATUSES = ("open", "reviewing", "actioned", "dismissed")


class ResolveIn(BaseModel):
    action: str  # dismiss | warn | suspend | lift
    days: Optional[int] = Field(default=None, ge=1, le=365)
    note: str = Field(default="", max_length=1000)


def _people(ids: list[str]) -> dict:
    ids = list({i for i in ids if i})
    if not ids:
        return {}
    rows = db_client.table("profiles").select("id, name, first_name, last_name, email").in_("id", ids).execute().data or []
    out = {}
    for r in rows:
        name = r.get("name") or " ".join(x for x in (r.get("first_name"), r.get("last_name")) if x).strip()
        out[r["id"]] = {"id": r["id"], "name": name or None, "email": r.get("email")}
    return out


@router.get("/reports")
def list_reports(
    status: str = Query(default="open"),
    limit: int = Query(default=50, ge=1, le=200),
    admin: dict = Depends(require_permission("peer_safety.view")),
) -> dict:
    if status != "all" and status not in STATUSES:
        raise HTTPException(status_code=422, detail="Unknown status")
    q = db_client.table("peer_user_reports").select("id, reporter_id, reported_id, room_id, reason, status, source, created_at")
    if status != "all":
        q = q.eq("status", status)
    rows = q.order("created_at", desc=True).limit(limit).execute().data or []
    people = _people([r["reporter_id"] for r in rows] + [r["reported_id"] for r in rows])
    return {"items": [
        {**r, "reporter": people.get(r["reporter_id"]), "reported": people.get(r["reported_id"])} for r in rows
    ]}


@router.get("/reports/{report_id}")
def report_detail(report_id: str = Path(..., min_length=8), admin: dict = Depends(require_permission("peer_safety.view"))) -> dict:
    found = db_client.table("peer_user_reports").select("*").eq("id", report_id).execute().data or []
    if not found:
        raise HTTPException(status_code=404, detail="Report not found")
    r = found[0]
    people = _people([r["reporter_id"], r["reported_id"]])
    history = db_client.table("peer_user_reports").select("id, reporter_id, reason, status, created_at").eq("reported_id", r["reported_id"]).execute().data or []
    sanctions = db_client.table("peer_sanctions").select("*").eq("student_id", r["reported_id"]).order("created_at", desc=True).execute().data or []
    return {
        **r,
        "reporter": people.get(r["reporter_id"]),
        "reported": people.get(r["reported_id"]),
        "history": {
            "total_reports": len(history),
            "distinct_reporters": len({h["reporter_id"] for h in history}),
            "reports": [h for h in history if h["id"] != r["id"]],
        },
        "sanctions": sanctions,
        "active_suspension": bool(safety.active_suspension(r["reported_id"])),
    }


@router.post("/reports/{report_id}/resolve")
def resolve_report(
    body: ResolveIn,
    report_id: str = Path(..., min_length=8),
    admin: dict = Depends(require_permission("peer_safety.resolve")),
) -> dict:
    found = db_client.table("peer_user_reports").select("*").eq("id", report_id).execute().data or []
    if not found:
        raise HTTPException(status_code=404, detail="Report not found")
    r = found[0]
    reported = r["reported_id"]
    note = body.note.strip()
    ts = safety.now().isoformat()

    if body.action == "dismiss":
        status = "dismissed"
    elif body.action == "warn":
        status = "actioned"
        db_client.table("peer_sanctions").insert({
            "student_id": reported, "kind": "warning", "reason": note or "Warning from a peer-safety review",
            "report_id": r["id"], "created_by": admin["id"],
        }).execute()
    elif body.action == "suspend":
        if not body.days:
            raise HTTPException(status_code=422, detail="Choose how many days to suspend for.")
        status = "actioned"
        db_client.table("peer_sanctions").insert({
            "student_id": reported, "kind": "suspension", "reason": note or "Suspended after a peer-safety review",
            "ends_at": (safety.now() + timedelta(days=body.days)).isoformat(),
            "report_id": r["id"], "created_by": admin["id"],
        }).execute()
    elif body.action == "lift":
        status = "dismissed"
        db_client.table("peer_sanctions").update({"lifted_at": ts}).eq("student_id", reported).eq("kind", "suspension").is_("lifted_at", "null").execute()
    else:
        raise HTTPException(status_code=422, detail="Unknown action")

    db_client.table("peer_user_reports").update({
        "status": status, "resolution_note": note or None, "reviewed_by": admin["id"], "reviewed_at": ts,
    }).eq("id", r["id"]).execute()
    log_event(
        "peer_report_resolved", actor_user_id=admin["id"], actor_role="admin", target_type="peer_report",
        target_id=r["id"], metadata={"action": body.action, "days": body.days, "reported_id": reported},
    )
    return {"ok": True, "status": status}
