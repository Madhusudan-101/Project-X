from typing import Optional
import os
from fastapi import Header, HTTPException, Depends
from dotenv import load_dotenv
from supabase import create_client, Client
from supabase_auth.errors import AuthApiError
from postgrest.exceptions import APIError

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment")

# Two separate clients so auth operations don't taint the DB client's
# internal auth state (which would cause RLS to kick in on DB queries).
auth_client = create_client(SUPABASE_URL, SUPABASE_KEY)   # for auth.sign_up, etc.
db_client = create_client(SUPABASE_URL, SUPABASE_KEY)     # for table() queries

# Legacy alias — routes import this
supabase = auth_client


def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Validate the Bearer token and return the authenticated user dict.
    Raises 401 if missing, invalid, or expired."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization.split(" ", 1)[1]
    try:
        res = auth_client.auth.get_user(token)
    except AuthApiError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e.message}")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")

    if not res or not res.user:
        raise HTTPException(status_code=401, detail="Invalid token")

    meta = res.user.user_metadata or {}
    return {
        "id": res.user.id,
        "email": res.user.email,
        "role": meta.get("role", "candidate"),
        "_token": token,
    }


SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or SUPABASE_KEY


def get_user_supabase(current_user: dict = Depends(get_current_user)) -> Client:
    """Return a Supabase client bound to the caller's JWT so RLS applies.

    Uses the anon key (or falls back to service key if unset) and injects the
    user's access token into PostgREST headers. This is the client every
    tenant-scoped query MUST use — the module-level `db_client` bypasses RLS.
    """
    token = current_user.get("_token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing user token")
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.postgrest.auth(token)
    return client


def get_current_tpo(current_user: dict = Depends(get_current_user)) -> dict:
    """Load the caller's profile via the service client, assert College portal user + college_id.

    Attaches `college_id` and `profile_role` to the returned dict.
    """
    try:
        res = db_client.table("profiles").select(
            "id, role, college_id"
        ).eq("id", current_user["id"]).single().execute()
    except APIError as e:
        raise HTTPException(status_code=403, detail=f"Profile lookup failed: {e.message}")

    row = res.data or {}
    role = row.get("role")
    college_id = row.get("college_id")

    if role != "college":
        raise HTTPException(status_code=403, detail="College role required")
    if not college_id:
        raise HTTPException(status_code=403, detail="College account is not linked to a college")

    return {**current_user, "college_id": college_id, "profile_role": role}
