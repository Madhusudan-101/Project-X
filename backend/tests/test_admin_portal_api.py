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


def seed_profiles():
    db.reset()
    db.tables["profiles"] = [{"id": uid, "email": f"{uid}@t.test", "role": role} for uid, role in ROLES.items()]
    db.tables["colleges"] = [{"id": "col-1", "name": "Alpha College"}]


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
    })


def admin_get_routes():
    """Every GET route under /admin, discovered from the live app."""
    paths = app.openapi()["paths"]
    out = []
    for path, ops in paths.items():
        if not path.startswith("/admin"):
            continue
        concrete = path.replace("{college_id}", str(uuid.uuid4())).replace("{company_id}", str(uuid.uuid4()))
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

    print(f"\n=== {passed}/{passed + failed} passed, {failed} failed ===")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
