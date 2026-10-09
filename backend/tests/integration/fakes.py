"""In-memory stand-ins for the Supabase PostgREST + GoTrue surface the app uses.

Deliberately small but behaviour-faithful for what the routers rely on:
filters, ordering, limit/range, single/maybe_single, count="exact",
insert defaults, unique constraints (23505), upsert(on_conflict), update/delete.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional

from postgrest.exceptions import APIError
from supabase_auth.errors import AuthApiError


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# table -> tuple of columns that must be unique together (besides id)
UNIQUE: Dict[str, List[tuple]] = {
    "applications": [("student_id", "job_id")],
    "companies": [("owner_id",)],
    "job_drives": [("job_id", "college_id")],
    "students": [("college_id", "email")],
    "job_weights": [("job_id",)],
    "profiles": [("id",)],
}

# table -> {embedded resource: foreign key column on this table}
RELATIONS: Dict[str, Dict[str, str]] = {"job_skills": {"skills": "skill_id"}}

# table -> defaults applied on insert
DEFAULTS: Dict[str, Callable[[], dict]] = {
    "jobs": lambda: {"status": "draft"},
    "applications": lambda: {"status": "applied", "applied_at": now_iso(), "updated_at": now_iso()},
    "job_drives": lambda: {"status": "draft"},
    "application_analyses": lambda: {"generated_at": now_iso()},
    "job_roles": lambda: {"status": "draft"},
    "students": lambda: {
        "employability_score": 0, "verification_status": "pending", "placement_status": "not_placed",
    },
}


class Res(SimpleNamespace):
    pass


def _err(message: str, code: str) -> APIError:
    return APIError({"message": message, "code": code, "hint": None, "details": None})


class Query:
    def __init__(self, db: "FakeDB", table: str):
        self.db, self.table = db, table
        self.op = "select"
        self.payload: Any = None
        self.filters: List[Callable[[dict], bool]] = []
        self._order: Optional[tuple] = None
        self._limit: Optional[int] = None
        self._range: Optional[tuple] = None
        self._single = False
        self._maybe = False
        self._count = False
        self._conflict: Optional[str] = None
        self._cols = "*"

    # builders -----------------------------------------------------
    def select(self, *a, count=None, **_k):
        if self.op == "select":
            self._count = count == "exact"
            self._cols = a[0] if a else "*"
        return self

    def insert(self, payload, **_k): self.op, self.payload = "insert", payload; return self
    def update(self, payload, **_k): self.op, self.payload = "update", payload; return self
    def delete(self, **_k): self.op = "delete"; return self

    def upsert(self, payload, on_conflict=None, **_k):
        self.op, self.payload, self._conflict = "upsert", payload, on_conflict
        return self

    def eq(self, c, v): self.filters.append(lambda r: r.get(c) == v); return self
    def neq(self, c, v): self.filters.append(lambda r: r.get(c) != v); return self
    def gt(self, c, v): self.filters.append(lambda r: r.get(c) is not None and r[c] > v); return self
    def gte(self, c, v): self.filters.append(lambda r: r.get(c) is not None and r[c] >= v); return self
    def lt(self, c, v): self.filters.append(lambda r: r.get(c) is not None and r[c] < v); return self
    def lte(self, c, v): self.filters.append(lambda r: r.get(c) is not None and r[c] <= v); return self
    def in_(self, c, vs): s = list(vs); self.filters.append(lambda r: r.get(c) in s); return self

    def is_(self, c, v):
        want = None if v in ("null", None) else v
        self.filters.append(lambda r: r.get(c) == want)
        return self

    def ilike(self, c, pattern):
        out, i = [], 0
        while i < len(pattern):
            ch = pattern[i]
            if ch == "\\" and i + 1 < len(pattern):
                out.append(re.escape(pattern[i + 1])); i += 2; continue
            out.append(".*" if ch in "%*" else "." if ch == "_" else re.escape(ch)); i += 1
        rx = re.compile("".join(out), re.I | re.S)
        self.filters.append(lambda r: r.get(c) is not None and rx.fullmatch(str(r[c])) is not None)
        return self

    def order(self, c, desc=False, **_k): self._order = (c, desc); return self
    def limit(self, n): self._limit = n; return self
    def range(self, a, b): self._range = (a, b); return self
    def single(self): self._single = True; return self
    def maybe_single(self): self._single = self._maybe = True; return self

    # execution ----------------------------------------------------
    def _match(self, row): return all(f(row) for f in self.filters)

    def _check_unique(self, rows, new, ignore=None):
        for cols in UNIQUE.get(self.table, []):
            if any(new.get(c) is None for c in cols):
                continue
            for r in rows:
                if r is ignore:
                    continue
                if all(r.get(c) == new.get(c) for c in cols):
                    raise _err(f'duplicate key value violates unique constraint on {self.table}({",".join(cols)})', "23505")

    def _embed(self, row: dict) -> dict:
        """PostgREST resource embedding, e.g. select("skills(name)") on job_skills."""
        for rel, fk in RELATIONS.get(self.table, {}).items():
            if re.search(rf"\b{rel}\(", str(self._cols)):
                row[rel] = next((dict(x) for x in self.db.tables.get(rel, []) if x.get("id") == row.get(fk)), None)
        return row

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        self.db.log.append((self.op, self.table))
        if self.table in self.db.fail_tables.get(self.op, set()):
            raise _err(f"injected failure on {self.op} {self.table}", "XX000")

        if self.op in ("insert", "upsert") and isinstance(self.payload, list):
            items = self.payload
        elif self.op in ("insert", "upsert"):
            items = [self.payload]
        else:
            items = []

        if self.op == "insert":
            out = []
            for it in items:
                row = {"id": str(uuid.uuid4()), "created_at": now_iso(), "updated_at": now_iso(),
                       **DEFAULTS.get(self.table, lambda: {})(), **it}
                self._check_unique(rows, row)
                rows.append(row); out.append(dict(row))
            return Res(data=out, count=None)

        if self.op == "upsert":
            keys = (self._conflict or "id").split(",")
            out = []
            for it in items:
                existing = next((r for r in rows if all(r.get(k) == it.get(k) for k in keys) and
                                 all(it.get(k) is not None for k in keys)), None)
                if existing:
                    existing.update(it); out.append(dict(existing))
                else:
                    row = {"id": str(uuid.uuid4()), "created_at": now_iso(), "updated_at": now_iso(),
                           **DEFAULTS.get(self.table, lambda: {})(), **it}
                    self._check_unique(rows, row)
                    rows.append(row); out.append(dict(row))
            return Res(data=out, count=None)

        if self.op == "update":
            hit = [r for r in rows if self._match(r)]
            for r in hit:
                self._check_unique([x for x in rows if x is not r], {**r, **self.payload})
                r.update(self.payload)
                r["updated_at"] = now_iso()
            return Res(data=[dict(r) for r in hit], count=None)

        if self.op == "delete":
            hit = [r for r in rows if self._match(r)]
            self.db.tables[self.table] = [r for r in rows if r not in hit]
            return Res(data=[dict(r) for r in hit], count=None)

        found = [self._embed(dict(r)) for r in rows if self._match(r)]
        if self._order:
            col, desc = self._order
            found.sort(key=lambda r: (r.get(col) is None, r.get(col)), reverse=desc)
        total = len(found)
        if self._range:
            found = found[self._range[0]: self._range[1] + 1]
        if self._limit is not None:
            found = found[: self._limit]
        if self._single:
            if len(found) == 1:
                return Res(data=found[0], count=total if self._count else None)
            if self._maybe and not found:
                return Res(data=None, count=None)
            raise _err("JSON object requested, multiple (or no) rows returned", "PGRST116")
        return Res(data=found, count=total if self._count else None)


class FakeDB:
    def __init__(self):
        self.reset()

    def reset(self):
        self.tables: Dict[str, List[dict]] = {}
        self.log: List[tuple] = []
        self.fail_tables: Dict[str, set] = {}
        self.rpc_handlers: Dict[str, Callable] = {}

    def table(self, name): return Query(self, name)

    def rpc(self, name, params=None):
        handler = self.rpc_handlers.get(name)
        return SimpleNamespace(execute=lambda: Res(data=handler(params or {}) if handler else [], count=None))

    # helpers for tests
    def add(self, table: str, **row) -> dict:
        row = {"id": row.pop("id", str(uuid.uuid4())), "created_at": now_iso(), "updated_at": now_iso(), **row}
        self.tables.setdefault(table, []).append(row)
        return row

    def rows(self, table: str, **where) -> List[dict]:
        return [r for r in self.tables.get(table, []) if all(r.get(k) == v for k, v in where.items())]

    def one(self, table: str, **where) -> dict:
        found = self.rows(table, **where)
        assert len(found) == 1, f"expected exactly one {table} row for {where}, got {len(found)}"
        return found[0]


class FakeAuth:
    """GoTrue stand-in: users, passwords, access/refresh tokens."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.users: Dict[str, dict] = {}
        self.tokens: Dict[str, str] = {}
        self.refresh: Dict[str, str] = {}
        self.confirm_email = False
        self.sent_recovery: List[str] = []
        self.password_updates: List[tuple] = []
        self._n = 0

    # -- seeding
    def add_user(self, uid: str, email: str, password: str = "Passw0rd!x", meta: Optional[dict] = None) -> str:
        self.users[uid] = {"id": uid, "email": email, "password": password, "user_metadata": meta or {}, "confirmed": True}
        return self.issue(uid)

    def issue(self, uid: str) -> str:
        self._n += 1
        at, rt = f"at-{uid}-{self._n}", f"rt-{uid}-{self._n}"
        self.tokens[at] = uid
        self.refresh[rt] = uid
        self._last_refresh = rt
        return at

    def _user_obj(self, u):
        return SimpleNamespace(id=u["id"], email=u["email"], user_metadata=u["user_metadata"])

    def _session(self, uid):
        at = self.issue(uid)
        return SimpleNamespace(access_token=at, refresh_token=self._last_refresh, expires_at=9999999999,
                               user=self._user_obj(self.users[uid]))

    # -- GoTrue API
    def get_user(self, token):
        uid = self.tokens.get(token)
        if not uid:
            raise AuthApiError("invalid JWT: unable to parse or verify signature", 401, "bad_jwt")
        return SimpleNamespace(user=self._user_obj(self.users[uid]))

    def sign_up(self, payload):
        email = payload["email"]
        if any(u["email"].lower() == email.lower() for u in self.users.values()):
            raise AuthApiError("User already registered", 422, "user_already_exists")
        if len(payload["password"]) < 6:
            raise AuthApiError("Password should be at least 6 characters.", 422, "weak_password")
        uid = f"u-{len(self.users) + 1}"
        self.users[uid] = {"id": uid, "email": email, "password": payload["password"],
                           "user_metadata": (payload.get("options") or {}).get("data", {}),
                           "confirmed": not self.confirm_email}
        sess = None if self.confirm_email else self._session(uid)
        return SimpleNamespace(user=self._user_obj(self.users[uid]), session=sess)

    def sign_in_with_password(self, creds):
        u = next((u for u in self.users.values() if u["email"].lower() == creds["email"].lower()), None)
        if not u or u["password"] != creds["password"]:
            raise AuthApiError("Invalid login credentials", 400, "invalid_credentials")
        if not u["confirmed"]:
            raise AuthApiError("Email not confirmed", 400, "email_not_confirmed")
        return SimpleNamespace(session=self._session(u["id"]), user=self._user_obj(u))

    def refresh_session(self, refresh_token):
        uid = self.refresh.pop(refresh_token, None)      # single-use, like Supabase
        if not uid:
            raise AuthApiError("Invalid Refresh Token: Already Used", 400, "refresh_token_already_used")
        return SimpleNamespace(session=self._session(uid))

    def verify_otp(self, payload):
        u = next((u for u in self.users.values() if u["email"] == payload["email"]), None)
        if not u or payload["token"] != "123456":
            raise AuthApiError("Token has expired or is invalid", 403, "otp_expired")
        u["confirmed"] = True
        return SimpleNamespace(session=self._session(u["id"]), user=self._user_obj(u))

    def resend(self, payload): pass

    def reset_password_for_email(self, email): self.sent_recovery.append(email)

    # admin
    def update_user_by_id(self, uid, attrs):
        if uid not in self.users:
            raise AuthApiError("User not found", 404, "user_not_found")
        if "password" in attrs:
            if len(attrs["password"]) < 6:
                raise AuthApiError("Password should be at least 6 characters.", 422, "weak_password")
            self.users[uid]["password"] = attrs["password"]
            self.password_updates.append((uid, attrs["password"]))
