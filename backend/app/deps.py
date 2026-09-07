from typing import Optional
import os
from fastapi import Header, HTTPException, Depends
from dotenv import load_dotenv
from supabase import create_client, Client, ClientOptions
from supabase_auth.errors import AuthApiError
from postgrest.exceptions import APIError

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment")

# Two separate clients so auth operations don't taint the DB client's
# internal auth state (which would cause RLS to kick in on DB queries).
#
# `auth_client` is ONE module-level client shared across every concurrent
# request. The gotrue library defaults to auto_refresh_token=True /
# persist_session=True, which means every sign_up / sign_in_with_password /
# verify_otp / refresh_session call would mutate one shared "current session"
# slot and reschedule one shared background refresh timer. When that timer
# fired it would rotate whichever unrelated user's refresh token happened to
# be sitting in the slot — single-use tokens, so that user's next real
# /auth/refresh would then be rejected as "already used", causing random
# logouts under concurrency. Every route already uses the returned
# res.session / res.user directly and nothing here relies on the client's
# ambient session, so disabling both is safe and removes the race entirely.
_AUTH_CLIENT_OPTIONS = ClientOptions(auto_refresh_token=False, persist_session=False)
auth_client = create_client(SUPABASE_URL, SUPABASE_KEY, options=_AUTH_CLIENT_OPTIONS)
db_client = create_client(SUPABASE_URL, SUPABASE_KEY)     # for table() queries

# Dedicated client for `auth.admin.*` (service-role-only) operations.
#
# supabase-py registers `_listen_to_auth_events` on every create_client(), and
# that callback rewrites the client's shared `Authorization` header to the
# CURRENT user's access_token on every SIGNED_IN / TOKEN_REFRESHED event — the
# `admin` sub-client reads that same header dict by reference. So on the shared
# `auth_client`, the first `sign_in_with_password` / `verify_otp` /
# `refresh_session` from any request leaves a plain user JWT in that header, and
# every later `admin.update_user_by_id` call is then sent as that user instead
# of as service-role → Supabase replies 403 "User not allowed". This client is
# NEVER used for sign-in/verify/refresh, so its header stays pinned to the
# service-role key and admin calls always authorize correctly.
admin_client = create_client(SUPABASE_URL, SUPABASE_KEY, options=_AUTH_CLIENT_OPTIONS)

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


def require_company_role(current_user: dict = Depends(get_current_user)) -> dict:
    """Load the caller's profile via the service client, assert Company portal user.

    Mirrors get_current_tpo. Attaches `profile_role` to the returned dict.
    """
    try:
        res = db_client.table("profiles").select(
            "id, role"
        ).eq("id", current_user["id"]).single().execute()
    except APIError as e:
        raise HTTPException(status_code=403, detail=f"Profile lookup failed: {e.message}")

    row = res.data or {}
    role = row.get("role")

    if role != "company":
        raise HTTPException(status_code=403, detail="Company role required")

    return {**current_user, "profile_role": role}
