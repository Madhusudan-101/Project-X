"""Controlled creation of Admin and College accounts.

Neither role can be obtained through public signup (see auth.py). They are
provisioned here — called by `POST /admin/colleges` for College accounts and by
`provision_admin.py` for Admin accounts — through one code path:

  1. create the Supabase auth user (email pre-confirmed, unguessable password
     that nobody ever sees),
  2. create its profiles row with the privileged role (and college link),
  3. email the owner the standard Supabase password-recovery link, which the
     app already turns into the "set a new password" screen.

Legacy accounts: before public College signup was closed, anyone could register
a `college` account with any email. Those accounts have no college link, so they
cannot use the portal — but whoever registered one still holds its password,
refresh tokens and any linked identity. Adopting such an account in place would
hand a College tenant to whoever squatted the address. It is therefore REPLACED:
the unlinked auth user (and, by cascade, its profile) is deleted and a fresh
account is created, so only the owner of the mailbox can set its password.

Uses `admin_client` (service role, never signed in as a user) for auth-admin
calls — see the note in deps.py.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any, Dict, Optional

from fastapi import HTTPException
from postgrest.exceptions import APIError
from supabase_auth.errors import AuthApiError

from ...crud import get_profile_by_email, upsert_profile
from ...deps import admin_client, supabase
from .events import log_event

log = logging.getLogger(__name__)

PROVISIONED_ROLES = ("admin", "college")


def _send_set_password_email(email: str) -> bool:
    try:
        supabase.auth.reset_password_for_email(email)
        return True
    except Exception as e:  # never fail provisioning over a mail hiccup
        # No address in the log line: it is personal data and the caller already knows it.
        log.warning("Set-password email could not be sent (%s)", type(e).__name__)
        return False


def _replace_unlinked_college_account(existing: Dict[str, Any]) -> None:
    """Delete an unlinked legacy College auth user (its profile cascades).

    Only ever called for role='college' with no college link — an account that
    cannot use any portal endpoint, so nothing of value is lost.
    """
    try:
        admin_client.auth.admin.delete_user(existing["id"])
    except AuthApiError as e:
        log.error("Could not remove unlinked College account %s: %s", existing["id"], e)
        raise HTTPException(
            status_code=502,
            detail="An unlinked College account already uses this email and could not be replaced; nothing was changed.",
        )


def provision_account(
    *,
    email: str,
    role: str,
    first_name: str,
    last_name: str,
    college_id: Optional[str] = None,
    actor: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create an account for a provisioned-only role.

    `actor` is the admin's `require_admin_role` dict, when there is one — the
    only caller without one is provision_admin.py, the CLI bootstrap script
    that creates the very first Admin account before any admin exists.

    Returns {"user_id", "created", "invite_sent", "replaced_legacy_account"}.
    Raises HTTPException: 422 bad input, 409 the email already belongs to
    another account, 502 the account could not be created (nothing is left behind).
    """
    if role not in PROVISIONED_ROLES:
        raise HTTPException(status_code=422, detail=f"role must be one of {PROVISIONED_ROLES}.")
    if role == "college" and not college_id:
        raise HTTPException(status_code=422, detail="A College account must be linked to a college.")

    email = email.strip().lower()
    name = f"{first_name} {last_name}".strip()

    replaced_legacy = False
    existing = get_profile_by_email(email)
    if existing:
        unlinked_legacy_college = (
            role == "college" and existing.get("role") == "college" and not existing.get("college_id")
        )
        if not unlinked_legacy_college:
            raise HTTPException(
                status_code=409,
                detail=f"This email is already registered as a {existing.get('role') or 'user'} account.",
            )
        _replace_unlinked_college_account(existing)
        replaced_legacy = True

    try:
        res = admin_client.auth.admin.create_user({
            "email": email,
            "password": secrets.token_urlsafe(32),
            "email_confirm": True,
            "user_metadata": {"role": role, "name": name, "firstName": first_name, "lastName": last_name},
        })
    except AuthApiError as e:
        # e.g. an auth user exists (maybe a candidate who never got a profile row).
        raise HTTPException(status_code=409, detail=e.message)
    user = res.user
    if not user:
        raise HTTPException(status_code=502, detail="Account creation failed.")

    try:
        upsert_profile(user.id, {
            "email": email,
            "role": role,
            "name": name,
            "first_name": first_name,
            "last_name": last_name,
            # Admins have no onboarding wizard; a College TPO still completes theirs.
            "onboarded": role == "admin",
            **({"college_id": college_id} if college_id else {}),
        })
    except APIError as e:
        # Don't leave an auth user with no profile behind.
        log.error("Profile creation failed for %s, rolling back auth user: %s", user.id, e)
        try:
            admin_client.auth.admin.delete_user(user.id)
        except Exception as rollback_err:
            log.error("Rollback of auth user %s failed: %s", user.id, rollback_err)
        raise HTTPException(status_code=502, detail="Account creation failed; nothing was created.")

    log_event(
        "account_provisioned",
        actor_user_id=(actor or {}).get("id"), actor_role=(actor or {}).get("profile_role", "admin"),
        actor_label=(actor or {}).get("email") or "provision_admin.py (bootstrap)",
        target_type="user", target_id=user.id, target_label=email,
        metadata={"role": role, "replaced_legacy_account": replaced_legacy},
    )
    return {
        "user_id": user.id,
        "created": True,
        "invite_sent": _send_set_password_email(email),
        "replaced_legacy_account": replaced_legacy,
    }
