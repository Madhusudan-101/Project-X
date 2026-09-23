"""
College Portal student access control + onboarding invites -- pytest-free,
no network, no database. Same approach as test_admin_portal_api.py: boots the
real FastAPI app and replaces only the Supabase clients with in-memory fakes.

Verifies:
  * a TPO can block / restrict / unblock only their OWN college's students
    (college A can never touch college B's roster, even by id);
  * blocking/restricting a roster row that has a matching candidate account
    (same email, same college) is mirrored onto that profiles row and is
    enforced on the candidate's very next request -- not just a roster label;
  * unblock restores access immediately;
  * validation (duration enum, custom needs 'until', reason required);
  * every /api/students/* write requires a College session (candidate/company/
    admin/anonymous all rejected);
  * the onboarding-invite flow: correct skip/invite/failure counts, no
    cross-college leak via a crafted studentIds list, no duplicate invites,
    no invite to a blocked/restricted student, a per-student failure never
    aborts the batch, and the plan is read from the database, never hardcoded.

Run with:  python tests/test_college_student_access.py   (exit 0 = all passed)
"""

from __future__ import annotations

import os
import sys
import uuid
from types import SimpleNamespace

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


# ── Fake Supabase (same shape as test_admin_portal_api.py's) ──────────────

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

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def eq(self, col, val):
        self.filters.append((col, val, "eq"))
        return self

    def in_(self, col, vals):
        self.filters.append((col, set(vals), "in"))
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

    def _match(self, row):
        for col, val, kind in self.filters:
            have = row.get(col)
            if kind == "in":
                if have not in val:
                    return False
            elif kind == "ilike":
                if str(have or "").lower() != str(val).lower():
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
        if self.op == "update":
            hit = [r for r in rows if self._match(r)]
            for r in hit:
                r.update(self.payload)
            self.db.updates.append((self.name, dict(self.payload)))
            return _Res([dict(r) for r in hit])
        raise AssertionError(self.op)


class FakeDB:
    def __init__(self):
        self.reset()

    def reset(self):
        self.tables: dict = {"profiles": [], "colleges": [], "students": []}
        self.updates: list = []
        self.invites: list = []
        self.fail_invite_for: set = set()

    def table(self, name):
        return _Query(self, name)


db = FakeDB()

# Tokens: token -> (user id, editable user_metadata)
TOKENS = {
    "tok-tpo1": ("u-tpo1", {"role": "college"}),
    "tok-tpo2": ("u-tpo2", {"role": "college"}),
    "tok-cand1": ("u-cand1", {"role": "candidate"}),  # linked to college 1, email matches roster row s1
    "tok-cand2": ("u-cand2", {"role": "candidate"}),  # unrelated candidate, own college
    "tok-candidate": ("u-cand-generic", {"role": "candidate"}),
    "tok-company": ("u-company", {"role": "company"}),
    "tok-admin": ("u-admin", {"role": "admin"}),
}


def fake_get_user(token):
    if token not in TOKENS:
        raise AuthApiError("invalid JWT", 401, "bad_jwt")
    uid, meta = TOKENS[token]
    return SimpleNamespace(user=SimpleNamespace(id=uid, email=f"{uid}@t.test", user_metadata=meta))


def fake_invite_user_by_email(email, options=None):
    db.invites.append({"email": email, "options": options or {}})
    if email in db.fail_invite_for:
        raise AuthApiError("could not send invite", 500, "unexpected_failure")
    return SimpleNamespace(user=SimpleNamespace(id=str(uuid.uuid4()), email=email))


deps.db_client.table = db.table
deps.auth_client.auth.get_user = fake_get_user
deps.admin_client.auth.admin.invite_user_by_email = fake_invite_user_by_email

# students.py runs its own-college queries through the RLS-bound client
# get_user_supabase() builds per request (create_client(...) against the real
# Supabase URL) rather than the shared db_client instance above, so it can't
# be patched by attribute assignment the way db_client/auth_client are.
# Overriding the FastAPI dependency itself is the intended mechanism for
# exactly this: RLS's tenant-isolation is already covered by
# test_admin_portal_sql.py's Security section, so a client backed by the SAME
# FakeDB (no RLS simulated) is the right level of fake for testing this
# ROUTER's own logic (college_id scoping, block resolution, propagation).
app.dependency_overrides[deps.get_user_supabase] = lambda: SimpleNamespace(table=db.table)

client = TestClient(app, raise_server_exceptions=False)


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


COL1, COL2 = "col-1", "col-2"


