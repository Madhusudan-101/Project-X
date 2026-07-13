"""Auth router — signup · login · logout · forgot · otp · reset · profile · company-signup.

Conventions
-----------
* Database columns are snake_case  (first_name, last_name).
* Frontend/JSON payloads are camelCase  (firstName, lastName).
* `map_profile` converts DB row → frontend-friendly dict.
"""

import base64
import json
import logging

from fastapi import APIRouter, HTTPException, Depends
from supabase_auth.errors import AuthApiError, AuthWeakPasswordError
from postgrest.exceptions import APIError

from ..deps import supabase, get_current_user
from ..schemas import (
    AuthIn, SignupIn, UserOut, SessionOut,
    ForgotIn, VerifyOtpIn, ResetIn, ProfileUpdateIn,
    CompanySignupIn, CompanySessionOut,
)
from ..crud import (
    upsert_profile, get_profile_by_id, update_profile,
    create_company, get_company_by_owner_id, get_profile_by_email,
)


log = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])



# ── Helpers ────────────────────────────────────────────────────────────

def map_profile(row: dict) -> dict:
    """Convert a DB profiles row (snake_case) to the UserOut shape (camelCase)."""
    return {
        "id": row.get("id", ""),
        "email": row.get("email", ""),
        "role": row.get("role", "candidate"),
        "name": row.get("name") or "",
        "firstName": row.get("first_name") or "",
        "lastName": row.get("last_name") or "",
        "onboarded": bool(row.get("onboarded", False)),
    }


def _ensure_profile(user_id: str, email: str, role: str,
                     name: str = "", first_name: str = "",
                     last_name: str = "") -> dict:
    """Get existing profile or create one. Returns the DB row dict."""
    profile = get_profile_by_id(user_id)
    if profile:
        return profile
    # Auto-create (self-heal) a missing profile row
    return upsert_profile(user_id, {
        "email": email,
        "role": role or "candidate",
        "name": name,
        "first_name": first_name,
        "last_name": last_name,
    }) or {}


# ── POST /auth/signup ──────────────────────────────────────────────────

@router.post("/signup", response_model=SessionOut)
def signup(payload: SignupIn):
    # Prevent duplicate registrations by checking profiles
    existing_profile = get_profile_by_email(payload.email)
    if existing_profile:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    first = payload.resolved_first_name or ""

    last = payload.resolved_last_name or ""

    try:
        res = supabase.auth.sign_up({
            "email": payload.email,
            "password": payload.password,
            "options": {
                "data": {
                    "role": payload.role,
                    "name": payload.name or f"{first} {last}".strip(),
                    "firstName": first,
                    "lastName": last,
                }
            },
        })
    except AuthWeakPasswordError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except AuthApiError as e:
        raise HTTPException(status_code=400, detail=e.message)

    user = res.user
    if not user:
        raise HTTPException(status_code=400, detail="Signup failed.")

    session = res.session  # None when email-confirm is ON

    # Persist profile row in public.profiles
    try:
        profile = upsert_profile(user.id, {
            "email": payload.email,
            "role": payload.role,
            "name": payload.name or f"{first} {last}".strip(),
            "first_name": first,
            "last_name": last,
        })
    except APIError as e:
        log.warning("Profile upsert failed for %s: %s", user.id, e)
        profile = None

    return {
        "user": map_profile(profile) if profile else {
            "id": user.id, "email": payload.email, "role": payload.role,
            "name": payload.name or "", "firstName": first, "lastName": last,
            "onboarded": False,
        },
        "token": session.access_token if session else "",
        "expiresAt": str(session.expires_at) if session and session.expires_at else "",
    }


# ── POST /auth/login ──────────────────────────────────────────────────

@router.post("/login", response_model=SessionOut)
def login(payload: AuthIn):
    try:
        res = supabase.auth.sign_in_with_password({
            "email": payload.email,
            "password": payload.password,
        })
    except AuthApiError as e:
        raise HTTPException(status_code=400, detail=e.message)

    session = res.session
    if not session:
        raise HTTPException(status_code=400, detail="Login failed: no session.")

    user = session.user

    # Ensure a profile row exists (self-heal if it was never created)
    try:
        profile = _ensure_profile(
            user.id,
            email=user.email or payload.email,
            role=payload.role,
        )
    except APIError as e:
        log.warning("Profile lookup/create failed for %s: %s", user.id, e)
        profile = None

    return {
        "user": map_profile(profile) if profile else {
            "id": user.id, "email": user.email or payload.email,
            "role": payload.role, "name": "", "firstName": "",
            "lastName": "", "onboarded": False,
        },
        "token": session.access_token,
        "expiresAt": str(session.expires_at) if session.expires_at else "",
    }


# ── POST /auth/logout ─────────────────────────────────────────────────

@router.post("/logout")
def logout():
    return {"ok": True}


# ── POST /auth/forgot ─────────────────────────────────────────────────

@router.post("/forgot")
def forgot_password(payload: ForgotIn):
    try:
        supabase.auth.reset_password_for_email(payload.email)
    except AuthApiError as e:
        raise HTTPException(status_code=400, detail=e.message)
    return {"ok": True}


# ── POST /auth/otp/verify ─────────────────────────────────────────────

@router.post("/otp/verify")
def verify_otp(payload: VerifyOtpIn):
    res = None
    for otp_type in ("signup", "recovery", "email"):
        try:
            res = supabase.auth.verify_otp({
                "email": payload.email,
                "token": payload.code,
                "type": otp_type,
            })
            break  # first success wins
        except AuthApiError:
            continue
        except Exception:
            continue

    if res is None:
        raise HTTPException(status_code=400, detail="Invalid or expired code.")

    token = res.session.access_token if res.session else ""
    return {"token": token}


