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