def seed():
    db.reset()
    db.tables["profiles"] = [
        {"id": "u-tpo1", "email": "tpo1@t.test", "role": "college", "college_id": COL1},
        {"id": "u-tpo2", "email": "tpo2@t.test", "role": "college", "college_id": COL2},
        {"id": "u-cand1", "email": "s1@x.test", "role": "candidate", "college_id": COL1},
        {"id": "u-cand2", "email": "u-cand2@t.test", "role": "candidate", "college_id": COL1},
        {"id": "u-cand-generic", "email": "u-cand-generic@t.test", "role": "candidate", "college_id": None},
        {"id": "u-company", "email": "u-company@t.test", "role": "company"},
        {"id": "u-admin", "email": "u-admin@t.test", "role": "admin"},
    ]
    db.tables["colleges"] = [
        {"id": COL1, "name": "Alpha College", "plan": "pro"},
        {"id": COL2, "name": "Beta Institute", "plan": "standard"},
    ]
    db.tables["students"] = [
        {"id": "s1", "college_id": COL1, "name": "Stu One", "email": "s1@x.test", "branch": "CSE",
         "graduation_year": 2026, "status": "active", "invited_at": None},
        {"id": "s2", "college_id": COL1, "name": "Stu Two", "email": "s2@x.test", "branch": "CSE",
         "graduation_year": 2026, "status": "active", "invited_at": None},
        {"id": "s3", "college_id": COL2, "name": "Stu Three", "email": "s3@x.test", "branch": "ECE",
         "graduation_year": 2026, "status": "active", "invited_at": None},
        {"id": "s-bad-email", "college_id": COL1, "name": "Bad Email", "email": "not-an-email",
         "branch": "CSE", "graduation_year": 2026, "status": "active", "invited_at": None},
        {"id": "s-invited", "college_id": COL1, "name": "Already Invited", "email": "already@x.test",
         "branch": "CSE", "graduation_year": 2026, "status": "active", "invited_at": "2026-01-01T00:00:00Z"},
    ]


