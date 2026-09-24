"""
Admin Portal API test -- pytest-free, no network, no database.

Boots the real FastAPI app (real routers, real auth dependencies) and replaces
only the Supabase clients with in-memory fakes. Verifies:
  * every /admin route rejects anonymous (401) and every non-admin role (403),
    including a token whose *editable* user_metadata claims role=admin, and
    never reaches the database for them;
  * public signup / login / OAuth / self-heal can no longer create Admin or
    College profiles;
  * College/Admin provisioning (create, duplicate, legacy account REPLACED not adopted, rollback,
    no partial writes);
  * query-param validation and mapping onto the admin_* SQL functions,
    paging, CSV export (chunked <= 1000 rows per call, complete for > 1000 rows,
    truncation reported, formula-injection safe) and the "N/A, never fake 0" rules.

Run with:  python tests/test_admin_portal_api.py     (exit 0 = all passed)
The SQL itself is covered by tests/test_admin_portal_sql.py.
"""

from __future__ import annotations

import os
import sys
import uuid
from types import SimpleNamespace

# Force dummy credentials so this can never talk to a real Supabase project,
# even if the shell (or backend/.env, which load_dotenv won't override) has real ones.
os.environ["SUPABASE_URL"] = "https://example.supabase.co"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "svc-role-test"
os.environ["SUPABASE_ANON_KEY"] = "anon-test"
os.environ["PEERMEET_SHARED_SECRET"] = "test-shared-secret"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from fastapi.testclient import TestClient  # noqa: E402
from postgrest.exceptions import APIError  # noqa: E402
from supabase_auth.errors import AuthApiError  # noqa: E402

from app import deps  # noqa: E402
from app.main import app  # noqa: E402
from app.services.admin.common import DateRange  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402

import logging  # noqa: E402
logging.getLogger("httpx").setLevel(logging.WARNING)

passed = failed = 0


def check(label: str, ok: bool, detail: object = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {label}")
    else:
        failed += 1
        print(f"  [FAIL] {label} -- {detail}")


# ── Fake Supabase ──────────────────────────────────────────────────────

class _Res:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db: "FakeDB", name: str):
        self.db, self.name = db, name
        self.op, self.payload = "select", None
        self.filters: list = []
        self._single = False
        self._limit = None

    def select(self, *_a, **_k):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def upsert(self, payload, **_k):
        self.op, self.payload = "upsert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, col, val):
        self.filters.append((col, val, "eq"))
        return self

    def ilike(self, col, val):
        self.filters.append((col, val, "ilike"))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def order(self, *_a, **_k):
        return self

    def single(self):
        self._single = True
        return self

    @staticmethod
    def _ilike(have, pattern):
        """PostgreSQL ILIKE (backslash escapes; PostgREST also maps * to %)."""
        import re
        out, i = [], 0
        while i < len(pattern):
            c = pattern[i]
            if c == "\\" and i + 1 < len(pattern):
                out.append(re.escape(pattern[i + 1]))
                i += 2
                continue
            out.append(".*" if c in "%*" else "." if c == "_" else re.escape(c))
            i += 1
        return re.fullmatch("".join(out), str(have), re.I | re.S) is not None

    def _match(self, row):
        for col, val, kind in self.filters:
            have = row.get(col)
            if kind == "ilike":
                if not self._ilike(have, val):
                    return False
            elif have != val:
                return False
        return True

    def execute(self):
        rows = self.db.tables.setdefault(self.name, [])
        if self.op == "select":
            found = [dict(r) for r in rows if self._match(r)]
            if self._limit is not None:
                found = found[: self._limit]
            if self._single:
                if len(found) != 1:
                    raise APIError({"message": "no rows", "code": "PGRST116"})
                return _Res(found[0])
            return _Res(found)
        if self.op == "insert":
            row = {"id": str(uuid.uuid4()), **self.payload}
            rows.append(row)
            return _Res([dict(row)])
        if self.op == "upsert":
            if self.name == "profiles" and self.db.fail_profile_upsert:
                raise APIError({"message": "boom", "code": "XX000"})
            self.db.upserts.append((self.name, dict(self.payload)))
            existing = next((r for r in rows if r.get("id") == self.payload.get("id")), None)
            if existing:
                existing.update(self.payload)
                return _Res([dict(existing)])
            rows.append(dict(self.payload))
            return _Res([dict(self.payload)])
        if self.op == "update":
            hit = [r for r in rows if self._match(r)]
            for r in hit:
                r.update(self.payload)
            self.db.updates.append((self.name, dict(self.payload)))
            return _Res([dict(r) for r in hit])
        if self.op == "delete":
            hit = [r for r in rows if self._match(r)]
            self.db.tables[self.name] = [r for r in rows if r not in hit]
            return _Res(hit)
        raise AssertionError(self.op)


class FakeDB:
    def __init__(self):
        self.reset()

    def reset(self):
        self.tables: dict = {"profiles": [], "colleges": []}
        self.rpc_calls: list = []
        self.rpc_results: dict = {}
        self.upserts: list = []
        self.updates: list = []
        self.fail_profile_upsert = False
        self.fail_delete_user = False
        self.created_auth_users: list = []
        self.deleted_auth_users: list = []
        self.recovery_emails: list = []
        self.signups: list = []

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        result = self.rpc_results.get(name, [])
        result = result(params) if callable(result) else result
        return SimpleNamespace(execute=lambda: _Res(result))


db = FakeDB()

# Tokens: token -> (user id, editable user_metadata)
TOKENS = {
    "tok-admin": ("u-admin", {"role": "admin"}),
    "tok-college": ("u-college", {"role": "college"}),
    "tok-company": ("u-company", {"role": "company"}),
    "tok-candidate": ("u-candidate", {"role": "candidate"}),
    # A candidate who edited their OWN user_metadata to claim admin.
    "tok-meta-admin": ("u-candidate2", {"role": "admin"}),
    # A brand-new auth user (no profile row) claiming admin via metadata.
    "tok-noprofile-admin": ("u-ghost", {"role": "admin"}),
}
ROLES = {"u-admin": "admin", "u-college": "college", "u-company": "company",
         "u-candidate": "candidate", "u-candidate2": "candidate"}


def fake_get_user(token):
    if token not in TOKENS:
        raise AuthApiError("invalid JWT", 401, "bad_jwt")
    uid, meta = TOKENS[token]
    return SimpleNamespace(user=SimpleNamespace(id=uid, email=f"{uid}@t.test", user_metadata=meta))


def _fake_sign_up(payload):
    db.signups.append(payload)
    return SimpleNamespace(user=SimpleNamespace(id="u-new"), session=None)


def _fake_create_user(attrs):
    db.created_auth_users.append(attrs)
    return SimpleNamespace(user=SimpleNamespace(id=f"u-created-{len(db.created_auth_users)}"))


# Patch the shared client INSTANCES (every module holds the same objects).
deps.db_client.table = db.table
deps.db_client.rpc = db.rpc
deps.auth_client.auth.get_user = fake_get_user
deps.auth_client.auth.sign_up = _fake_sign_up
deps.auth_client.auth.reset_password_for_email = lambda email: db.recovery_emails.append(email)
deps.auth_client.auth.sign_in_with_password = lambda p: SimpleNamespace(session=SimpleNamespace(
    user=SimpleNamespace(id=p["email"].split("@")[0] if p["email"].split("@")[0] in ROLES else "u-nobody",
                         email=p["email"]), access_token="t", refresh_token="r", expires_at=1))
deps.admin_client.auth.admin.create_user = _fake_create_user
def _fake_delete_user(uid):
    if db.fail_delete_user:
        raise AuthApiError("cannot delete", 500, "unexpected_failure")
    db.deleted_auth_users.append(uid)
    db.tables["profiles"] = [p for p in db.tables["profiles"] if p.get("id") != uid]   # ON DELETE CASCADE


deps.admin_client.auth.admin.delete_user = _fake_delete_user
deps.admin_client.auth.admin.list_users = lambda **_kw: []
deps.db_client.storage.get_bucket = lambda name: {"name": name}


def seed_profiles():
    db.reset()
    db.tables["profiles"] = [
        # u-admin is a pre-existing admin, grandfathered to Super Admin by
        # db/admin_permissions_migration.sql (2.) — matches production: an
        # admin that existed before the permission system already had full,
        # unrestricted access, so the migration never narrows it.
        {"id": uid, "email": f"{uid}@t.test", "role": role, "is_super_admin": uid == "u-admin"}
        for uid, role in ROLES.items()
    ]
    db.tables["colleges"] = [
        {"id": "col-1", "name": "Alpha College"},
        {"id": "11111111-1111-1111-1111-111111111111", "name": "Beta College"},
        {"id": "33333333-3333-3333-3333-333333333333", "name": "Gamma College"},
        {"id": "44444444-4444-4444-4444-444444444444", "name": "Delta College"},
    ]
    db.tables["companies"] = [
        {"id": "comp-1", "name": "Comp One"},
        {"id": "22222222-2222-2222-2222-222222222222", "name": "Beta Co"},
    ]
    db.tables["admin_user_permissions"] = []


client = TestClient(app, raise_server_exceptions=False)


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


# Canned RPC payloads
OVERVIEW = {
    "totals": {"users": 10, "candidates": 6, "recruiters": 2, "college_accounts": 1, "admins": 1,
               "companies": 2, "colleges": 4, "colleges_in_directory": 30, "drives": 5, "drives_live": 2,
               "drives_draft": 1, "drives_closed": 2, "colleges_with_drives": 2, "companies_with_drives": 1},
    "period": {"new_candidates": 3, "new_companies": 1, "new_colleges": 0, "drives_created": 2, "applications": 10,
               "applicants": 5, "shortlisted": 4, "selected": 2, "selected_applicants": 2,
               "drives_with_applications": 4, "active_candidates": 4, "active_companies": 1, "active_colleges": 2},
}
COLLEGE_ROW = {"college_id": "11111111-1111-1111-1111-111111111111", "name": "=cmd|' /C calc'!A0", "city": "Pune",
               "state": None, "college_type": None, "has_account": True, "registered_at": "2026-01-02T00:00:00+00:00",
               "candidates": 3, "roster_students": 0, "roster_placed": 0, "companies": 1, "drives": 2,
               "applications": 5, "applicants": 3, "shortlisted": 3, "selected": 2, "selected_applicants": 2,
               "last_activity": None, "is_active": True, "total_count": 42}
