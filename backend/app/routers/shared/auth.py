"""Auth router — signup · login · logout · forgot · otp · reset · profile.

Conventions
-----------
* Database columns are snake_case  (first_name, last_name).
* Frontend/JSON payloads are camelCase  (firstName, lastName).
* `map_profile` converts DB row → frontend-friendly dict.
"""

import logging
import time

from fastapi import APIRouter, HTTPException, Depends
from supabase_auth.errors import AuthApiError, AuthWeakPasswordError
from postgrest.exceptions import APIError

from ...deps import supabase, admin_client, get_current_user
from ...schemas import (
    AuthIn, SignupIn, UserOut, SessionOut,
    ForgotIn, VerifyOtpIn, ResetIn, ProfileUpdateIn, RefreshIn,
    CompanySignupIn, OAuthSessionIn, SetPasswordIn,
)
from ...crud import (
    upsert_profile, get_profile_by_id, update_profile, get_profile_by_email,
    create_company, get_company_by_owner_id, find_or_create_college_by_name,
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
        "skills": row.get("skills") or [],
        "interestedRoles": row.get("interested_roles") or [],
        "collegeName": row.get("college_name"),
        "graduationYear": row.get("graduation_year"),
        "domain": row.get("domain"),
        "collegeId": row.get("college_id"),
        "degree": row.get("degree"),
        "branch": row.get("branch"),
        "cgpa": (float(row["cgpa"]) if row.get("cgpa") is not None else None),
        "nationality": row.get("nationality"),
        "needsSponsorship": row.get("needs_sponsorship"),
        "sponsorshipCountry": row.get("sponsorship_country"),
        "gender": row.get("gender"),
        "preferredLocations": row.get("preferred_locations") or [],
        "willingToRelocate": row.get("willing_to_relocate"),
    }


def _check_signup_conflict(email: str, role: str) -> None:
    """Reject signup if this email is already registered under a different role."""
    try:
        existing = get_profile_by_email(email)
    except APIError as e:
        log.warning("Profile lookup by email failed for %s: %s", email, e)
        return
    if existing and existing.get("role") and existing["role"] != role:
        raise HTTPException(
            status_code=409,
            detail=f"This email is already registered as a {existing['role']} account.",
        )


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


def _set_password_with_retry(user_id: str, password: str) -> None:
    """Set a user's password via the service-role admin API.

    Uses `admin_client` (never `supabase`/`auth_client`): the shared auth
    client's `Authorization` header gets rewritten to the last signed-in
    user's JWT by supabase-py's auth-state listener, which made
    admin.update_user_by_id intermittently return 403 "User not allowed"
    depending on which request touched the client last. `admin_client` is
    only ever used for admin calls, so its header stays the service-role key.

    The short retry is kept only for genuinely transient upstream 5xx/network
    blips; a real permanent failure (weak password, bad user id) fails
    identically every attempt and still raises after the last one."""
    delays = [1, 2, 4]
    for i, delay in enumerate(delays):
        try:
            admin_client.auth.admin.update_user_by_id(user_id, {"password": password})
            return
        except AuthApiError:
            if i == len(delays) - 1:
                raise
            time.sleep(delay)


# ── POST /auth/signup ──────────────────────────────────────────────────

@router.post("/signup", response_model=SessionOut)
def signup(payload: SignupIn):
    first = payload.resolved_first_name or ""
    last = payload.resolved_last_name or ""

    _check_signup_conflict(payload.email, payload.role)

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
        "refreshToken": session.refresh_token if session else "",
        "expiresAt": str(session.expires_at) if session and session.expires_at else "",
    }


# ── POST /auth/company-signup ───────────────────────────────────────────

