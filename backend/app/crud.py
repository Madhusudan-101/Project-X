"""Database helpers for the profiles table.

Uses db_client (a dedicated Supabase client) so that auth operations
on the auth_client don't taint the DB client's auth context / RLS.
"""

from typing import Dict, Any, Optional
from postgrest.exceptions import APIError
from .deps import db_client


def upsert_profile(user_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Insert or update a profile row.  Requires at least email + role for inserts."""
    res = db_client.table("profiles").upsert({"id": user_id, **payload}).execute()
    return res.data[0] if res.data else None


def get_profile_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    """Return a single profile dict, or None if not found."""
    try:
        res = db_client.table("profiles").select("*").eq("id", user_id).single().execute()
        return res.data
    except APIError as e:
        if e.code == "PGRST116":  # 0 rows → profile doesn't exist
            return None
        raise


def update_profile(user_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Partial update of an existing profile row."""
    if not payload:
        return get_profile_by_id(user_id)
    res = db_client.table("profiles").update(payload).eq("id", user_id).execute()
    return res.data[0] if res.data else None


def get_profile_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Return a single profile dict by email, or None if not found."""
    res = db_client.table("profiles").select("*").eq("email", email).limit(1).execute()
    return res.data[0] if res.data else None


# ── Companies ────────────────────────────────────────────────────────────

def create_company(owner_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    res = db_client.table("companies").insert({"owner_id": owner_id, **payload}).execute()
    return res.data[0] if res.data else None


def get_company_by_owner_id(owner_id: str) -> Optional[Dict[str, Any]]:
    res = db_client.table("companies").select("*").eq("owner_id", owner_id).limit(1).execute()
    return res.data[0] if res.data else None


def update_company(owner_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not payload:
        return get_company_by_owner_id(owner_id)
    res = db_client.table("companies").update(payload).eq("owner_id", owner_id).execute()
    return res.data[0] if res.data else None


# ── Job roles ────────────────────────────────────────────────────────────

def create_role(company_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    res = db_client.table("job_roles").insert({"company_id": company_id, **payload}).execute()
    return res.data[0] if res.data else None


def get_role_by_id(role_id: str, company_id: str) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("job_roles")
        .select("*")
        .eq("id", role_id)
        .eq("company_id", company_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def list_roles_by_company(company_id: str, status: Optional[str] = None) -> list:
    query = db_client.table("job_roles").select("*").eq("company_id", company_id)
    if status is not None:
        query = query.eq("status", status)
    res = query.order("created_at", desc=True).execute()
    return res.data or []


def update_role(role_id: str, company_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not payload:
        return get_role_by_id(role_id, company_id)
    res = (
        db_client.table("job_roles")
        .update(payload)
        .eq("id", role_id)
        .eq("company_id", company_id)
        .execute()
    )
    return res.data[0] if res.data else None


def delete_role(role_id: str, company_id: str) -> bool:
    res = (
        db_client.table("job_roles")
        .delete()
        .eq("id", role_id)
        .eq("company_id", company_id)
        .execute()
    )
    return bool(res.data)
