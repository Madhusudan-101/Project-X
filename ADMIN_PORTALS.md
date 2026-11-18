# Admin and Super Admin portals

Setup, how the two portals work, and the results of the authentication and functional audit.

## Setup on your Supabase project

**1. Run two SQL files**, in this order, in the Supabase SQL Editor (paste each file, then Run):

1. `backend/db/admin_portal_migration.sql`
2. `backend/db/admin_permissions_migration.sql`

Then run `notify pgrst, 'reload schema';`

Until this is done every `/admin` request fails, and the portal says which migration is missing. Both files are safe to re-run.

> The second file makes every account that is already an Admin a Super Admin, once. The project has 2 such accounts today, so both become Super Admins. Check they are people you trust with that.

**2. Create the two logins.** Either way works; both use the same code.

*Predefined accounts, created when the API starts.* Add to `backend/.env` (git-ignored):

```
BOOTSTRAP_ADMIN_EMAIL=...
BOOTSTRAP_ADMIN_PASSWORD=...
BOOTSTRAP_SUPER_ADMIN_EMAIL=...
BOOTSTRAP_SUPER_ADMIN_PASSWORD=...
```

On start-up (`app/services/admin/bootstrap.py`) each account is created if its email has no account yet: a Supabase Auth user plus a `profiles` row, the Admin with the full grantable catalog. The password is hashed with bcrypt in the backend and only the hash is sent to Supabase Auth. Restarts are safe: an existing account is never duplicated and keeps its current password, grants and block state. An email that belongs to a candidate, company or college account is refused. Missing migrations, or Supabase being unreachable, are logged and the API starts anyway. Passwords are never logged. One shorter than 8 characters is accepted, with a warning in the log.

*Or generated passwords, from `backend/`:*

```bash
.venv/Scripts/python seed_admin_accounts.py --project iddgszqqlncvbmzacbsg --admin-email YOUR_ADMIN_EMAIL --super-admin-email YOUR_SUPER_ADMIN_EMAIL
```

The script generates strong passwords, sets them through Supabase Auth (only a bcrypt hash is stored), tests that each one can really sign in, and writes them to `backend/.admin-seed-credentials`. That file is git-ignored and nothing is printed to the terminal. Delete it once the passwords are saved somewhere safe.

- `--project` must match `SUPABASE_URL`, so it can't run against the wrong project by accident.
- Safe to rerun. An email that already belongs to a candidate, company or college account is refused, never promoted.
- To choose passwords yourself, set `SEED_ADMIN_PASSWORD` and `SEED_SUPER_ADMIN_PASSWORD` first.

**3. Start the app:** `.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000` in `backend/`, `npm run dev` in `frontend/`. The frontend reads `frontend/.env.local` (git-ignored) to find the API.

**4. Sign in** at `/auth/login?role=admin` (Portals, then Admin) with either account.

**Changing a password:** use **Forgot?** on the sign-in page (needs the Site URL and redirect URLs set in Supabase Auth), or rerun the seed command with `--reset-passwords`.

**Real deployments:** use `provision_admin.py` instead. It emails a set-password link, so nobody but the mailbox owner ever knows the password.

## How it works

| | Admin | Super Admin |
|---|---|---|
| Stored as | `role='admin'` | `role='admin'` and `is_super_admin=true` |
| Lands on | `/admin` | `/super-admin` |
| Can do | What their grants allow | Everything, plus managing other admins |
| Look | Unchanged indigo | Gold frame, gold-and-dark theme, SUPER ADMIN PORTAL banner |

Both portals render the same pages, so a fix to one is a fix to both. Each account has exactly one portal: a Super Admin on an `/admin` URL is moved to the same page under `/super-admin`, and anyone else on `/super-admin` is sent away.

**The backend is the source of truth at every step:**

1. `POST /auth/login` reads the `profiles` row and answers with `portal`. The login page redirects from that response.
2. Before rendering anything, the portal calls `GET /admin/me` and shows only a spinner until it answers. The value in `localStorage` is never what grants access.
3. Every `/admin` API request re-reads the role, Super Admin flag, block state and grants from the database.

**Seeded Admin permissions:** the whole grantable catalog. Managing other admins is not in the catalog, so it stays Super Admin only by construction.

## Security audit

| Check | Result | Evidence |
|---|---|---|
| Password hashing and verification | Pass | Supabase Auth (bcrypt). No password in app tables, source or logs. |
| Login, invalid credentials | Fixed | One message for wrong password, unknown email and unconfirmed email. |
| Email enumeration | Fixed | Signup used to reveal that an address was an admin account. |
| Logout | **Fixed** | `/auth/logout` did nothing, and no portal called it. A copied token kept working after Sign out. Sessions are now revoked in all portals. |
| JWT validation | Pass | Every request is checked against Supabase. Forged tokens get 401 on all routes. |
| Cookies | Not applicable | Tokens are kept in `localStorage`, not cookies. See open items. |
| Role-based access on the API | Pass | Every `/admin` route tested with no token, a forged token, 3 other roles and an Admin with no grants. |
| Direct URL to dashboards | Pass | Anonymous, wrong role and Admin on `/super-admin` are all redirected. |
| Frontend tampering | **Fixed** | Editing `localStorage` used to render the portal shell. Nothing renders now until the backend confirms. |
| Super Admin via token metadata | Pass | `user_metadata` claims are ignored. |
| Super Admin via profile update | Pass | `PATCH /auth/profile` ignores it, and a database trigger blocks it through the public API. |
| Privilege escalation between admins | **Fixed** | A delegated admin could re-enable an admin a Super Admin had disabled, or lock out a peer. |
| Self-promotion guard surviving a re-run | **Fixed** | Re-running the portal migration silently removed the `is_super_admin` guard. |
| Blocked accounts | Fixed | Admin routes no longer depend on a lookup that fails open. |
| Session expiry | Pass | An expired token renews silently, a revoked one returns to sign-in. |
| Refresh | Pass | Both portals survive a hard reload. |
| Back button after logout | **Fixed** | About 1 in 4 times it could strand the page on a spinner. Passed 12 of 12 after the fix. |
| Public anon key on hosted Supabase | Pass | Gets no rows from any of the 10 tables probed. Admin functions are unreachable. |

