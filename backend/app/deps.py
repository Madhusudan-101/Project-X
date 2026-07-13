from typing import Optional
import os
from fastapi import Depends, Header, HTTPException
from dotenv import load_dotenv
from supabase import create_client
from supabase_auth.errors import AuthApiError

load_dotenv(override=True)

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
    }


def require_company_role(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependency: raises 403 if the authenticated user is not a company HR."""
    if current_user.get("role") != "company":
        raise HTTPException(
            status_code=403,
            detail="This endpoint is restricted to Company accounts.",
        )
    return current_user
