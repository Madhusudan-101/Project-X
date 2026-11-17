"""Create (or bring back in line) one Admin and one Super Admin login for local
testing. Safe to run again: accounts that already exist are left as they are
unless --reset-passwords is given.

    python seed_admin_accounts.py --project <supabase-project-ref> \\
        --admin-email admin@example.com --super-admin-email super@example.com

  --project   must equal the project ref in SUPABASE_URL (the subdomain of
              <ref>.supabase.co), so this can't run against whichever project
              .env happens to point at by accident.

Passwords are generated here, set through Supabase Auth (which stores only a
bcrypt hash) and written to the git-ignored file CREDENTIALS_FILE, never to the
terminal. To choose your own, set SEED_ADMIN_PASSWORD / SEED_SUPER_ADMIN_PASSWORD.

Each sign-in is tested at the end, so a success message means the login works.

For a real deployment use provision_admin.py instead: nobody but the mailbox
owner ever learns that password. Further delegated admins are created from the
Super Admin Portal.
"""

import argparse
import os
import secrets
import sys
from urllib.parse import urlparse

sys.path.append(os.path.dirname(__file__))

from fastapi import HTTPException  # noqa: E402
from postgrest.exceptions import APIError  # noqa: E402
from supabase_auth.errors import AuthApiError  # noqa: E402

from app.crud import get_profile_by_email, update_profile  # noqa: E402
from app.deps import SUPABASE_URL, admin_client, auth_client, db_client  # noqa: E402
from app.routers.shared.auth import PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH  # noqa: E402
from app.schemas import GrantPermissionIn  # noqa: E402
from app.services.admin.permissions import ALL_PERMISSIONS, grant_permission, has_permission  # noqa: E402
from app.services.admin.provisioning import provision_account  # noqa: E402

CREDENTIALS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".admin-seed-credentials")


class SeedError(Exception):
    """A problem to report in one line, with nothing half-done worth a traceback."""


def check_schema() -> None:
    """Fail before touching anything if the migrations these accounts need are missing."""
    try:
        db_client.table("profiles").select("is_super_admin").limit(1).execute()
        db_client.table("admin_user_permissions").select("id").limit(1).execute()
    except APIError as e:
        raise SeedError(
            f"The database is missing the Admin permission schema ({e.message}). Run "
            "db/admin_portal_migration.sql, then db/admin_permissions_migration.sql, in the "
            "Supabase SQL Editor, followed by: notify pgrst, 'reload schema';"
        )


def choose_password(env_var: str) -> str:
    password = os.environ.get(env_var) or secrets.token_urlsafe(18)
    if not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
        raise SeedError(f"{env_var} must be {PASSWORD_MIN_LENGTH}-{PASSWORD_MAX_LENGTH} characters.")
    return password


def ensure_account(email: str, *, first_name: str, last_name: str, is_super_admin: bool,
                   password: str, reset_password: bool) -> tuple[dict, bool]:
    """Returns (profile, password_was_set). An email that belongs to a non-admin
    account is refused: seeding must never promote someone's existing account."""
    profile = get_profile_by_email(email.strip().lower())
    if profile is None:
        try:
            provision_account(
                email=email, role="admin", first_name=first_name, last_name=last_name,
                is_super_admin=is_super_admin, password=password,
            )
        except HTTPException as e:
            raise SeedError(f"{email}: {e.detail}")
        return get_profile_by_email(email.strip().lower()), True

    if profile.get("role") != "admin":
        raise SeedError(f"{email} already belongs to a {profile.get('role')} account; use a different address.")
    if bool(profile.get("is_super_admin")) != is_super_admin:
        profile = update_profile(profile["id"], {"is_super_admin": is_super_admin})
    if reset_password:
        admin_client.auth.admin.update_user_by_id(profile["id"], {"password": password})
    return profile, reset_password


def grant_admin_permissions(admin_profile: dict, super_profile: dict) -> int:
    """The Admin gets the whole grantable catalog: everything in the Admin Portal.
    What stays Super-Admin-only (managing other admins) is not in the catalog."""
    actor = {"id": super_profile["id"], "email": super_profile["email"], "profile_role": "admin"}
    missing = sorted(p for p in ALL_PERMISSIONS if not has_permission(admin_profile["id"], p))
    for permission in missing:
        grant_permission(admin_profile["id"], GrantPermissionIn(permission=permission), actor)
    return len(missing)


def verify_login(email: str, password: str, is_super_admin: bool) -> None:
    """Sign in the way /auth/login does, then revoke that session straight away."""
    try:
        session = auth_client.auth.sign_in_with_password({"email": email, "password": password}).session
    except AuthApiError as e:
        raise SeedError(f"{email}: sign-in failed after seeding ({e.message}).")
    profile = get_profile_by_email(email.strip().lower()) or {}
    admin_client.auth.admin.sign_out(session.access_token, "local")
    if profile.get("role") != "admin" or bool(profile.get("is_super_admin")) != is_super_admin:
        raise SeedError(f"{email}: signed in, but the profile does not have the expected role.")


def write_credentials(entries: list[tuple[str, str, str]]) -> None:
    lines = [
        "# Local test credentials from seed_admin_accounts.py. Git-ignored; delete once saved.",
        "# Change a password: 'Forgot?' on the Admin sign-in page, or rerun with --reset-passwords.",
    ]
    lines += [f"{label}: {email} / {password}" for label, email, password in entries]
    fd = os.open(CREDENTIALS_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def seed(args: argparse.Namespace) -> None:
    host = urlparse(SUPABASE_URL).hostname or ""
    if host.split(".")[0] != args.project:
        raise SeedError(f"--project {args.project} does not match SUPABASE_URL ({host}); nothing was changed.")
    if args.admin_email.strip().lower() == args.super_admin_email.strip().lower():
        raise SeedError("The Admin and the Super Admin need different email addresses.")
    check_schema()

    admin_password = choose_password("SEED_ADMIN_PASSWORD")
    super_password = choose_password("SEED_SUPER_ADMIN_PASSWORD")

    super_profile, super_set = ensure_account(
        args.super_admin_email, first_name="Super", last_name="Admin", is_super_admin=True,
        password=super_password, reset_password=args.reset_passwords,
    )
    admin_profile, admin_set = ensure_account(
        args.admin_email, first_name="Portal", last_name="Admin", is_super_admin=False,
        password=admin_password, reset_password=args.reset_passwords,
    )
    granted = grant_admin_permissions(admin_profile, super_profile)
    print(f"Super Admin {super_profile['email']}: {'password set' if super_set else 'already existed, password unchanged'}.")
    print(f"Admin {admin_profile['email']}: {'password set' if admin_set else 'already existed, password unchanged'}; "
          f"{granted} permission(s) granted.")

    entries = []
    if super_set:
        verify_login(args.super_admin_email, super_password, True)
        entries.append(("Super Admin", super_profile["email"], super_password))
    if admin_set:
        verify_login(args.admin_email, admin_password, False)
        entries.append(("Admin", admin_profile["email"], admin_password))
    if entries:
        write_credentials(entries)
        print(f"Sign-in verified. Credentials are in {CREDENTIALS_FILE}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed an Admin and a Super Admin login for local testing.")
    parser.add_argument("--project", required=True, help="Supabase project ref, as in SUPABASE_URL")
    parser.add_argument("--admin-email", required=True)
    parser.add_argument("--super-admin-email", required=True)
    parser.add_argument("--reset-passwords", action="store_true", help="also replace the password of accounts that already exist")
    try:
        seed(parser.parse_args())
    except SeedError as e:
        print(f"Failed: {e}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