## Functional audit

Tested in Chrome on the real FastAPI app and frontend, with Supabase replaced by the repo's in-memory fake. Separately, 29 read requests ran against your hosted data with the auth check bypassed in a local test process (no sign-in, nothing written): all returned 200, and field names matched the frontend's types on all 10 list types. CSV exports were left out of that run because each one writes an audit event.

| Area | Works | Notes |
|---|---|---|
| Admin and Super Admin dashboards | Yes | KPIs, trends, activity, alerts |
| Colleges | Yes | List, search, filters, add (validation, duplicate email), detail, suspend, reactivate, export |
| Students (Candidates) | Yes | List, search, filters, export. **Read-only by design:** roster editing lives in the College Portal |
| Companies, Partnerships | Yes | **Read-only by design:** the API has no write endpoints for them |
| Users & Access | Yes | List, search, filters, detail, block, unblock, export. Hard delete is deliberately not offered |
| Admin Management | Yes | Create, grant, revoke, disable, re-enable. Delegated admins see **My permissions** instead |
| Departments, Placement analytics | Yes | |
| Live Activity, Audit Log, Alerts, System Health, Reports | Yes | |
| Peer safety | Yes | API tests pass. Its browser spec needs PeerMeet and was not run |
| Financial overview | Shows N/A | No data source exists yet, and the page says so |
| Loading, empty, error states | Yes | Includes Try again recovery and an Admin with no grants |

### Test results

| Suite | Result |
|---|---|
| Backend, pytest | 1134 passed, 69 failed. All 69 fail the same way before this work and are Windows-only: the code judge needs the Unix `resource` module, and `tzdata` isn't installed |
| Backend, `test_admin_portal_api.py` | 295 of 295 |
| SQL migrations on real PostgreSQL | 187 of 187, including re-running over the older functions |
| Frontend, vitest | 418 of 418 |
| TypeScript and production build | Clean |
| Browser, Chrome | 149 of 153. The 4 failures are in the candidate portal and fail identically on the original code (open item 6) |

Six deliberately reintroduced bugs (a dropped permission check, the Super Admin gate, the admin-target guard, session revocation, portal routing, the block re-check) were each caught by the new tests.

Not run: the OA, AI interview and PeerMeet browser specs, which are outside these portals.

### Defects found and fixed

- **Stale Admin Management table:** disabling an admin left the row saying Active.
- **Block reason carried over:** text typed and cancelled for one person pre-filled the next person's dialog, so it could reach the audit log against the wrong account.
- **Permissions form carried over** between admins in the same way.
- **Audit Log showed a raw code** for `peer_report_resolved`.
- **Migration would have broken 6 working endpoints:** re-running it over the older functions created duplicate overloads. Reproduced on real Postgres before fixing.
- **A failed migration looked like a permissions error:** the portal now names the missing migration.
- **Google sign-in was offered on the Admin login,** which could create an auth user for an unknown visitor. Removed.

## Open items

Not changed. In rough priority order:

1. **Not yet verified against real Supabase Auth.** Sign-in and session revocation were tested on the fake only. After setup, sign in, sign out, and confirm a copied token stops working.
2. **Password change needs no current password.** `/auth/reset` accepts any valid access token, not just a recovery token, and `/auth/set-password` is not one-time. A stolen session can therefore take over the account.
3. **No login rate limit in the app.** Only Supabase's own limits apply, and all logins reach it from the backend's single IP.
4. **Tokens are in `localStorage`,** so any XSS could read them. `httpOnly` cookies would be a larger change. No MFA for admins either.
5. **Logged-in RLS not tested.** The anon key is locked down, but checking what a signed-in user can read needs an account. Run the two check queries at the top of `backend/db/profiles_rls_migration.sql`.
6. **Candidate page hydration mismatch.** React rebuilds the page on load, which swallows early clicks, such as opening the Jobs tab. This is what fails the 4 browser tests above.
7. **Other hosted migrations are missing** (non-admin features): `ai_interview_hiring`, `ai_interview_integrity`, `ai_interview_lifecycle`, `linkedin_analysis`, `online_assessment_feedback`, `online_assessment_precheck`.
8. **`jobs` and `job_drives` RLS policies recurse.** Direct REST calls get a 500. It fails closed and the backend is unaffected.
9. **Smaller items:** Super Admins aren't labelled in the Admin Management table, **Revoke all** has no confirmation, the Departments filter needs `candidates.view` while the page needs `analytics.view`, logging out with an already-expired token can't revoke its refresh token, and `/auth/login?role=<unknown>` shows an error page.