def main() -> int:
    print("\n== Every /api/students/* write requires a College session ==")
    seed()
    for path, method, body in (
        ("/api/students/s1/block", "post", {"duration": "24h", "reason": "x"}),
        ("/api/students/s1/restrict", "post", {"reason": "x"}),
        ("/api/students/s1/unblock", "post", {}),
        ("/api/students/onboard", "post", {}),
    ):
        r = getattr(client, method)(path)
        check(f"{method.upper()} {path} with no token -> 401", r.status_code == 401, (r.status_code, r.text))
        for tok, label in (("tok-candidate", "candidate"), ("tok-company", "company"), ("tok-admin", "admin")):
            r = getattr(client, method)(path, json=body, headers=bearer(tok))
            check(f"{method.upper()} {path} as {label} -> 403", r.status_code == 403, (r.status_code, r.text))

    print("\n== Validation ==")
    seed()
    H1 = bearer("tok-tpo1")
    for bad, label in (
        ({"reason": "x"}, "block: missing duration"),
        ({"duration": "9d", "reason": "x"}, "block: unknown duration"),
        ({"duration": "custom", "reason": "x"}, "block: custom with no 'until'"),
        ({"duration": "24h", "reason": ""}, "block: empty reason"),
    ):
        r = client.post("/api/students/s1/block", json=bad, headers=H1)
        check(f"{label} -> 422", r.status_code == 422, (r.status_code, r.text[:120]))
    r = client.post("/api/students/s1/restrict", json={"reason": ""}, headers=H1)
    check("restrict: empty reason -> 422", r.status_code == 422, (r.status_code, r.text[:120]))

    print("\n== Temporary block: roster status + linked account both restricted, and it's ENFORCED ==")
    seed()
    r = client.post("/api/students/s1/block", json={"duration": "24h", "reason": "cheating report"}, headers=H1)
    check("block -> 200", r.status_code == 200, (r.status_code, r.text))
    body = r.json()
    check("roster row shows temporarily_blocked with a future blocked_until",
          body["student"]["status"] == "temporarily_blocked" and body["student"]["blocked_until"], body["student"])
    check("response says the linked candidate account was restricted too", body["accountRestricted"] is True, body)
    profile = next(p for p in db.tables["profiles"] if p["id"] == "u-cand1")
    check("profiles row mirrors the block (temporary, not permanent)",
          profile["blocked_permanent"] is False and profile["blocked_until"] and profile["blocked_reason"] == "cheating report", profile)
    check("the block is enforced on the candidate's very NEXT request",
          client.get("/auth/profile", headers=bearer("tok-cand1")).status_code == 403)
    check("...with the reason in the response", "cheating report" in client.get("/auth/profile", headers=bearer("tok-cand1")).text)
    check("an unrelated candidate at the same college is unaffected",
          client.get("/auth/profile", headers=bearer("tok-cand2")).status_code == 200)

    print("\n== Permanent restriction ==")
    seed()
    r = client.post("/api/students/s1/restrict", json={"reason": "policy violation"}, headers=H1)
    check("restrict -> 200, status=restricted, no blocked_until", r.status_code == 200 and r.json()["student"]["status"] == "restricted" and r.json()["student"]["blocked_until"] is None, r.text)
    profile = next(p for p in db.tables["profiles"] if p["id"] == "u-cand1")
    check("profiles row mirrors it as PERMANENT", profile["blocked_permanent"] is True, profile)
    check("enforced immediately", client.get("/auth/profile", headers=bearer("tok-cand1")).status_code == 403)

    print("\n== Unblock restores access ==")
    r = client.post("/api/students/s1/unblock", json={"reason": "appeal upheld"}, headers=H1)
    check("unblock -> 200, status=active", r.status_code == 200 and r.json()["student"]["status"] == "active", r.text)
    profile = next(p for p in db.tables["profiles"] if p["id"] == "u-cand1")
    check("every block field cleared on the profile", not any(profile.get(k) for k in ("blocked_permanent", "blocked_until", "blocked_by", "blocked_reason")), profile)
    check("access restored", client.get("/auth/profile", headers=bearer("tok-cand1")).status_code == 200)

    print("\n== A roster row with no matching platform account is still labelled, without error ==")
    seed()
    r = client.post("/api/students/s2/block", json={"duration": "1h", "reason": "x"}, headers=H1)
    check("blocking a student with no linked account -> 200, accountRestricted=false", r.status_code == 200 and r.json()["accountRestricted"] is False, r.text)

    print("\n== College isolation: a TPO cannot touch another college's roster ==")
    seed()
    H2 = bearer("tok-tpo2")
    for path in ("/api/students/s1/block", "/api/students/s1/restrict", "/api/students/s1/unblock"):
        body = {"duration": "1h", "reason": "x"} if path.endswith("block") else {"reason": "x"}
        r = client.post(path, json=body, headers=H2)
        check(f"college 2 TPO acting on college 1's student ({path.split('/')[-1]}) -> 404, nothing changed",
              r.status_code == 404, (r.status_code, r.text))
    check("...and the student really is untouched", next(s for s in db.tables["students"] if s["id"] == "s1")["status"] == "active")
    check("...and no profile was touched", not db.updates or all(t != "profiles" for t, _ in db.updates))

    print("\n== Onboarding invites: skip/invite counts, plan read from the database ==")
    seed()
    r = client.post("/api/students/onboard", json={}, headers=H1)
    check("onboard -> 200", r.status_code == 200, (r.status_code, r.text))
    body = r.json()
    check("considered = every college-1 student (4: s1, s2, s-bad-email, s-invited)",
          body["considered"] == 4, body)
    check("invited = 1 (only s2 is clean, unblocked, unregistered and uninvited -- s1 is already registered)",
          body["invited"] == 1, body)
    check("s1 was skipped as already-registered (linked to u-cand1) -- so NOT counted in invited",
          not any(i["email"] == "s1@x.test" for i in db.invites), db.invites)
    check("skippedInvalidEmail = 1 (the not-an-email row)", body["skippedInvalidEmail"] == 1, body)
    check("skippedAlreadyInvited = 1 (invited_at already set)", body["skippedAlreadyInvited"] == 1, body)
    check("skippedAlreadyRegistered = 1 (s1, matched by email+college to u-cand1)", body["skippedAlreadyRegistered"] == 1, body)
    check("plan is read from the college row (pro), never hardcoded", body["plan"] == "pro", body)
    check("each invite carries the role/college/plan the new account should get, not a password",
          all(i["options"]["data"]["collegeId"] == COL1 and i["options"]["data"]["role"] == "candidate" and i["options"]["data"]["plan"] == "pro" for i in db.invites)
          and not any("password" in i["options"]["data"] for i in db.invites), db.invites)
    check("s2's roster row now has invited_at set (won't be re-invited)",
          next(s for s in db.tables["students"] if s["id"] == "s2")["invited_at"] is not None)

    print("\n== Re-running onboarding is idempotent: no duplicate invites ==")
    db.invites.clear()
    r = client.post("/api/students/onboard", json={}, headers=H1)
    check("second run invites 0 (everyone eligible was already invited last time)", r.json()["invited"] == 0, r.json())
    check("...and genuinely sent zero new emails", db.invites == [], db.invites)

    print("\n== A blocked/restricted student is never invited ==")
    seed()
    client.post("/api/students/s2/restrict", json={"reason": "x"}, headers=H1)
    r = client.post("/api/students/onboard", json={"studentIds": ["s2"]}, headers=H1)
    check("restricted student -> skippedBlocked=1, invited=0, no email sent", r.json()["skippedBlocked"] == 1 and r.json()["invited"] == 0 and not db.invites, r.json())

    print("\n== studentIds scoping never leaks another college's roster ==")
    seed()
    r = client.post("/api/students/onboard", json={"studentIds": ["s3"]}, headers=H1)  # s3 belongs to college 2
    check("college 1 TPO passing college 2's student id -> considered=0, nothing sent",
          r.json()["considered"] == 0 and r.json()["invited"] == 0 and not db.invites, r.json())

    print("\n== A per-student invite failure never aborts the batch ==")
    seed()
    db.fail_invite_for = {"s1@x.test"}
    db.tables["profiles"] = [p for p in db.tables["profiles"] if p["id"] != "u-cand1"]  # s1 no longer "already registered"
    r = client.post("/api/students/onboard", json={"studentIds": ["s1", "s2"]}, headers=H1)
    body = r.json()
    check("s1's invite fails, s2's still succeeds -- failed=1, invited=1", body["failed"] == 1 and body["invited"] == 1, body)
    check("the failed student's invited_at was NOT set (so a retry will actually retry it)",
          next(s for s in db.tables["students"] if s["id"] == "s1")["invited_at"] is None)

    print(f"\n=== {passed}/{passed + failed} passed, {failed} failed ===")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