USER_ROW = {"user_id": "u-candidate", "email": "u-candidate@t.test", "name": "Cara Candidate", "role": "candidate",
            "college_id": None, "college_name": None, "company_id": None, "company_name": None,
            "created_at": "2026-01-02T00:00:00+00:00", "onboarded": True,
            "is_blocked": False, "blocked_permanent": False, "blocked_until": None, "blocked_at": None,
            "blocked_reason": None, "blocked_by_email": None, "last_activity": None, "total_count": 1}
EVENT_ROW = {"id": "ev-1", "event_type": "user_login", "occurred_at": "2026-01-02T00:00:00+00:00",
             "actor_user_id": "u-admin", "actor_role": "admin", "actor_label": "u-admin@t.test",
             "target_type": "user", "target_id": "u-candidate", "target_label": "u-candidate@t.test",
             "metadata": {}, "result": "success", "total_count": 1}


def install_rpc_defaults():
    db.rpc_results.update({
        "admin_overview": OVERVIEW,
        "admin_trends": [{"bucket": "2026-01-01T00:00:00+00:00", "applications": 1}],
        "admin_activity": [{"kind": "candidate_registered", "occurred_at": "2026-01-01T00:00:00+00:00",
                            "subject": "A", "detail": None}],
        "admin_ctc_stats": {"currency": "INR"},
        "admin_list_colleges": [COLLEGE_ROW],
        "admin_list_companies": [{"company_id": "c", "name": "K", "total_count": 1}],
        "admin_list_candidates": [{"candidate_id": "s", "name": "S", "total_count": 1}],
        "admin_list_drives": [{"drive_id": "d", "job_title": "J", "company_name": "C", "college_name": "Col", "total_count": 1}],
        "admin_list_partnerships": [{"company_name": "C", "college_name": "Col", "total_count": 1}],
        "admin_list_users": [USER_ROW],
        "admin_list_events": [EVENT_ROW],
        "admin_activity_feed": [{"id": "act-1", "kind": "candidate_registered", "occurred_at": "2026-01-01T00:00:00+00:00",
                                  "subject": "A", "detail": None, "actor_role": "candidate"}],
        "admin_alerts": [{"alert_id": "a1", "alert_type": "drive_no_applications", "severity": "warning",
                           "title": "T", "description": "D", "occurred_at": "2026-01-01T00:00:00+00:00", "link": "/admin/placements"}],
        "admin_global_search": [{"entity_type": "college", "id": "col-1", "title": "Alpha College", "subtitle": "Pune"}],
        "admin_platform_usage": {"logins": 3, "events_tracking_since": "2026-01-01T00:00:00+00:00"},
        "admin_department_breakdown": [{"branch": "CSE", "candidates": 5, "applications": 3, "applicants": 2,
                                         "shortlisted": 1, "selected": 0, "selected_applicants": 0}],
        "admin_ctc_by_company": [{"company_id": "c", "company_name": "K", "posted_roles": 1, "posted_average": 500000,
                                   "posted_highest": 500000, "posted_lowest": 500000, "filled_roles": 0,
                                   "filled_average": None, "filled_highest": None, "filled_lowest": None}],
    })


def admin_get_routes():
    """Every GET route under /admin, discovered from the live app."""
    paths = app.openapi()["paths"]
    out = []
    for path, ops in paths.items():
        if not path.startswith("/admin"):
            continue
        concrete = (path.replace("{college_id}", str(uuid.uuid4()))
                        .replace("{company_id}", str(uuid.uuid4()))
                        .replace("{user_id}", str(uuid.uuid4())))
        for method in ops:
            out.append((method.upper(), concrete))
    return out