@router.post("/company-signup")
def company_signup(payload: CompanySignupIn):
    """Atomic HR account + company registration. No institutional-email
    restriction — any valid email is accepted for company accounts."""
    _check_signup_conflict(payload.email, "company")

    try:
        res = supabase.auth.sign_up({
            "email": payload.email,
            "password": payload.password,
            "options": {
                "data": {
                    "role": "company",
                    "name": f"{payload.first_name} {payload.last_name}".strip(),
                    "firstName": payload.first_name,
                    "lastName": payload.last_name,
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

    try:
        profile = upsert_profile(user.id, {
            "email": payload.email,
            "role": "company",
            "name": f"{payload.first_name} {payload.last_name}".strip(),
            "first_name": payload.first_name,
            "last_name": payload.last_name,
        })
    except APIError as e:
        log.warning("Profile upsert failed for %s: %s", user.id, e)
        profile = None

    # The company row is not optional — an HR account with no company is
    # unusable and there is no other code path that can create one later
    # (name/industry/size are only ever collected here). So this is a hard
    # failure, with a short retry for the same transient APIError flakiness
    # `_set_password_with_retry` already guards against, and a reconcile read
    # in case an earlier attempt actually landed despite raising.
    company = get_company_by_owner_id(user.id)
    if company is None:
        company_payload = {
            "name": payload.company_name,
            "industry": payload.industry,
            "size": payload.size,
            "hiring_domains": payload.hiring_domains,
        }
        for i, delay in enumerate((1, 2, 4)):
            try:
                company = create_company(user.id, company_payload)
                break
            except APIError as e:
                log.warning("Company creation attempt %d failed for %s: %s", i + 1, user.id, e)
                time.sleep(delay)
        if company is None:
            company = get_company_by_owner_id(user.id)
    if company is None:
        raise HTTPException(
            status_code=502,
            detail="Your account was created but company setup failed. "
                   "Please sign in and try again, or contact support.",
        )

    return {
        "user": map_profile(profile) if profile else {
            "id": user.id, "email": payload.email, "role": "company",
            "name": f"{payload.first_name} {payload.last_name}".strip(),
            "firstName": payload.first_name, "lastName": payload.last_name,
            "onboarded": False,
        },
        "token": session.access_token if session else "",
        "refreshToken": session.refresh_token if session else "",
        "expiresAt": str(session.expires_at) if session and session.expires_at else "",
        "company": company,
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

    if profile and profile.get("role") and profile["role"] != payload.role:
        raise HTTPException(
            status_code=403,
            detail=f"This account is registered as a {profile['role']} account, not {payload.role}.",
        )

    return {
        "user": map_profile(profile) if profile else {
            "id": user.id, "email": user.email or payload.email,
            "role": payload.role, "name": "", "firstName": "",
            "lastName": "", "onboarded": False,
        },
        "token": session.access_token,
        "refreshToken": session.refresh_token,
        "expiresAt": str(session.expires_at) if session.expires_at else "",
    }


# ── POST /auth/refresh ─────────────────────────────────────────────────

@router.post("/refresh", response_model=SessionOut)
def refresh_session_route(payload: RefreshIn):
    """Exchange a refresh_token for a new access_token, called by the
    frontend's request() client when an API call comes back 401 with an
    expired-JWT error, so a stale session doesn't just die."""
    try:
        res = supabase.auth.refresh_session(payload.refreshToken)
    except AuthApiError as e:
        raise HTTPException(status_code=401, detail=e.message)

    session = res.session
    if not session:
        raise HTTPException(status_code=401, detail="Refresh failed: no session.")

    user = session.user
    role = (user.user_metadata or {}).get("role", "candidate")

    try:
        profile = _ensure_profile(user.id, email=user.email or "", role=role)
    except APIError as e:
        log.warning("Profile lookup/create failed for %s: %s", user.id, e)
        profile = None

    return {
        "user": map_profile(profile) if profile else {
            "id": user.id, "email": user.email or "", "role": role,
            "name": "", "firstName": "", "lastName": "", "onboarded": False,
        },
        "token": session.access_token,
        "refreshToken": session.refresh_token,
        "expiresAt": str(session.expires_at) if session.expires_at else "",
    }


# ── POST /auth/oauth-session ────────────────────────────────────────────

@router.post("/oauth-session", response_model=SessionOut)
def oauth_session_route(payload: OAuthSessionIn):
    """Complete a Google (or other Supabase OAuth provider) sign-in. The
    frontend already has a valid Supabase session from its own client-side
    OAuth redirect (Supabase JS handles that hop directly with Google) —
    this verifies that token, creates the profiles row on first sign-in
    (same self-heal as email/password), and returns the same SessionOut
    shape used everywhere else in the app."""
    try:
        res = supabase.auth.get_user(payload.accessToken)
    except AuthApiError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e.message}")

    if not res or not res.user:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = res.user
    if not user.email:
        raise HTTPException(status_code=400, detail="Google account has no email.")

    meta = user.user_metadata or {}
    full_name = meta.get("full_name") or meta.get("name") or ""
    name_parts = full_name.split(" ", 1)
    first = name_parts[0] if name_parts else ""
    last = name_parts[1] if len(name_parts) > 1 else ""

    _check_signup_conflict(user.email, payload.role)

    try:
        profile = _ensure_profile(
            user.id, email=user.email, role=payload.role,
            name=full_name, first_name=first, last_name=last,
        )
    except APIError as e:
        log.warning("Profile lookup/create failed for %s: %s", user.id, e)
        profile = None

    if profile and profile.get("role") and profile["role"] != payload.role:
        raise HTTPException(
            status_code=403,
            detail=f"This account is registered as a {profile['role']} account, not {payload.role}.",
        )

    return {
        "user": map_profile(profile) if profile else {
            "id": user.id, "email": user.email, "role": payload.role,
            "name": full_name, "firstName": first, "lastName": last,
            "onboarded": False,
        },
        "token": payload.accessToken,
        "refreshToken": payload.refreshToken,
        "expiresAt": payload.expiresAt,
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

@router.post("/otp/verify", response_model=SessionOut)
def verify_otp(payload: VerifyOtpIn):
    # This endpoint only ever verifies signup confirmation codes — password
    # recovery is a link-based flow (see /auth/forgot) and never lands here.
    # Depending on the project's "Confirm email" template, Supabase classifies
    # the first email as type "signup" or "email", so both are tried; "recovery"
    # is deliberately NOT tried, so a stray recovery code can't be silently
    # consumed here and a bad signup code fails cleanly.
    res = None
    last_error: Exception | None = None
    for otp_type in ("signup", "email"):
        try:
            res = supabase.auth.verify_otp({
                "email": payload.email,
                "token": payload.code,
                "type": otp_type,
            })
            break  # first success wins
        except Exception as e:
            last_error = e
            continue

    if res is None:
        log.info("OTP verify failed for %s: %s", payload.email, last_error)
        raise HTTPException(status_code=400, detail="Invalid or expired code.")

    session = res.session
    if not session:
        return {
            "user": {"id": "", "email": payload.email, "role": "candidate",
                      "name": "", "firstName": "", "lastName": "", "onboarded": False},
            "token": "", "refreshToken": "", "expiresAt": "",
        }

    user = session.user
    role = (user.user_metadata or {}).get("role", "candidate")

    try:
        profile = _ensure_profile(user.id, email=user.email or payload.email, role=role)
    except APIError as e:
        log.warning("Profile lookup/create failed for %s: %s", user.id, e)
        profile = None

    return {
        "user": map_profile(profile) if profile else {
            "id": user.id, "email": user.email or payload.email, "role": role,
            "name": "", "firstName": "", "lastName": "", "onboarded": False,
        },
        "token": session.access_token,
        "refreshToken": session.refresh_token,
        "expiresAt": str(session.expires_at) if session.expires_at else "",
    }


# ── POST /auth/otp/resend ─────────────────────────────────────────────

@router.post("/otp/resend")
def resend_otp(payload: ForgotIn):
    """Re-send the signup confirmation code. (Password-reset codes are
    re-sent by calling /auth/forgot again.)"""
    try:
        supabase.auth.resend({"type": "signup", "email": payload.email})
    except AuthApiError as e:
        raise HTTPException(status_code=400, detail=e.message)
    return {"ok": True}


# ── POST /auth/reset ──────────────────────────────────────────────────

@router.post("/reset")
def reset_password(payload: ResetIn):
    # Verify the recovery token the same way get_current_user does — a real
    # signature/expiry check against Supabase. The old code just decoded the
    # JWT payload segment for `sub` without verifying anything, so any
    # JWT-shaped string with a `sub` claim could reset any account's password.
    try:
        res = supabase.auth.get_user(payload.token)
    except AuthApiError as e:
        raise HTTPException(status_code=400, detail=f"Invalid reset token: {e.message}")
    if not res or not res.user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")
    user_id = res.user.id

    try:
        _set_password_with_retry(user_id, payload.password)
    except AuthApiError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Password reset failed: {e}")

    return {"ok": True}


# ── POST /auth/set-password ─────────────────────────────────────────────

@router.post("/set-password")
def set_password_route(
    payload: SetPasswordIn,
    current_user: dict = Depends(get_current_user),
):
    """One-time password set for the currently authenticated account —
    used right after Google sign-in, since OAuth accounts never have a
    password at all until this runs."""
    try:
        _set_password_with_retry(current_user["id"], payload.password)
    except AuthWeakPasswordError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except AuthApiError as e:
        raise HTTPException(status_code=400, detail=e.message)
    return {"ok": True}


# ── GET /auth/profile ───────────────────────────────────────────────────

@router.get("/profile", response_model=UserOut)
def get_profile_route(current_user: dict = Depends(get_current_user)):
    """Used by /auth/confirm (Supabase's legacy hash-based email-confirmation
    redirect) to fetch the profile for a freshly-verified access token."""
    profile = _ensure_profile(current_user["id"], email=current_user["email"], role=current_user.get("role", "candidate"))
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
    if payload.skills is not None:
        update_data["skills"] = payload.skills
    if payload.interestedRoles is not None:
        update_data["interested_roles"] = payload.interestedRoles
    if payload.collegeName is not None:
        update_data["college_name"] = payload.collegeName
        # Also resolve to a real public.colleges row so restricted-job
        # visibility can match on profiles.college_id.
        try:
            college_id = find_or_create_college_by_name(payload.collegeName)
            if college_id:
                update_data["college_id"] = college_id
        except APIError as e:
            log.warning("Could not resolve college '%s' for %s: %s", payload.collegeName, user_id, e)
    if payload.graduationYear is not None:
        update_data["graduation_year"] = payload.graduationYear
    if payload.domain is not None:
        if payload.domain not in ("tech", "non-tech"):
            raise HTTPException(status_code=422, detail="domain must be 'tech' or 'non-tech'.")
        update_data["domain"] = payload.domain
    if payload.degree is not None:
        update_data["degree"] = payload.degree
    if payload.branch is not None:
        update_data["branch"] = payload.branch
    # ── Stable candidate identity (job_drives_migration.sql, 1.6) ──
    if payload.cgpa is not None:
        update_data["cgpa"] = payload.cgpa
    if payload.nationality is not None:
        update_data["nationality"] = payload.nationality
    if payload.needsSponsorship is not None:
        update_data["needs_sponsorship"] = payload.needsSponsorship
    if payload.sponsorshipCountry is not None:
        update_data["sponsorship_country"] = payload.sponsorshipCountry
    if payload.gender is not None:
        update_data["gender"] = payload.gender
    if payload.preferredLocations is not None:
        update_data["preferred_locations"] = payload.preferredLocations
    if payload.willingToRelocate is not None:
        update_data["willing_to_relocate"] = payload.willingToRelocate

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
