"""Predefined Admin and Super Admin accounts.

`bootstrap_admin_accounts_from_env` runs when the API starts (see main.py) and
creates the accounts named by these environment variables, if they are set:

    BOOTSTRAP_ADMIN_EMAIL        BOOTSTRAP_ADMIN_PASSWORD         -> Admin Portal
    BOOTSTRAP_SUPER_ADMIN_EMAIL  BOOTSTRAP_SUPER_ADMIN_PASSWORD   -> Super Admin Portal

They are ordinary accounts in the existing system: a Supabase Auth user plus a
`profiles` row with role='admin' (and is_super_admin=true for the Super Admin),
created through `provision_account`, the same path every Admin account takes.

Safe on every restart. Each account is looked up by email first, so it is never
created twice, and an account that already exists keeps its password (someone may
have changed it with Forgot? on the sign-in page), its grants (a Super Admin may
have narrowed them) and its block state. Only the Super Admin flag is kept in line
with the variable it was configured under. An email that belongs to a candidate,
company or college account is refused, never promoted.

Passwords: hashed here with bcrypt and only the hash is sent to Supabase Auth,
which keeps bcrypt hashes anyway, so the plaintext never leaves this process and
is never logged. Supabase checks the strength of plaintext passwords (minimum 6
characters, and not configurable lower) but not of a supplied hash, so these
operator-chosen passwords are accepted whatever their length; a warning is logged
when one is shorter than the app's own 8-character policy.

seed_admin_accounts.py (local testing, generated passwords) uses the same
`ensure_admin_account` and `grant_full_catalog`.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional, Tuple

import bcrypt
from fastapi import HTTPException
from postgrest.exceptions import APIError

from ...crud import get_profile_by_email, update_profile
from ...deps import admin_client, db_client
from ...schemas import GrantPermissionIn
from .permissions import ALL_PERMISSIONS, grant_permission, has_permission
from .provisioning import provision_account

log = logging.getLogger(__name__)

# The app's own minimum for passwords people choose (routers/shared/auth.py).
RECOMMENDED_MIN_LENGTH = 8
BCRYPT_ROUNDS = 12


class AdminBootstrapError(Exception):
    """A problem to report in one line. The message never contains a password."""


def check_schema() -> None:
    """Fail before touching anything if the migrations these accounts need are missing."""
    try:
        db_client.table("profiles").select("is_super_admin").limit(1).execute()
        db_client.table("admin_user_permissions").select("id").limit(1).execute()
    except APIError as e:
        raise AdminBootstrapError(
            f"The database is missing the Admin permission schema ({e.message}). Run "
            "db/admin_portal_migration.sql, then db/admin_permissions_migration.sql, in the "
            "Supabase SQL Editor, followed by: notify pgrst, 'reload schema';"
        )


def hash_password(password: str) -> str:
    """A bcrypt hash in the `$2a$` form Supabase Auth verifies sign-ins against."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS, prefix=b"2a")).decode("ascii")


def ensure_admin_account(
    email: str,
    *,
    first_name: str,
    last_name: str,
    is_super_admin: bool,
    password: Optional[str] = None,
    password_hash: Optional[str] = None,
    reset_password: bool = False,
) -> Tuple[Dict[str, Any], bool]:
    """Create the Admin account if it is missing. Returns (profile, created).

    For a new account the password is `password_hash` if given, else `password`.
    An existing Admin account only has its Super Admin flag brought in line, plus
    its password replaced when `reset_password` is set (plaintext `password` only)."""
    email = email.strip().lower()
    profile = get_profile_by_email(email)
    if profile is None:
        try:
            provision_account(
                email=email, role="admin", first_name=first_name, last_name=last_name,
                is_super_admin=is_super_admin, password=password, password_hash=password_hash,
            )
        except HTTPException as e:
            raise AdminBootstrapError(f"{email}: {e.detail}")
        return get_profile_by_email(email), True

    if profile.get("role") != "admin":
        raise AdminBootstrapError(f"{email} already belongs to a {profile.get('role')} account; use a different address.")
    if bool(profile.get("is_super_admin")) != is_super_admin:
        profile = update_profile(profile["id"], {"is_super_admin": is_super_admin})
    if reset_password and password:
        admin_client.auth.admin.update_user_by_id(profile["id"], {"password": password})
    return profile, False


def grant_full_catalog(admin_profile: Dict[str, Any], actor: Dict[str, Any]) -> int:
    """Grant an Admin every permission in the grantable catalog, i.e. the whole Admin
    Portal. Managing other admins is not in the catalog, so it stays Super Admin only.
    Returns how many were missing."""
    missing = sorted(p for p in ALL_PERMISSIONS if not has_permission(admin_profile["id"], p))
    for permission in missing:
        grant_permission(admin_profile["id"], GrantPermissionIn(permission=permission), actor)
    return len(missing)


def _configured(prefix: str) -> Optional[Tuple[str, str]]:
    email = (os.environ.get(f"{prefix}_EMAIL") or "").strip()
    password = os.environ.get(f"{prefix}_PASSWORD") or ""
    if not email and not password:
        return None
    if not email or not password:
        raise AdminBootstrapError(f"{prefix}_EMAIL and {prefix}_PASSWORD must be set together.")
    if len(password) < RECOMMENDED_MIN_LENGTH:
        log.warning("%s_PASSWORD is shorter than %d characters. Use a longer one outside local testing.",
                    prefix, RECOMMENDED_MIN_LENGTH)
    return email, password


def bootstrap_admin_accounts() -> Dict[str, str]:
    """Create the configured accounts. Returns {email: "created" | "exists"}.
    Raises AdminBootstrapError with a one-line reason."""
    super_cfg = _configured("BOOTSTRAP_SUPER_ADMIN")
    admin_cfg = _configured("BOOTSTRAP_ADMIN")
    if not super_cfg and not admin_cfg:
        return {}
    if super_cfg and admin_cfg and super_cfg[0].lower() == admin_cfg[0].lower():
        raise AdminBootstrapError("The Admin and the Super Admin need different email addresses.")
    check_schema()

    result: Dict[str, str] = {}
    actor = {"id": None, "email": "startup account bootstrap", "profile_role": "admin"}
    if super_cfg:
        super_profile, created = ensure_admin_account(
            super_cfg[0], first_name="Super", last_name="Admin", is_super_admin=True,
            password_hash=hash_password(super_cfg[1]),
        )
        result[super_profile["email"]] = "created" if created else "exists"
        actor = {"id": super_profile["id"], "email": super_profile["email"], "profile_role": "admin"}
    if admin_cfg:
        admin_profile, created = ensure_admin_account(
            admin_cfg[0], first_name="Portal", last_name="Admin", is_super_admin=False,
            password_hash=hash_password(admin_cfg[1]),
        )
        # Only a new account gets the catalog: on later starts a Super Admin's
        # changes to this Admin's grants must stick.
        if created:
            grant_full_catalog(admin_profile, actor)
        result[admin_profile["email"]] = "created" if created else "exists"
    return result


def bootstrap_admin_accounts_from_env() -> None:
    """Start-up hook: never stops the API from starting, only logs what happened."""
    try:
        for email, outcome in bootstrap_admin_accounts().items():
            if outcome == "created":
                log.info("Predefined admin account %s created.", email)
            else:
                log.info("Predefined admin account %s already exists; left unchanged.", email)
    except AdminBootstrapError as e:
        log.error("Predefined admin accounts were not set up: %s", e)
    except Exception as e:  # network, Supabase outage: the API must still come up
        log.error("Predefined admin accounts were not set up (%s: %s)", type(e).__name__, e)