# ── POST /auth/reset ──────────────────────────────────────────────────

@router.post("/reset")
def reset_password(payload: ResetIn):
    try:
        parts = payload.token.split(".")
        if len(parts) != 3:
            raise ValueError("Not a JWT")
        pad = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
        data = json.loads(base64.b64decode(pad))
        user_id = data.get("sub")
        if not user_id:
            raise ValueError("No sub claim")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reset token.")

    try:
        supabase.auth.admin.update_user_by_id(user_id, {"password": payload.password})
    except AuthApiError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Password reset failed: {e}")

    return {"ok": True}


# ── GET /auth/profile ──────────────────────────────────────────────────

@router.get("/profile", response_model=UserOut)
def get_profile_route(current_user: dict = Depends(get_current_user)):
    """Return the authenticated user's profile. Self-heals a missing row
    (e.g. right after email confirmation, before any profile write has landed)."""
    profile = _ensure_profile(
        current_user["id"],
        email=current_user["email"],
        role=current_user.get("role", "candidate"),
    )
    return map_profile(profile)


# ── PATCH /auth/profile ───────────────────────────────────────────────

@router.patch("/profile", response_model=UserOut)
def update_profile_route(
    payload: ProfileUpdateIn,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    email = current_user["email"]
    role = current_user.get("role", "candidate")

    # Build the DB update dict (camelCase → snake_case)
    update_data: dict = {}
    if payload.name is not None:
        update_data["name"] = payload.name
    if payload.firstName is not None:
        update_data["first_name"] = payload.firstName
    if payload.lastName is not None:
        update_data["last_name"] = payload.lastName
    if payload.onboarded is not None:
        update_data["onboarded"] = payload.onboarded

    try:
        existing = get_profile_by_id(user_id)
        if existing:
            # Normal partial update
            profile = update_profile(user_id, update_data)
        else:
            # Self-heal: create the row first, then apply updates
            profile = upsert_profile(user_id, {
                "email": email,
                "role": role,
                **update_data,
            })
    except APIError as e:
        log.warning("Profile update failed for %s: %s", user_id, e)
        raise HTTPException(status_code=400, detail=f"Database error: {e.message}")

    if not profile:
        raise HTTPException(status_code=400, detail="Failed to update profile.")

    return map_profile(profile)


# ── Helpers (company) ──────────────────────────────────────────────────

def map_company(row: dict) -> dict:
    """Convert a DB companies row → CompanyOut-compatible dict."""
    return {
        "id": row["id"],
        "owner_id": row["owner_id"],
        "name": row["name"],
        "industry": row["industry"],
        "size": row["size"],
        "hiring_domains": row.get("hiring_domains") or [],
        "website": row.get("website"),
        "logo_url": row.get("logo_url"),
        "is_verified": bool(row.get("is_verified", False)),
        "created_at": str(row.get("created_at", "")),
    }


# ── POST /auth/company-signup ──────────────────────────────────────────

@router.post("/company-signup", response_model=CompanySessionOut)
def company_signup(payload: CompanySignupIn):
    # Prevent duplicate registrations by checking profiles
    existing_profile = get_profile_by_email(payload.email)
    if existing_profile:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    """
    Atomic company registration:
      1. Create Supabase auth user (role=company in user_metadata)
      2. Upsert public.profiles row
      3. Insert public.companies row (idempotent — returns existing on duplicate)
      4. Return session + company profile

    Returns 400 on weak password or invalid email.
    The session.token will be empty if Supabase email confirmation is enabled;
    the frontend should redirect to /auth/otp or the email-verify page in that case.
    """
    first = payload.first_name.strip()

    last = payload.last_name.strip()
    full_name = f"{first} {last}".strip()

    # ── 1. Create Supabase auth user ─────────────────────────────────
    try:
        res = supabase.auth.sign_up({
            "email": payload.email,
            "password": payload.password,
            "options": {
                "data": {
                    "role": "company",
                    "name": full_name,
                    "firstName": first,
                    "lastName": last,
                }
            },
        })
    except AuthWeakPasswordError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except AuthApiError as e:
        # "User already registered" → 409 so the frontend can surface the right message
        if "already registered" in (e.message or "").lower():
            raise HTTPException(status_code=409, detail="An account with this email already exists.")
        raise HTTPException(status_code=400, detail=e.message)

    user = res.user
    if not user:
        raise HTTPException(status_code=400, detail="Signup failed — no user returned.")

    session = res.session  # None when Supabase email-confirm is ON

    # ── 2. Upsert profile row ────────────────────────────────────────
    try:
        profile = upsert_profile(user.id, {
            "email": payload.email,
            "role": "company",
            "name": full_name,
            "first_name": first,
            "last_name": last,
        })
    except APIError as e:
        log.warning("Profile upsert failed for %s: %s", user.id, e)
        profile = None

    # ── 3. Create company row (idempotent) ───────────────────────────
    try:
        existing = get_company_by_owner_id(user.id)
        if existing:
            company_row = existing
        else:
            company_row = create_company(user.id, {
                "name": payload.company_name,
                "industry": payload.industry,
                "size": payload.size,
                "hiring_domains": payload.hiring_domains,
            })
    except APIError as e:
        log.warning("Company creation failed for %s: %s", user.id, e)
        company_row = None

    # ── 4. Build response ────────────────────────────────────────────
    user_out = map_profile(profile) if profile else {
        "id": user.id,
        "email": payload.email,
        "role": "company",
        "name": full_name,
        "firstName": first,
        "lastName": last,
        "onboarded": False,
    }

    return {
        "user": user_out,
        "token": session.access_token if session else "",
        "expiresAt": str(session.expires_at) if session and session.expires_at else "",
        "company": map_company(company_row) if company_row else None,
    }
