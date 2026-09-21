"""Create an Admin account. The only way to get one — there is no public admin
signup and the API cannot mint the first admin.

    python provision_admin.py --email you@company.com --first-name Ada --last-name Lovelace

The account is created with an unguessable password nobody sees, and a
"set your password" email is sent (Supabase password-recovery link). Needs
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment (backend/.env).
"""

import argparse
import os
import sys

sys.path.append(os.path.dirname(__file__))

from fastapi import HTTPException  # noqa: E402

from app.services.admin.provisioning import provision_account  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision an Admin account.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--first-name", required=True)
    parser.add_argument("--last-name", required=True)
    args = parser.parse_args()

    try:
        result = provision_account(
            email=args.email, role="admin",
            first_name=args.first_name.strip(), last_name=args.last_name.strip(),
        )
    except HTTPException as e:
        print(f"Failed: {e.detail}")
        return 1

    print(f"Admin account created (user id {result['user_id']}).")
    if result["invite_sent"]:
        print(f"A set-password email was sent to {args.email}.")
    else:
        print("The set-password email could not be sent — use 'Forgot password' on the "
              "Admin sign-in page to set a password.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
