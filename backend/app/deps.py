from typing import Any, Dict, Optional
import os
from datetime import datetime, timezone
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


def _parse_ts(value: Optional[str]):
    """Parse a PostgREST timestamptz string. Never raises — an unparsable
    value is treated as "not a real deadline" rather than crashing the
    request (this only ever gates whether a block is CURRENTLY active)."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def is_currently_blocked(profile: Dict[str, Any]) -> bool:
    """A block is never a stored yes/no: permanent, or blocked_until still in
    the future. A temporary block therefore expires on its own the moment
    `blocked_until` passes — nothing needs to run to "unblock" it."""
    if profile.get("blocked_permanent"):
        return True
    until = _parse_ts(profile.get("blocked_until"))
    return until is not None and until > datetime.now(timezone.utc)


def block_message(profile: Dict[str, Any]) -> str:
    reason = (profile.get("blocked_reason") or "").strip()
    suffix = f" Reason: {reason}" if reason else ""
    if profile.get("blocked_permanent"):
        return f"This account has been suspended.{suffix}"
    until = profile.get("blocked_until")
    return f"This account is temporarily suspended until {until}.{suffix}"


def _reject_if_blocked(profile: Optional[Dict[str, Any]]) -> None:
    if profile and is_currently_blocked(profile):
        raise HTTPException(status_code=403, detail=block_message(profile))


def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Validate the Bearer token and return the authenticated user dict.
    Raises 401 if missing, invalid, or expired; 403 if the account is
    currently blocked (checked on EVERY authenticated request — an admin
    blocking someone takes effect on their very next call, not just their
    next login; see db/admin_portal_migration.sql, 6.0)."""
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

    try:
        block_row = (
            db_client.table("profiles")
            .select("blocked_permanent, blocked_until, blocked_reason")
            .eq("id", res.user.id)
            .limit(1)
            .execute()
        ).data
    except APIError:
        block_row = None  # a lookup hiccup never itself locks anyone out
    _reject_if_blocked(block_row[0] if block_row else None)

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


def require_admin_role(current_user: dict = Depends(get_current_user)) -> dict:
    """Assert the caller is an Admin portal user.

    The role comes from the `profiles` row via the service client — never from
    the JWT's user_metadata, which the account holder can edit. A missing
    profile is a 403 (not self-healed): admin accounts are provisioned, never
    created on first sign-in. Every /admin route depends on this.
    """
    try:
        res = db_client.table("profiles").select(
            "id, role"
        ).eq("id", current_user["id"]).single().execute()
    except APIError as e:
        raise HTTPException(status_code=403, detail=f"Profile lookup failed: {e.message}")

    role = (res.data or {}).get("role")
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    return {**current_user, "profile_role": role}


def require_candidate_role(current_user: dict = Depends(get_current_user)) -> dict:
    """Load the caller's profile, assert Candidate portal user, and attach the
    `domain` + `college_id` the student job board query needs.

    Mirrors require_company_role. Self-heals a missing profile row by treating
    the token's default role as candidate.
    """
    try:
        res = db_client.table("profiles").select(
            "id, role, domain, college_id"
        ).eq("id", current_user["id"]).single().execute()
    except APIError as e:
        if getattr(e, "code", None) == "PGRST116":  # no profile row yet
            return {**current_user, "profile_role": "candidate", "domain": None, "college_id": None}
        raise HTTPException(status_code=403, detail=f"Profile lookup failed: {e.message}")

    row = res.data or {}
    role = row.get("role", "candidate")
    if role != "candidate":
        raise HTTPException(status_code=403, detail="Candidate role required")

    return {
        **current_user,
        "profile_role": role,
        "domain": row.get("domain"),
        "college_id": row.get("college_id"),
    }