def main() -> int:
    routes = admin_get_routes()

    print(f"\n== Authorization: {len(routes)} admin routes x every identity ==")
    seed_profiles()
    install_rpc_defaults()
    body = {"email": "x@y.zz", "first_name": "A", "last_name": "B", "college_name": "Z"}

    def call(method, path, token=None):
        headers = bearer(token) if token else {}
        if method == "POST":
            return client.post(path, json=body, headers=headers)
        return client.get(path, headers=headers)

    def sweep(token, want, label):
        db.rpc_calls.clear()
        results = [(m, p, call(m, p, token).status_code) for m, p in routes]
        bad = [r for r in results if r[2] != want]
        check(f"{label}: every admin route -> {want}", not bad, bad[:3])
        return db.rpc_calls

    sweep(None, 401, "no token")
    sweep("not-a-token", 401, "garbage token")
    for token, label in (("tok-candidate", "candidate"), ("tok-company", "company"), ("tok-college", "college")):
        calls = sweep(token, 403, f"{label} token")
        check(f"{label}: admin_* SQL functions were never called", not calls, calls)
    calls = sweep("tok-meta-admin", 403, "candidate whose user_metadata claims admin")
    check("metadata-claimed admin never reached the database", not calls, calls)
    sweep("tok-noprofile-admin", 403, "auth user with no profile claiming admin")
    check("no profile row was minted for the metadata-claimed admin",
          not any(r["id"] == "u-ghost" for r in db.tables["profiles"]))
    admin_ok = [(m, p, call(m, p, "tok-admin").status_code) for m, p in routes if m == "GET"]
    check("real admin token -> 200 on every GET route", all(s == 200 for _, _, s in admin_ok), [x for x in admin_ok if x[2] != 200])

    print("\n== Public signup can no longer create Admin / College ==")
    seed_profiles()
    payload = {"email": "new@t.test", "password": "password123", "name": "N N", "first_name": "N", "last_name": "N"}
    for role in ("admin", "college", "ADMIN", "superuser"):
        r = client.post("/auth/signup", json={**payload, "role": role})
        check(f"POST /auth/signup role={role!r} -> 403", r.status_code == 403, (r.status_code, r.text))
    check("...and no Supabase user was even created", not db.signups, db.signups)
    for role in ("candidate", "company"):
        db.signups.clear()
        r = client.post("/auth/signup", json={**payload, "email": f"{role}-new@t.test", "role": role})
        check(f"POST /auth/signup role={role!r} still works", r.status_code == 200 and len(db.signups) == 1, (r.status_code, r.text))
    r = client.post("/auth/signup", json={**payload, "email": "default-role@t.test"})
    check("signup with no role defaults to candidate", r.status_code == 200 and r.json()["user"]["role"] == "candidate", r.text)

    seed_profiles()
    r = client.post("/auth/login", json={"email": "ghost@t.test", "password": "password123", "role": "admin"})
    check("login as role=admin for an account with no profile -> 403 (no self-heal)", r.status_code == 403, (r.status_code, r.text))
    r = client.post("/auth/login", json={"email": "ghost@t.test", "password": "password123", "role": "college"})
    check("login as role=college for an account with no profile -> 403", r.status_code == 403, (r.status_code, r.text))
    check("no admin/college profile row was created by either", not db.upserts, db.upserts)
    r = client.post("/auth/login", json={"email": "ghost@t.test", "password": "password123", "role": "candidate"})
    check("login as candidate self-heals a missing profile as before", r.status_code == 200 and db.upserts[-1][1]["role"] == "candidate", (r.status_code, r.text))
    r = client.post("/auth/oauth-session", json={"accessToken": "tok-noprofile-admin", "role": "college"})
    check("Google/OAuth first sign-in as role=college -> 403", r.status_code == 403, (r.status_code, r.text))
    seed_profiles()
    r = client.get("/auth/profile", headers=bearer("tok-noprofile-admin"))
    check("GET /auth/profile does not self-heal an admin profile from user_metadata", r.status_code == 403, (r.status_code, r.text))
    check("...and still creates nothing", not db.upserts)
    r = client.patch("/auth/profile", json={"name": "X"}, headers=bearer("tok-noprofile-admin"))
    check("PATCH /auth/profile does not self-heal an admin profile either", r.status_code == 403, (r.status_code, r.text))
    r = client.post("/auth/login", json={"email": "u-admin@t.test", "password": "password123", "role": "candidate"})
    check("an existing admin cannot log in through the candidate portal", r.status_code == 403, (r.status_code, r.text))

    print("\n== Provisioning: POST /admin/colleges ==")
    seed_profiles()
    good = {"email": "  TPO@Alpha.EDU ", "first_name": "Tia", "last_name": "Rao", "college_name": "Alpha College",
            "city": "Pune"}
    r = client.post("/admin/colleges", json=good, headers=bearer("tok-admin"))
    check("admin creates a College account -> 201", r.status_code == 201, (r.status_code, r.text))
    prof = next((p for p in db.tables["profiles"] if p.get("email") == "tpo@alpha.edu"), None)
    check("profile has role=college, linked to the (existing) college, email normalised",
          bool(prof) and prof["role"] == "college" and prof["college_id"] == "col-1" and prof["onboarded"] is False, prof)
    made = db.created_auth_users[-1]
    check("auth user is pre-confirmed with a strong random password nobody sees",
          made["email_confirm"] is True and len(made["password"]) >= 32 and "password" not in r.text, made)
    check("set-password email sent; response says so", db.recovery_emails == ["tpo@alpha.edu"] and r.json()["invite_sent"] is True, r.text)
    check("blank directory city is filled from the form", ("colleges", {"city": "Pune"}) in db.updates, db.updates)
    check("a brand-new account is not flagged as replacing anything", r.json()["replaced_legacy_account"] is False, r.text)

    r = client.post("/admin/colleges", json=good, headers=bearer("tok-admin"))
    check("same email again -> 409, no second auth user", r.status_code == 409 and len(db.created_auth_users) == 1, (r.status_code, r.text))
    r = client.post("/admin/colleges", json={**good, "email": "u-candidate@t.test"}, headers=bearer("tok-admin"))
    check("email that belongs to a candidate -> 409", r.status_code == 409 and "candidate" in r.text, (r.status_code, r.text))
    n = len(db.created_auth_users)
    r = client.post("/admin/colleges", json={**good, "email": "not-an-email"}, headers=bearer("tok-admin"))
    check("invalid email -> 422", r.status_code == 422, r.status_code)
    r = client.post("/admin/colleges", json={"email": "a@b.cc", "first_name": "A", "last_name": "B"}, headers=bearer("tok-admin"))
    check("neither college_id nor college_name -> 422", r.status_code == 422, r.status_code)
    r = client.post("/admin/colleges", json={**good, "email": "q@b.cc", "college_id": "nope", "college_name": None}, headers=bearer("tok-admin"))
    check("college_id that is not a UUID -> 422 validation error (was a 502 from the database)",
          r.status_code == 422 and "college_id" in r.text and len(db.created_auth_users) == n, (r.status_code, r.text[:120]))
    r = client.post("/admin/colleges", json={**good, "email": "q@b.cc", "college_id": str(uuid.uuid4()), "college_name": None}, headers=bearer("tok-admin"))
    check("well-formed but unknown college_id -> 404, nothing created", r.status_code == 404 and len(db.created_auth_users) == n, (r.status_code, r.text))

    print("\n== Provisioning hardening: legacy self-registered College accounts ==")
    seed_profiles()
    db.tables["profiles"].append({"id": "u-legacy", "email": "legacy@alpha.edu", "role": "college", "college_id": None})
    db.tables["profiles"].append({"id": "u-linked", "email": "linked@alpha.edu", "role": "college", "college_id": "col-1"})
    r = client.post("/admin/colleges", json={**good, "email": "legacy@alpha.edu"}, headers=bearer("tok-admin"))
    fresh = next((p for p in db.tables["profiles"] if p.get("email") == "legacy@alpha.edu"), None)
    check("an unlinked legacy College account is REPLACED, not adopted: the old auth user (password, sessions, identities) is deleted",
          r.status_code == 201 and "u-legacy" in db.deleted_auth_users and r.json()["replaced_legacy_account"] is True, (r.status_code, r.text))
    check("...a fresh account (new id, new random password) is created and linked to the college",
          bool(fresh) and fresh["id"] != "u-legacy" and fresh["college_id"] == "col-1" and len(db.created_auth_users[-1]["password"]) >= 32, fresh)
    check("...and only the mailbox owner can set its password: a recovery email goes out",
          db.recovery_emails == ["legacy@alpha.edu"] and r.json()["invite_sent"] is True, db.recovery_emails)
    r = client.post("/admin/colleges", json={**good, "email": "linked@alpha.edu"}, headers=bearer("tok-admin"))
    check("an already-LINKED (working) College account is preserved: 409, never deleted",
          r.status_code == 409 and "u-linked" not in db.deleted_auth_users and any(p["id"] == "u-linked" for p in db.tables["profiles"]), (r.status_code, r.text))
    seed_profiles()
    db.tables["profiles"].append({"id": "u-legacy2", "email": "legacy2@alpha.edu", "role": "college", "college_id": None})
    db.fail_delete_user = True
    before_users, before_updates = len(db.created_auth_users), len(db.updates)
    r = client.post("/admin/colleges", json={**good, "email": "legacy2@alpha.edu"}, headers=bearer("tok-admin"))
    check("if the legacy account cannot be removed -> 502 and NOTHING changes (no new user, old profile intact)",
          r.status_code == 502 and len(db.created_auth_users) == before_users and any(p["id"] == "u-legacy2" for p in db.tables["profiles"]), (r.status_code, r.text))
    check("...and no college details were written", len(db.updates) == before_updates, db.updates)
    db.fail_delete_user = False
    r = client.post("/admin/colleges", json={**good, "email": "bad@alpha.edu", "role": "admin"}, headers=bearer("tok-admin"))
    check("the endpoint cannot be used to mint admins (role is not an input)", not any(p.get("email") == "bad@alpha.edu" and p["role"] == "admin" for p in db.tables["profiles"]), r.text)

    print("\n== Provisioning: no partial writes ==")
    seed_profiles()
    db.fail_profile_upsert = True
    r = client.post("/admin/colleges", json=good, headers=bearer("tok-admin"))
    check("profile insert failure -> 502 and the auth user is rolled back",
          r.status_code == 502 and db.deleted_auth_users == ["u-created-1"], (r.status_code, r.text, db.deleted_auth_users))
    check("...and the EXISTING college was not modified by the failed attempt", not any(t == "colleges" for t, _ in db.updates), db.updates)
    seed_profiles()
    db.fail_profile_upsert = True
    r = client.post("/admin/colleges", json={**good, "college_name": "Brand New Institute", "city": "Goa"}, headers=bearer("tok-admin"))
    check("a college row created only for a failed request is removed again (no orphan directory entry)",
          r.status_code == 502 and not any(c["name"] == "Brand New Institute" for c in db.tables["colleges"]), db.tables["colleges"])
    seed_profiles()
    db.tables["colleges"][0].update({"city": "Kept City"})
    r = client.post("/admin/colleges", json={**good, "email": "fill@alpha.edu", "city": "Overwrite?", "state": "Maharashtra"}, headers=bearer("tok-admin"))
    row = db.tables["colleges"][0]
    check("directory details only FILL blanks: existing city kept, blank state filled",
          r.status_code == 201 and row["city"] == "Kept City" and row["state"] == "Maharashtra", row)
    seed_profiles()
    import logging
    class _Cap(logging.Handler):
        def __init__(self):
            super().__init__()
            self.msgs = []
        def emit(self, rec):
            self.msgs.append(rec.getMessage())
    cap = _Cap()
    lg = logging.getLogger("app.services.admin.provisioning")
    lg.addHandler(cap)
    real_reset = deps.auth_client.auth.reset_password_for_email
    def _boom(email):
        raise RuntimeError(f"SMTP refused {email}")
    deps.auth_client.auth.reset_password_for_email = _boom
    r = client.post("/admin/colleges", json={**good, "email": "log.me@alpha.edu"}, headers=bearer("tok-admin"))
    deps.auth_client.auth.reset_password_for_email = real_reset
    lg.removeHandler(cap)
    check("mail failure does not fail provisioning and is reported (invite_sent=false)", r.status_code == 201 and r.json()["invite_sent"] is False, r.text)
    check("...and the failure log line contains no email address (or the SMTP error text carrying it)",
          cap.msgs and not any("log.me" in m or "alpha.edu" in m for m in cap.msgs), cap.msgs)

    print("\n== College name lookup is exact: LIKE wildcards in user input never match another college ==")
    from app.crud import find_college_id_by_name
    seed_profiles()
    for evil in ("%", "_", "Alpha%", "%College", "A_pha College", "*", "Alpha*"):
        check(f"find_college_id_by_name({evil!r}) does NOT resolve to 'Alpha College'", find_college_id_by_name(evil) is None)
    check("the exact name still resolves, any case / padding", find_college_id_by_name("  alpha COLLEGE ") == "col-1")
    r = client.patch("/auth/profile", json={"collegeName": "%"}, headers=bearer("tok-candidate"))
    linked = next(p for p in db.tables["profiles"] if p["id"] == "u-candidate")
    check("a candidate typing '%' as their college is NOT linked to an existing college",
          r.status_code == 200 and linked.get("college_id") not in (None, "col-1"), (r.status_code, linked))
    # Escaping matters beyond the equality re-check: a name that contains a wildcard and is also matched by
    # more than the query's LIMIT of other colleges must still resolve to ITSELF, or find_or_create would
    # insert a duplicate college.
    from app.crud import find_or_create_college_by_name
    db.tables["colleges"] = ([{"id": f"decoy-{i}", "name": f"Ace Institute {i:02d}"} for i in range(12)]
                             + [{"id": "col-pct", "name": "Ace%"}])
    check("'Ace%' resolves to the college literally named 'Ace%' although 12 others match it as a wildcard",
          find_college_id_by_name("Ace%") == "col-pct", find_college_id_by_name("Ace%"))
    n_colleges = len(db.tables["colleges"])
    check("find_or_create on that name reuses it: no duplicate college is inserted",
          find_or_create_college_by_name("Ace%") == "col-pct" and len(db.tables["colleges"]) == n_colleges,
          len(db.tables["colleges"]))

    print("\n== Admin account CLI path (provision_account role=admin) ==")
    from app.services.admin.provisioning import provision_account
    seed_profiles()
    res = provision_account(email="boss@co.io", role="admin", first_name="Bo", last_name="Ss")
    boss = next(p for p in db.tables["profiles"] if p["email"] == "boss@co.io")
    check("admin profile is created onboarded=True (lands on /admin, not a candidate wizard)",
          boss["role"] == "admin" and boss["onboarded"] is True and res["created"], boss)
    try:
        provision_account(email="x@y.zz", role="candidate", first_name="A", last_name="B")
        check("provision_account refuses public roles", False)
    except Exception as e:
        check("provision_account refuses public roles", getattr(e, "status_code", None) == 422, e)
    try:
        provision_account(email="x@y.zz", role="college", first_name="A", last_name="B")
        check("a College account must be linked to a college", False)
    except Exception as e:
        check("a College account must be linked to a college", getattr(e, "status_code", None) == 422, e)

    print("\n== Query validation & mapping ==")
    seed_profiles()
    install_rpc_defaults()
    H = bearer("tok-admin")
    q = "/admin/colleges?from=2026-02-01T00:00:00Z&to=2026-03-01T00:00:00Z&search=%20alp%20&sort=name&dir=asc&page=3&page_size=10&activity=active&registration=all"
    r = client.get(q, headers=H)
    name, params = db.rpc_calls[-1]
    check("colleges list -> 200 with items/total/page", r.status_code == 200 and set(r.json()) == {"items", "total", "page", "page_size"}, r.text)
    check("paging maps to limit/offset (page 3 x 10 -> offset 20)", (params["p_limit"], params["p_offset"]) == (10, 20), params)
    check("filters map: search trimmed, sort/dir/activity/registration passed",
          (params["p_search"], params["p_sort"], params["p_dir"], params["p_activity"], params["p_registration"]) == ("alp", "name", "asc", "active", "all"), params)
    check("date range passed as ISO instants", params["p_from"].startswith("2026-02-01T00:00:00") and params["p_to"].startswith("2026-03-01"), params)
    check("total_count is lifted out of the rows into `total`", r.json()["total"] == 42 and "total_count" not in r.json()["items"][0], r.json())
    for bad, label in (
        ("/admin/colleges?sort=password", "unknown sort"),
        ("/admin/colleges?dir=sideways", "bad direction"),
        ("/admin/colleges?registration=everything", "bad registration"),
        ("/admin/colleges?page_size=1000", "page_size > 100"),
        ("/admin/colleges?page=0", "page 0"),
        ("/admin/colleges?from=2026-02-01T00:00:00Z", "from without to"),
        ("/admin/colleges?from=2026-03-01T00:00:00Z&to=2026-02-01T00:00:00Z", "to before from"),
        ("/admin/colleges?from=1900-01-01T00:00:00Z&to=2026-01-01T00:00:00Z", "range > 20 years"),
        ("/admin/candidates?status=hacked", "bad candidate status"),
        ("/admin/candidates?college_id=not-a-uuid", "non-uuid college_id"),
        ("/admin/colleges/not-a-uuid", "non-uuid path id"),
        ("/admin/drives?status=weird", "bad drive status"),
    ):
        r = client.get(bad, headers=H)
        check(f"{label} -> 422", r.status_code == 422, (r.status_code, r.text[:80]))
    n = len(db.rpc_calls)
    client.get("/admin/colleges?sort=password", headers=H)
    check("rejected requests never reach the database", len(db.rpc_calls) == n)

    r = client.get("/admin/candidates?college_id=11111111-1111-1111-1111-111111111111&status=placed&registered_in_range=true", headers=H)
    _, params = db.rpc_calls[-1]
    check("candidate filters map (college, status, registered_in_range)",
          params["p_college_id"] == "11111111-1111-1111-1111-111111111111" and params["p_status"] == "placed" and params["p_registered_in_range"] is True, params)
    client.get("/admin/colleges", headers=H)
    _, params = db.rpc_calls[-1]
    check("omitting the range passes NULL bounds (all time)", params["p_from"] is None and params["p_to"] is None, params)

    print("\n== Paging past the end still reports the real total ==")
    def paged(params):
        if params["p_offset"] > 0:
            return []
        return [{**COLLEGE_ROW, "total_count": 7}]
    db.rpc_results["admin_list_colleges"] = paged
    r = client.get("/admin/colleges?page=9", headers=H)
    check("empty page 9 -> items [] but total 7", r.status_code == 200 and r.json()["items"] == [] and r.json()["total"] == 7, r.text)
    db.rpc_results["admin_list_colleges"] = []
    r = client.get("/admin/colleges", headers=H)
    check("empty database -> items [] and total 0 (UI shows an empty state)", r.json() == {"items": [], "total": 0, "page": 1, "page_size": 25}, r.text)
    install_rpc_defaults()

    print("\n== Detail endpoints ==")
    r = client.get(f"/admin/colleges/{uuid.uuid4()}", headers=H)
    check("known college -> 200 with college + accounts", r.status_code == 200 and "accounts" in r.json(), r.text)
    db.rpc_results["admin_list_colleges"] = []
    r = client.get(f"/admin/colleges/{uuid.uuid4()}", headers=H)
    check("unknown college -> 404", r.status_code == 404, r.text)
    db.rpc_results["admin_list_companies"] = []
    r = client.get(f"/admin/companies/{uuid.uuid4()}", headers=H)
    check("unknown company -> 404", r.status_code == 404, r.text)
    install_rpc_defaults()

    print("\n== KPIs: N/A instead of fake numbers ==")
    r = client.get("/admin/overview", headers=H)
    d = r.json()["derived"]
    check("placement rate = 2 selected / 5 applicants = 0.4", d["placement_rate"] == 0.4, d)
    check("applications per applicant = 2.0; per drive = 2.5", (d["applications_per_applicant"], d["applications_per_drive"]) == (2.0, 2.5), d)
    check("college participation 2/4, company participation 1/2", (d["college_participation"], d["company_participation"]) == (0.5, 0.5), d)
    empty = {"totals": {**OVERVIEW["totals"], "colleges": 0, "companies": 0},
             "period": {**OVERVIEW["period"], "applications": 0, "applicants": 0, "shortlisted": 0, "selected": 0,
                        "selected_applicants": 0, "drives_with_applications": 0}}
    db.rpc_results["admin_overview"] = empty
    d = client.get("/admin/overview", headers=H).json()["derived"]
    check("no applicants -> every ratio is null (N/A), not 0%", all(v is None for v in d.values()), d)
    install_rpc_defaults()
    r = client.get("/admin/placements", headers=H).json()
    check("placements: funnel + drive status + ctc", r["drives"]["live"] == 2 and r["funnel"]["placement_rate"] == 0.4 and r["ctc"]["currency"] == "INR", r)

    print("\n== Finance: nothing invented ==")
    r = client.get("/admin/finance/summary", headers=H).json()
    check("available=false, every metric null, explanatory message",
          r["available"] is False and all(v is None for v in r["metrics"].values()) and len(r["metrics"]) == 8 and r["message"], r)

    print("\n== Trend bucketing ==")
    def rng(days):
        s = datetime(2026, 1, 1, tzinfo=timezone.utc)
        return DateRange(s, s + timedelta(days=days))
    check("7 days -> day, 45 days -> day", (rng(7).bucket, rng(45).bucket) == ("day", "day"))
    check("60 and 200 days -> week", (rng(60).bucket, rng(200).bucket) == ("week", "week"))
    check("365 days and all-time -> month", (rng(365).bucket, DateRange(None, None).bucket) == ("month", "month"))
    r = client.get("/admin/trends?from=2026-01-01T00:00:00Z&to=2026-01-08T00:00:00Z&tz=Asia/Kolkata", headers=H)
    _, params = db.rpc_calls[-1]
    check("trends passes bucket + time zone", r.json()["bucket"] == "day" and params["p_tz"] == "Asia/Kolkata", (r.text, params))

    print("\n== CSV export ==")
    def paged_source(total, server_max_rows=1000, row=None):
        """A fake admin_* list function: honours p_limit/p_offset and, like PostgREST's
        `max-rows`, never returns more than server_max_rows rows per call."""
        calls = []
        def handler(params):
            calls.append((params["p_limit"], params["p_offset"]))
            lim = min(params["p_limit"], server_max_rows)
            start_i = params["p_offset"]
            return [{"college_id": f"id-{i}", "name": f"College {i:05d}", "total_count": total, **(row or {})}
                    for i in range(start_i, min(start_i + lim, total))]
        return handler, calls

    def export(path="/admin/colleges/export", **headers):
        r = client.get(path, headers={**H, **headers})
        lines = r.text.splitlines()
        return r, lines[0] if lines else "", [l.split(",")[0] for l in lines[1:]]

    db.rpc_results["admin_list_colleges"] = [{**COLLEGE_ROW, "total_count": 1}]
    r, head, names = export()
    check("text/csv attachment", r.headers["content-type"].startswith("text/csv") and "colleges.csv" in r.headers["content-disposition"], r.headers)
    check("header row + one data row", head.startswith("College,City") and len(names) == 1, (head, names))
    check("formula-injection: a name starting with '=' is neutralised with a leading quote", names[0].startswith("'=cmd"), names)
    check("a complete one-row export reports truncated=false, rows=1, total=1",
          (r.headers["x-export-truncated"], r.headers["x-export-rows"], r.headers["x-export-total"]) == ("false", "1", "1"), dict(r.headers))

    handler, calls = paged_source(2500, server_max_rows=1000)
    db.rpc_results["admin_list_colleges"] = handler
    db.rpc_calls.clear()
    r, head, names = export("/admin/colleges/export?search=%20alp%20&sort=name&dir=asc&activity=active&registration=all&from=2026-02-01T00:00:00Z&to=2026-03-01T00:00:00Z")
    check("2,500 matching rows -> ALL 2,500 are exported, in order, no gaps or duplicates (Supabase's 1000-row cap)",
          names == [f"College {i:05d}" for i in range(2500)], (len(names), names[:2], names[-2:]))
    check("...fetched in pages of <= 1000: never a single 50,000-row request", all(c[0] <= 1000 for c in calls) and [c[1] for c in calls] == [0, 1000, 2000], calls)
    check("...and every page carried the SAME filters / sort / date range",
          all(pr["p_search"] == "alp" and pr["p_sort"] == "name" and pr["p_dir"] == "asc" and pr["p_activity"] == "active" and pr["p_registration"] == "all"
              and pr["p_from"].startswith("2026-02-01") and pr["p_to"].startswith("2026-03-01") for _, pr in db.rpc_calls), db.rpc_calls[:1])
    check("...headers: rows=2500 total=2500 truncated=false",
          (r.headers["x-export-rows"], r.headers["x-export-total"], r.headers["x-export-truncated"]) == ("2500", "2500", "false"), dict(r.headers))

    handler, calls = paged_source(2500, server_max_rows=400)
    db.rpc_results["admin_list_colleges"] = handler
    r, head, names = export()
    check("a server-side row cap BELOW our page size (400) can shorten a page but never skips rows: still 2,500, in order",
          names == [f"College {i:05d}" for i in range(2500)], (len(names), calls[:4]))
    check("...the offset advanced by the rows actually received", [c[1] for c in calls] == [0, 400, 800, 1200, 1600, 2000, 2400], calls)

    import app.services.admin.common as _common
    real_cap = _common.EXPORT_MAX_ROWS
    _common.EXPORT_MAX_ROWS = 1500
    try:
        handler, calls = paged_source(2500)
        db.rpc_results["admin_list_colleges"] = handler
        r, head, names = export()
        check("hard cap (1,500 here): exactly the cap is exported, never more", len(names) == 1500 and names == [f"College {i:05d}" for i in range(1500)], len(names))
        check("...and the truncation is DETECTABLE: X-Export-Truncated=true, rows=1500, total=2500",
              (r.headers["x-export-truncated"], r.headers["x-export-rows"], r.headers["x-export-total"]) == ("true", "1500", "2500"), dict(r.headers))
        check("...the last page asks only for what fits under the cap (1000 then 500)", [c[0] for c in calls] == [1000, 500], calls)
        handler, calls = paged_source(1500)
        db.rpc_results["admin_list_colleges"] = handler
        r, head, names = export()
        check("exactly AT the cap is complete, not 'truncated'", len(names) == 1500 and r.headers["x-export-truncated"] == "false", dict(r.headers))
    finally:
        _common.EXPORT_MAX_ROWS = real_cap

    handler, calls = paged_source(0)
    db.rpc_results["admin_list_colleges"] = handler
    r, head, names = export()
    check("an empty result exports just the header row and reports truncated=false, total=0",
          names == [] and head.startswith("College,City") and (r.headers["x-export-truncated"], r.headers["x-export-total"]) == ("false", "0"), dict(r.headers))

    state = {"n": 0}
    full, _ = paged_source(2500)
    def shrinking(params):
        state["n"] += 1
        return full(params) if state["n"] == 1 else []      # rows vanish (or the source stalls) after page 1
    db.rpc_results["admin_list_colleges"] = shrinking
    r, head, names = export()
    check("if fewer rows arrive than the total promised, the export is flagged truncated instead of pretending to be complete",
          len(names) == 1000 and r.headers["x-export-truncated"] == "true" and r.headers["x-export-total"] == "2500", dict(r.headers))

    for path, fname, extra in (("/admin/candidates/export", "admin_list_candidates", {}),
                               ("/admin/companies/export", "admin_list_companies", {}),
                               ("/admin/drives/export", "admin_list_drives", {}),
                               ("/admin/partnerships/export", "admin_list_partnerships", {})):
        handler, calls = paged_source(1200)
        db.rpc_results[fname] = handler
        r, head, names = export(path)
        check(f"{path}: 1,200 rows all exported in chunks <= 1000", len(names) == 1200 and all(c[0] <= 1000 for c in calls) and r.headers["x-export-truncated"] == "false", (len(names), calls))

    handler, calls = paged_source(3)
    db.rpc_results["admin_list_colleges"] = handler
    r = client.get("/admin/colleges/export", headers={**H, "Origin": "http://localhost:8090"})
    exposed = r.headers.get("access-control-expose-headers", "")
    check("browser JS can READ the truncation headers cross-origin (exposed on the export response)",
          all(h in exposed for h in ("X-Export-Truncated", "X-Export-Rows", "X-Export-Total")) and r.headers.get("access-control-allow-origin") == "http://localhost:8090", dict(r.headers))
    check("export requires admin too", client.get("/admin/colleges/export", headers=bearer("tok-college")).status_code == 403)
    install_rpc_defaults()

    print("\n== Missing migration is a clear 503, not a crash ==")
    def missing(_params):
        raise APIError({"message": "Could not find the function", "code": "PGRST202"})
    db.rpc_results["admin_overview"] = missing
    r = client.get("/admin/overview", headers=H)
    check("PGRST202 -> 503 naming the migration", r.status_code == 503 and "admin_portal_migration.sql" in r.text, (r.status_code, r.text))
    install_rpc_defaults()

    print("\n== Users & Access: list, detail, export ==")
    seed_profiles(); install_rpc_defaults()
    r = client.get("/admin/users", headers=H)
    check("list users -> 200 paged", r.status_code == 200 and r.json()["items"][0]["email"] == "u-candidate@t.test", r.text)
    for bad in ("/admin/users?role=hacker", "/admin/users?status=sideways"):
        r = client.get(bad, headers=H)
        check(f"{bad} -> 422", r.status_code == 422, (r.status_code, r.text[:80]))
    r = client.get(f"/admin/users/{uuid.uuid4()}", headers=H)
    body = r.json()
    check("user detail -> 200 with user/applications/drives/audit",
          r.status_code == 200 and {"user", "applications", "drives", "audit"} <= set(body), body)
    db.rpc_results["admin_list_users"] = []
    check("unknown user -> 404", client.get(f"/admin/users/{uuid.uuid4()}", headers=H).status_code == 404)
    install_rpc_defaults()
    r = client.get("/admin/users/export", headers=H)
    check("users export -> csv attachment", r.headers["content-type"].startswith("text/csv"), r.headers)

    print("\n== User blocking: temporary, permanent, unblock, and it actually revokes access ==")
    seed_profiles(); install_rpc_defaults()
    for bad_body, label in (
        ({"reason": "spam"}, "no duration and not permanent"),
        ({"permanent": False, "duration": "custom", "reason": "x"}, "custom duration with no 'until'"),
        ({"permanent": False, "duration": "9d", "reason": "x"}, "unknown duration"),
        ({"permanent": True, "reason": ""}, "empty reason"),
    ):
        r = client.post("/admin/users/u-candidate/block", json=bad_body, headers=H)
        check(f"block validation: {label} -> 422", r.status_code == 422, (r.status_code, r.text[:120]))

    r = client.post("/admin/users/u-candidate/block", json={"permanent": False, "duration": "24h", "reason": "abuse report"}, headers=H)
    check("temporary block -> 200", r.status_code == 200 and r.json()["is_blocked"] is True and r.json()["permanent"] is False, r.text)
    prof = next(p for p in db.tables["profiles"] if p["id"] == "u-candidate")
    check("profile now carries blocked_until in the future, blocked_by the admin, the reason",
          prof["blocked_permanent"] is False and prof["blocked_until"] and prof["blocked_by"] == "u-admin" and prof["blocked_reason"] == "abuse report", prof)
    events = [e for e in db.tables.get("admin_events", []) if e["event_type"] == "user_blocked"]
    check("a user_blocked audit event was recorded, naming the actor and target",
          events and events[-1]["actor_user_id"] == "u-admin" and events[-1]["target_id"] == "u-candidate", events)

    check("the block is enforced on the very NEXT request, not just future logins",
          client.get("/auth/profile", headers=bearer("tok-candidate")).status_code == 403)
    r = client.get("/auth/profile", headers=bearer("tok-candidate"))
    check("...with a message naming the reason", "abuse report" in r.text, r.text)
    check("other accounts are unaffected", client.get("/auth/profile", headers=bearer("tok-company")).status_code == 200)
    r = client.post("/auth/login", json={"email": "u-candidate@t.test", "password": "x", "role": "candidate"})
    check("a blocked account also can't sign back in", r.status_code == 403, (r.status_code, r.text))
    login_fail_events = [e for e in db.tables.get("admin_events", []) if e["event_type"] == "user_login" and e["result"] == "failure"]
    check("...and the attempt is recorded as a failed login event", bool(login_fail_events), login_fail_events)

    r = client.post("/admin/users/u-candidate/unblock", json={"reason": "appeal accepted"}, headers=H)
    check("unblock -> 200, is_blocked false", r.status_code == 200 and r.json()["is_blocked"] is False, r.text)
    prof = next(p for p in db.tables["profiles"] if p["id"] == "u-candidate")
    check("every block field is cleared", not any(prof.get(k) for k in ("blocked_permanent", "blocked_until", "blocked_by", "blocked_reason")), prof)
    check("access is restored immediately", client.get("/auth/profile", headers=bearer("tok-candidate")).status_code == 200)
    check("an unblock audit event was recorded",
          any(e["event_type"] == "user_unblocked" and e["target_id"] == "u-candidate" for e in db.tables["admin_events"]))

    print("\n== User blocking: guards ==")
    r = client.post("/admin/users/u-admin/block", json={"permanent": True, "reason": "oops"}, headers=H)
    check("an admin cannot block their own account -> 409", r.status_code == 409, (r.status_code, r.text))
    check("no event was recorded for the refused self-block",
          not any(e["event_type"] == "user_blocked" and e["target_id"] == "u-admin" for e in db.tables.get("admin_events", [])))

    from app.schemas import BlockUserIn
    from app.services.admin.blocking import block_user
    db.tables["profiles"].append({"id": "u-admin2", "email": "admin2@t.test", "role": "admin"})
    ok = block_user("u-admin2", BlockUserIn(permanent=True, reason="test"), {"id": "u-admin", "profile_role": "admin", "email": "u-admin@t.test"})
    check("blocking one of TWO active admins is fine (one remains active)", ok["is_blocked"] is True)
    try:
        # is_super_admin=True on the actor so this exercises the "last active
        # admin" guard specifically, not the separate "only a Super Admin can
        # disable a Super Admin" guard below (u-admin, the target here, is
        # itself the grandfathered Super Admin from seed_profiles()).
        block_user("u-admin", BlockUserIn(permanent=True, reason="test"),
                   {"id": "u-admin3", "profile_role": "admin", "email": "x@t.test", "is_super_admin": True})
        check("blocking the only remaining active admin is refused", False)
    except Exception as e:
        check("blocking the only remaining active admin is refused",
              getattr(e, "status_code", None) == 409 and "only active Admin" in str(getattr(e, "detail", "")), e)
    check("candidate/company/college cannot block anyone",
          all(client.post(f"/admin/users/u-candidate/block", json={"permanent": True, "reason": "x"}, headers=bearer(t)).status_code == 403
              for t in ("tok-candidate", "tok-company", "tok-college")))
    seed_profiles(); install_rpc_defaults()

    print("\n== Audit Log & Live Activity ==")
    r = client.get("/admin/audit-log", headers=H)
    check("audit log -> 200, raw admin_events rows", r.status_code == 200 and r.json()["items"][0]["event_type"] == "user_login", r.text)
    for bad in ("/admin/audit-log?event_type=made_up", "/admin/audit-log?actor_role=superuser", "/admin/audit-log?result=maybe"):
        check(f"{bad} -> 422", client.get(bad, headers=H).status_code == 422)
    r = client.get("/admin/live-activity", headers=H)
    check("live activity -> 200", r.status_code == 200 and "items" in r.json(), r.text)
    check("unknown ?kind= -> 422", client.get("/admin/live-activity?kind=not_a_thing", headers=H).status_code == 422)
    check("audit log requires admin", client.get("/admin/audit-log", headers=bearer("tok-college")).status_code == 403)
    r = client.get("/admin/audit-log/export", headers=H)
    check("audit log export -> csv", r.headers["content-type"].startswith("text/csv"), r.headers)

    print("\n== Alerts ==")
    r = client.get("/admin/alerts", headers=H)
    check("alerts -> 200, computed list", r.status_code == 200 and r.json()["items"][0]["alert_type"] == "drive_no_applications", r.text)
    check("alerts requires admin", client.get("/admin/alerts", headers=bearer("tok-candidate")).status_code == 403)

    print("\n== Global search ==")
    r = client.get("/admin/search?q=alpha", headers=H)
    check("search -> grouped by entity type", r.status_code == 200 and r.json()["groups"]["college"][0]["title"] == "Alpha College", r.text)
    r = client.get("/admin/search", headers=H)
    check("empty query -> no database call, empty groups", r.status_code == 200 and r.json() == {"query": "", "groups": {}}, r.text)

    print("\n== System health: only checks that can actually be verified ==")
    r = client.get("/admin/system-health", headers=H)
    body = r.json()
    check("every required check is reported, api is always operational (it just answered)",
          r.status_code == 200 and body["checks"]["api"]["status"] == "operational"
          and {"database", "authentication", "storage", "realtime", "background_jobs"} <= set(body["checks"]), body)
    check("realtime / background jobs are 'unknown', never faked as operational",
          body["checks"]["realtime"]["status"] == "unknown" and body["checks"]["background_jobs"]["status"] == "unknown", body["checks"])
    real_bucket = deps.db_client.storage.get_bucket
    def _boom_bucket(_name):
        raise RuntimeError("storage unreachable")
    deps.db_client.storage.get_bucket = _boom_bucket
    body = client.get("/admin/system-health", headers=H).json()
    check("a real failure is reported as unavailable, not swallowed into 'operational'",
          body["checks"]["storage"]["status"] == "unavailable" and body["overall"] != "operational", body)
    deps.db_client.storage.get_bucket = real_bucket

    print("\n== Reports ==")
    r = client.get("/admin/reports/application-funnel/export", headers=H)
    check("application funnel report -> csv", r.status_code == 200 and r.headers["content-type"].startswith("text/csv"), r.headers)
    r = client.get("/admin/reports/compensation/export", headers=H)
    check("compensation report -> csv", r.status_code == 200 and r.headers["content-type"].startswith("text/csv"), r.headers)
    r = client.get("/admin/reports/platform-usage", headers=H)
    check("platform usage report -> json summary", r.status_code == 200 and "logins" in r.json(), r.text)
    reports_events = [e for e in db.tables.get("admin_events", []) if e["event_type"] == "report_generated"]
    check("report downloads are logged as report_generated (distinct from a table's csv_exported)",
          len(reports_events) == 2, reports_events)

    print("\n== CSV exports are audited ==")
    db.tables["admin_events"] = []
    client.get("/admin/colleges/export", headers=H)
    exported = [e for e in db.tables["admin_events"] if e["event_type"] == "csv_exported"]
    check("exporting a table logs a csv_exported event naming the admin and the table",
          exported and exported[0]["actor_label"] == "u-admin@t.test" and exported[0]["target_type"] == "colleges", exported)

    print("\n== Department analytics ==")
    r = client.get("/admin/departments", headers=H)
    check("departments -> 200, grouped by raw branch", r.status_code == 200 and r.json()["items"][0]["branch"] == "CSE", r.text)
    r = client.get(f"/admin/departments?college_id={uuid.uuid4()}", headers=H)
    check("departments scoped to a college -> 200", r.status_code == 200, r.text)

    print("\n== CTC by company ==")
    r = client.get("/admin/ctc-by-company", headers=H)
    check("ctc by company -> 200", r.status_code == 200 and r.json()["items"][0]["company_name"] == "K", r.text)

    print("\n== Granular Admin permissions: Super Admin vs delegated admin ==")
    # Every call below is a direct API request against the real routes and
    # dependencies (require_permission / require_super_admin), never a
    # simulated UI click — this is the "test direct API requests, not just
    # frontend buttons" requirement.
    seed_profiles(); install_rpc_defaults()
    db.tables["profiles"].append({"id": "u-delegated", "email": "delegated@t.test", "role": "admin", "is_super_admin": False})
    db.tables["profiles"].append({"id": "u-super2", "email": "super2@t.test", "role": "admin", "is_super_admin": True})
    TOKENS["tok-delegated"] = ("u-delegated", {"role": "admin"})
    TOKENS["tok-super2"] = ("u-super2", {"role": "admin"})
    H_SUPER, H_DEL = bearer("tok-admin"), bearer("tok-delegated")
    BETA_COLLEGE = "11111111-1111-1111-1111-111111111111"

    r = client.get("/admin/me", headers=H_SUPER)
    check("GET /admin/me: Super Admin -> is_super_admin true, no grant list needed",
          r.status_code == 200 and r.json()["is_super_admin"] is True, r.text)
    r = client.get("/admin/me", headers=H_DEL)
    check("GET /admin/me: fresh delegated admin -> is_super_admin false, no permissions yet",
          r.status_code == 200 and r.json()["is_super_admin"] is False and r.json()["permissions"] == [], r.text)
    for t in ("tok-candidate", "tok-company", "tok-college"):
        check(f"GET /admin/me ({t}): not an admin at all -> 403", client.get("/admin/me", headers=bearer(t)).status_code == 403)

    r = client.get("/admin/permissions/catalog", headers=H_DEL)
    check("GET /admin/permissions/catalog: any admin can read the catalog -> 200",
          r.status_code == 200 and any(m["module"] == "colleges" for m in r.json()["modules"]), r.text)

    print("\n-- A delegated admin with no grants is denied everywhere --")
    for path in ("/admin/colleges", "/admin/candidates", "/admin/users", "/admin/reports/platform-usage"):
        r = client.get(path, headers=H_DEL)
        check(f"no grants: GET {path} -> 403", r.status_code == 403, r.text)

    print("\n-- Only a Super Admin can manage admins/permissions, even with other grants --")
    r = client.post("/admin/admin-users", json={"email": "x@y.zz", "first_name": "A", "last_name": "B"}, headers=H_DEL)
    check("delegated admin cannot create another admin -> 403", r.status_code == 403, r.text)
    r = client.post("/admin/admin-users/u-delegated/permissions", json={"permission": "colleges.view"}, headers=H_DEL)
    check("delegated admin cannot grant THEMSELVES a permission -> 403", r.status_code == 403, r.text)
    r = client.post("/admin/admin-users/u-admin/permissions", json={"permission": "colleges.view"}, headers=H_DEL)
    check("delegated admin cannot grant ANOTHER user a permission either -> 403", r.status_code == 403, r.text)
    r = client.post("/admin/admin-users/u-admin/permissions", json={"permission": "colleges.view"}, headers=H_SUPER)
    check("granting a permission to a Super Admin is refused -> 409 (already has everything)", r.status_code == 409, r.text)

    print("\n-- View-only permission: read works, write/other-module don't --")
    r = client.post("/admin/admin-users/u-delegated/permissions", json={"permission": "candidates.view"}, headers=H_SUPER)
    check("Super Admin grants candidates.view -> 201", r.status_code == 201, r.text)
    candidates_grant_id = r.json()["id"]
    check("GET /admin/candidates: now allowed -> 200", client.get("/admin/candidates", headers=H_DEL).status_code == 200)
    check("GET /admin/candidates/export: view does not imply export -> 403",
          client.get("/admin/candidates/export", headers=H_DEL).status_code == 403)
    check("GET /admin/colleges: a different module entirely -> 403",
          client.get("/admin/colleges", headers=H_DEL).status_code == 403)
    check("POST /admin/colleges: candidates.view never implies a write on another module -> 403",
          client.post("/admin/colleges", json={"email": "x@y.zz", "first_name": "A", "last_name": "B", "college_name": "Z"}, headers=H_DEL).status_code == 403)

    print("\n-- Resource-scoped permission --")
    r = client.post("/admin/admin-users/u-delegated/permissions",
                     json={"permission": "colleges.view", "scope_type": "college", "scope_id": BETA_COLLEGE}, headers=H_SUPER)
    check(f"Super Admin grants colleges.view scoped to college {BETA_COLLEGE[:8]}... -> 201", r.status_code == 201, r.text)
    r = client.get(f"/admin/colleges/{BETA_COLLEGE}", headers=H_DEL)
    check("scoped permission: detail for the granted college -> 200", r.status_code == 200, r.text)
    other_college = str(uuid.uuid4())
    r = client.get(f"/admin/colleges/{other_college}", headers=H_DEL)
    check("scoped permission: detail for a DIFFERENT college -> 403 (never trusts the path id alone)", r.status_code == 403, r.text)
    db.rpc_calls.clear()
    r = client.get("/admin/colleges", headers=H_DEL)
    check("scoped permission: LIST is still allowed -> 200", r.status_code == 200, r.text)
    list_call = next(c for c in db.rpc_calls if c[0] == "admin_list_colleges")
    check("...and the scope is FORCED into the query server-side, not left to the client",
          list_call[1]["p_college_ids"] == [BETA_COLLEGE], list_call)

    print("\n-- Multi-scope: several grants of the SAME permission combine (union), never override each other --")
    GAMMA_COLLEGE = "33333333-3333-3333-3333-333333333333"
    DELTA_COLLEGE = "44444444-4444-4444-4444-444444444444"
    UNAUTHORIZED_COLLEGE = str(uuid.uuid4())  # never granted to u-delegated
    check("[1 scope] a college never granted -> 403 (unauthorized college)",
          client.get(f"/admin/colleges/{UNAUTHORIZED_COLLEGE}", headers=H_DEL).status_code == 403)

    r = client.post("/admin/admin-users/u-delegated/permissions",
                     json={"permission": "colleges.view", "scope_type": "college", "scope_id": GAMMA_COLLEGE}, headers=H_SUPER)
    check("[2 scopes] grant a SECOND colleges.view scope (Gamma) -> 201", r.status_code == 201, r.text)
    check("[2 scopes] detail: Beta (1st scope) still -> 200", client.get(f"/admin/colleges/{BETA_COLLEGE}", headers=H_DEL).status_code == 200)
    check("[2 scopes] detail: Gamma (2nd scope) -> 200 now that it is granted", client.get(f"/admin/colleges/{GAMMA_COLLEGE}", headers=H_DEL).status_code == 200)
    check("[2 scopes] detail: an unauthorized college -> still 403", client.get(f"/admin/colleges/{UNAUTHORIZED_COLLEGE}", headers=H_DEL).status_code == 403)
    db.rpc_calls.clear()
    r = client.get("/admin/colleges", headers=H_DEL)
    check("[2 scopes] list endpoint -> 200", r.status_code == 200, r.text)
    call2 = next(c for c in db.rpc_calls if c[0] == "admin_list_colleges")
    check("[2 scopes] list forces the UNION of both permitted colleges (not just one)",
          set(call2[1]["p_college_ids"]) == {BETA_COLLEGE, GAMMA_COLLEGE}, call2)
    for cid in (BETA_COLLEGE, GAMMA_COLLEGE):
        r = client.post("/admin/admin-users/u-delegated/permissions",
                         json={"permission": "colleges.export", "scope_type": "college", "scope_id": cid}, headers=H_SUPER)
        check(f"grant colleges.export scoped to {cid[:8]}... too (view does not imply export) -> 201", r.status_code == 201, r.text)
    db.rpc_calls.clear()
    r = client.get("/admin/colleges/export", headers=H_DEL)
    check("[2 scopes] export endpoint -> 200", r.status_code == 200, r.text)
    call2x = next(c for c in db.rpc_calls if c[0] == "admin_list_colleges")
    check("[2 scopes] export forces the same union", set(call2x[1]["p_college_ids"]) == {BETA_COLLEGE, GAMMA_COLLEGE}, call2x)

    r = client.post("/admin/admin-users/u-delegated/permissions",
                     json={"permission": "colleges.view", "scope_type": "college", "scope_id": DELTA_COLLEGE}, headers=H_SUPER)
    check("[3 scopes] grant a THIRD colleges.view scope (Delta) -> 201", r.status_code == 201, r.text)
    delta_grant_id = r.json()["id"]
    check("[3 scopes] detail: Delta (3rd scope) -> 200", client.get(f"/admin/colleges/{DELTA_COLLEGE}", headers=H_DEL).status_code == 200)
    db.rpc_calls.clear()
    client.get("/admin/colleges", headers=H_DEL)
    call3 = next(c for c in db.rpc_calls if c[0] == "admin_list_colleges")
    check("[3 scopes] list forces the union of all THREE permitted colleges",
          set(call3[1]["p_college_ids"]) == {BETA_COLLEGE, GAMMA_COLLEGE, DELTA_COLLEGE}, call3)

    print("\n-- Multi-scope: revoking ONE scoped grant only shrinks that one --")
    r = client.post(f"/admin/admin-users/u-delegated/permissions/{delta_grant_id}/revoke", headers=H_SUPER)
    check("revoke the Delta scope specifically -> 200", r.status_code == 200, r.text)
    check("revoked scoped permission: Delta -> 403 immediately", client.get(f"/admin/colleges/{DELTA_COLLEGE}", headers=H_DEL).status_code == 403)
    check("...the other two scopes are untouched -> still 200",
          client.get(f"/admin/colleges/{BETA_COLLEGE}", headers=H_DEL).status_code == 200
          and client.get(f"/admin/colleges/{GAMMA_COLLEGE}", headers=H_DEL).status_code == 200)
    db.rpc_calls.clear()
    client.get("/admin/colleges", headers=H_DEL)
    call_after_revoke = next(c for c in db.rpc_calls if c[0] == "admin_list_colleges")
    check("...and the list's union shrinks to the remaining 2, not left over from before",
          set(call_after_revoke[1]["p_college_ids"]) == {BETA_COLLEGE, GAMMA_COLLEGE}, call_after_revoke)

    print("\n-- Multi-scope: an expired scoped grant drops out of the union; others unaffected --")
    near_future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    r = client.post("/admin/admin-users/u-delegated/permissions",
                     json={"permission": "colleges.view", "scope_type": "college", "scope_id": DELTA_COLLEGE, "expires_at": near_future},
                     headers=H_SUPER)
    check("re-grant the Delta scope with a future expiry -> 201", r.status_code == 201, r.text)
    check("not yet expired -> 200", client.get(f"/admin/colleges/{DELTA_COLLEGE}", headers=H_DEL).status_code == 200)
    for row in db.tables["admin_user_permissions"]:
        if row["user_id"] == "u-delegated" and row["permission"] == "colleges.view" and row["scope_id"] == DELTA_COLLEGE:
            row["expires_at"] = "2020-01-01T00:00:00+00:00"  # simulate time passing
    check("expired scoped permission: Delta -> 403", client.get(f"/admin/colleges/{DELTA_COLLEGE}", headers=H_DEL).status_code == 403)
    check("...Beta / Gamma (not expired) -> still 200",
          client.get(f"/admin/colleges/{BETA_COLLEGE}", headers=H_DEL).status_code == 200
          and client.get(f"/admin/colleges/{GAMMA_COLLEGE}", headers=H_DEL).status_code == 200)
    db.rpc_calls.clear()
    client.get("/admin/colleges", headers=H_DEL)
    call_after_expiry = next(c for c in db.rpc_calls if c[0] == "admin_list_colleges")
    check("...the expired scope is excluded from the list's union too",
          set(call_after_expiry[1]["p_college_ids"]) == {BETA_COLLEGE, GAMMA_COLLEGE}, call_after_expiry)

    print("\n-- Multi-scope: a GLOBAL grant of the SAME permission always wins, never additively combined with scoped ones --")
    # candidates.view was granted GLOBALLY earlier in this run and is still active on
    # u-delegated at this point (it isn't revoked until the section below).
    check("global candidates.view -> 200, unfiltered", client.get("/admin/candidates", headers=H_DEL).status_code == 200)
    r = client.post("/admin/admin-users/u-delegated/permissions",
                     json={"permission": "candidates.view", "scope_type": "college", "scope_id": DELTA_COLLEGE}, headers=H_SUPER)
    check("ALSO grant candidates.view scoped to Delta, on top of the existing global grant -> 201", r.status_code == 201, r.text)
    db.rpc_calls.clear()
    r = client.get("/admin/candidates", headers=H_DEL)
    check("mixed global+scoped: list endpoint still -> 200", r.status_code == 200, r.text)
    mixed_call = next(c for c in db.rpc_calls if c[0] == "admin_list_candidates")
    check("...global still means UNRESTRICTED: no p_college_ids override is applied despite the scoped grant existing too",
          "p_college_ids" not in mixed_call[1], mixed_call)
    # Clean up the extra scoped grant so the "revoke -> 403" assertion further below
    # (which revokes only the GLOBAL candidates.view grant) is not masked by it.
    scoped_cand = next(g for g in db.tables["admin_user_permissions"]
                        if g["user_id"] == "u-delegated" and g["permission"] == "candidates.view" and g["scope_type"] == "college")
    check("cleanup: revoke the extra scoped candidates.view grant -> 200",
          client.post(f"/admin/admin-users/u-delegated/permissions/{scoped_cand['id']}/revoke", headers=H_SUPER).status_code == 200)

    print("\n-- Expiring permissions (checked live, no cleanup job) --")
    r = client.post("/admin/admin-users/u-delegated/permissions",
                     json={"permission": "reports.view", "expires_at": "2020-01-01T00:00:00Z"}, headers=H_SUPER)
    check("granting with a past expires_at is rejected -> 422", r.status_code == 422, r.text)
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    r = client.post("/admin/admin-users/u-delegated/permissions", json={"permission": "reports.view", "expires_at": future}, headers=H_SUPER)
    check("granting reports.view until tomorrow -> 201", r.status_code == 201, r.text)
    check("not yet expired -> 200", client.get("/admin/reports/platform-usage", headers=H_DEL).status_code == 200)
    for row in db.tables["admin_user_permissions"]:
        if row["user_id"] == "u-delegated" and row["permission"] == "reports.view":
            row["expires_at"] = "2020-01-01T00:00:00+00:00"  # simulate time passing
    check("expired permission -> 403 immediately, nothing had to run to expire it",
          client.get("/admin/reports/platform-usage", headers=H_DEL).status_code == 403)

    print("\n-- Revoke: one, then all --")
    check("candidates.view still active before revoke -> 200", client.get("/admin/candidates", headers=H_DEL).status_code == 200)
    r = client.post(f"/admin/admin-users/u-delegated/permissions/{candidates_grant_id}/revoke", headers=H_SUPER)
    check("Super Admin revokes candidates.view -> 200", r.status_code == 200, r.text)
    check("revoked permission -> 403 on the very next request, no re-login required",
          client.get("/admin/candidates", headers=H_DEL).status_code == 403)
    check("the scoped colleges.view grant is untouched by revoking a DIFFERENT grant -> 200",
          client.get(f"/admin/colleges/{BETA_COLLEGE}", headers=H_DEL).status_code == 200)
    r = client.post("/admin/admin-users/u-delegated/permissions/revoke-all", headers=H_SUPER)
    check("Super Admin revokes ALL of the delegated admin's permissions at once -> 200", r.status_code == 200, r.text)
    check("...and every module is now denied again", client.get(f"/admin/colleges/{BETA_COLLEGE}", headers=H_DEL).status_code == 403)

    print("\n-- Disabling reuses the EXISTING block/unblock mechanism --")
    r = client.post("/admin/admin-users/u-delegated/permissions", json={"permission": "colleges.view"}, headers=H_SUPER)
    check("re-grant colleges.view for the disable test -> 201", r.status_code == 201, r.text)
    check("granted -> 200 before disabling", client.get("/admin/colleges", headers=H_DEL).status_code == 200)
    r = client.post("/admin/admin-users/u-delegated/permissions", json={"permission": "users.view"}, headers=H_SUPER)
    check("also grant users.view so a Super Admin can list admins", r.status_code == 201, r.text)
    r = client.post("/admin/users/u-delegated/block", json={"permanent": True, "reason": "left the team"}, headers=H_SUPER)
    check("Super Admin disables (blocks) the delegated admin -> 200", r.status_code == 200, r.text)
    check("disabled delegated admin -> 403 on every route, even one they had a live grant for",
          client.get("/admin/colleges", headers=H_DEL).status_code == 403)
    r = client.post("/admin/users/u-delegated/unblock", json={}, headers=H_SUPER)
    check("Super Admin re-enables the delegated admin -> 200", r.status_code == 200, r.text)
    check("reactivated -> access restored without re-granting anything",
          client.get("/admin/colleges", headers=H_DEL).status_code == 200)

    print("\n-- A Super Admin cannot be disabled by a delegated admin --")
    r = client.post("/admin/admin-users/u-delegated/permissions", json={"permission": "users.block"}, headers=H_SUPER)
    check("grant users.block to the delegated admin -> 201", r.status_code == 201, r.text)
    r = client.post("/admin/users/u-super2/block", json={"permanent": True, "reason": "test"}, headers=H_DEL)
    check("delegated admin WITH users.block still cannot disable a Super Admin -> 403", r.status_code == 403, r.text)
    r = client.post("/admin/users/u-candidate/block", json={"permanent": True, "reason": "test"}, headers=H_DEL)
    check("...but CAN block an ordinary account with that same permission -> 200", r.status_code == 200, r.text)
    client.post("/admin/users/u-candidate/unblock", json={}, headers=H_SUPER)

    print("\n-- Permission history & viewing another admin's grants --")
    r = client.get("/admin/admin-users/u-delegated/permissions", headers=H_SUPER)
    check("Super Admin can view a delegated admin's permissions + history -> 200",
          r.status_code == 200 and "history" in r.json() and "permissions" in r.json(), r.text)
    r = client.get("/admin/admin-users/u-delegated/permissions", headers=H_DEL)
    check("a delegated admin can view their OWN permissions -> 200", r.status_code == 200, r.text)
    r = client.get("/admin/admin-users/u-admin/permissions", headers=H_DEL)
    check("...but not another admin's -> 403", r.status_code == 403, r.text)
    granted = [e for e in db.tables.get("admin_events", []) if e["event_type"] == "permission_granted"]
    revoked = [e for e in db.tables.get("admin_events", []) if e["event_type"] == "permission_revoked"]
    check("every grant above was recorded as permission_granted", len(granted) >= 5, len(granted))
    check("every revoke (single + revoke-all) was recorded as permission_revoked", len(revoked) >= 3, len(revoked))
    check("a permission_granted event names the granter, target and permission",
          granted[0]["actor_label"] == "u-admin@t.test" and granted[0]["target_id"] == "u-delegated"
          and "permission" in granted[0]["metadata"], granted[0])

    print("\n-- Invalid grants are rejected --")
    check("unknown permission -> 422",
          client.post("/admin/admin-users/u-delegated/permissions", json={"permission": "not.a.real.permission"}, headers=H_SUPER).status_code == 422)
    check("scoping a global-only permission (users.view) to a college -> 422",
          client.post("/admin/admin-users/u-delegated/permissions",
                       json={"permission": "users.view", "scope_type": "college", "scope_id": BETA_COLLEGE}, headers=H_SUPER).status_code == 422)
    check("scoping to a college that does not exist -> 404",
          client.post("/admin/admin-users/u-delegated/permissions",
                       json={"permission": "colleges.view", "scope_type": "college", "scope_id": str(uuid.uuid4())}, headers=H_SUPER).status_code == 404)
    check("granting to a non-admin account -> 422",
          client.post("/admin/admin-users/u-candidate/permissions", json={"permission": "colleges.view"}, headers=H_SUPER).status_code == 422)

    print("\n-- Creating a delegated admin --")
    r = client.post("/admin/admin-users", json={"email": "newdelegate@t.test", "first_name": "New", "last_name": "Delegate"}, headers=H_SUPER)
    check("Super Admin creates a delegated admin -> 201/200", r.status_code in (200, 201), r.text)
    new_id = r.json()["user_id"]
    new_profile = next(p for p in db.tables["profiles"] if p["id"] == new_id)
    check("a freshly-created delegated admin is NOT a Super Admin by default",
          not new_profile.get("is_super_admin"), new_profile)
    r = client.get(f"/admin/admin-users/{new_id}/permissions", headers=H_SUPER)
    check("a brand-new delegated admin starts with zero permissions", r.status_code == 200 and r.json()["permissions"] == [], r.text)

    r = client.post("/admin/admin-users",
                     json={"email": "sneaky@t.test", "first_name": "Sneaky", "last_name": "One", "is_super_admin": True},
                     headers=H_SUPER)
    check("smuggling is_super_admin=true in the create-admin body -> silently ignored, not honored -> 201", r.status_code == 201, r.text)
    sneaky_id = r.json()["user_id"]
    sneaky_profile = next(p for p in db.tables["profiles"] if p["id"] == sneaky_id)
    check("...the created account is still an ordinary (non-super) delegated admin",
          not sneaky_profile.get("is_super_admin"), sneaky_profile)

    print("\n== Global search is gated per entity type by the SAME view permissions, not a free-for-all ==")
    # Regression test for a real hole: admin_global_search's candidate branch
    # returns a real email address, so a delegated admin with NO candidates.view
    # must not be able to discover one by searching, even though search is a
    # cross-entity convenience feature. See routers/admin/search.py.
    seed_profiles(); install_rpc_defaults()
    db.tables["profiles"].append({"id": "u-search-del", "email": "searchdel@t.test", "role": "admin", "is_super_admin": False})
    TOKENS["tok-search-del"] = ("u-search-del", {"role": "admin"})
    H_SEARCH_DEL = bearer("tok-search-del")
    db.rpc_results["admin_global_search"] = [
        {"entity_type": "college", "id": "col-1", "title": "Alpha College", "subtitle": "Pune"},
        {"entity_type": "candidate", "id": "u-candidate", "title": "Cara Candidate", "subtitle": "cara@t.test"},
    ]

    r = client.get("/admin/search?q=a", headers=H_SEARCH_DEL)
    check("delegated admin with ZERO permissions: search -> 200 but every group is empty (no leaked candidate email)",
          r.status_code == 200 and r.json()["groups"] == {}, r.text)

    r = client.post("/admin/admin-users/u-search-del/permissions", json={"permission": "colleges.view"}, headers=H_SUPER)
    check("grant colleges.view only -> 201", r.status_code == 201, r.text)
    r = client.get("/admin/search?q=a", headers=H_SEARCH_DEL)
    body = r.json()
    check("with only colleges.view: college results appear, candidate results are still withheld",
          r.status_code == 200 and "college" in body["groups"] and "candidate" not in body["groups"], body)

    r = client.post("/admin/admin-users/u-search-del/permissions", json={"permission": "candidates.view"}, headers=H_SUPER)
    check("also grant candidates.view -> 201", r.status_code == 201, r.text)
    r = client.get("/admin/search?q=a", headers=H_SEARCH_DEL)
    body = r.json()
    check("with candidates.view too: both groups now appear",
          r.status_code == 200 and "college" in body["groups"] and "candidate" in body["groups"], body)

    # A candidates.view scoped to one college must narrow search the same way
    # it narrows /admin/candidates — verified via the RPC params sent, exactly
    # like the list/export scoping tests above (FakeDB doesn't simulate the
    # SQL WHERE clause itself; that is covered end-to-end in test_admin_portal_sql.py).
    r = client.post("/admin/admin-users/u-search-del/permissions/revoke-all", headers=H_SUPER)
    check("cleanup: revoke all of u-search-del's permissions -> 200", r.status_code == 200, r.text)
    r = client.post("/admin/admin-users/u-search-del/permissions",
                     json={"permission": "candidates.view", "scope_type": "college", "scope_id": BETA_COLLEGE}, headers=H_SUPER)
    check("grant candidates.view scoped to one college -> 201", r.status_code == 201, r.text)
    db.rpc_calls.clear()
    client.get("/admin/search?q=a", headers=H_SEARCH_DEL)
    search_call = next(c for c in db.rpc_calls if c[0] == "admin_global_search")
    check("...and the search RPC call itself carries the scope's college_ids, not an unrestricted search",
          search_call[1].get("p_college_ids") == [BETA_COLLEGE], search_call)

    print(f"\n=== {passed}/{passed + failed} passed, {failed} failed ===")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
