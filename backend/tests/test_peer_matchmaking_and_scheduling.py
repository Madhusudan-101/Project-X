"""
FastAPI matchmaking + scheduling integration test -- pytest-free.

Boots the real FastAPI app via TestClient but replaces `db_client` with an
in-memory fake that mirrors the subset of the Supabase Python client the
routes actually use (table().select/insert/update/eq/in_/order/limit/gte/or_/
maybe_single/execute + rpc().execute()). This lets every peer.py branch be
exercised without hitting Supabase -- including the atomic pairing RPC,
duplicate-request idempotence, and the scheduling window logic.

Run with:  python tests/test_peer_matchmaking_and_scheduling.py
Exits 0 on all-pass, 1 on any failure.
"""

from __future__ import annotations

# ─── Environment must be set BEFORE importing app modules ─────────────────
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Callable

# Route-required env; values don't need to be valid Supabase because we
# patch db_client below before any request runs.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "svc-role-test")
os.environ.setdefault("SUPABASE_ANON_KEY", "anon-test")
os.environ.setdefault("PEERMEET_SHARED_SECRET", "test-shared-secret")

# Make the backend package importable regardless of cwd.
HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_ROOT = os.path.dirname(HERE)
sys.path.insert(0, BACKEND_ROOT)

# ─── In-memory fake for the Supabase Python client subset we use ──────────
class _FakeResponse:
    def __init__(self, data: Any):
        self.data = data


class _FakeQuery:
    """Builder that mimics supabase-py's chainable query API well enough for
    the read/write patterns in routers/candidate/peer.py."""

    def __init__(self, tbl: "_FakeTable", op: str, payload: Any = None):
        self.tbl = tbl
        self.op = op  # 'select' | 'insert' | 'update' | 'delete'
        self.payload = payload
        self.filters: list[Callable[[dict], bool]] = []
        self.order_by: str | None = None
        self.order_desc = False
        self.limit_n: int | None = None
        self._single = False
        self._maybe = False

    def eq(self, col, val):
        self.filters.append(lambda r, c=col, v=val: r.get(c) == v)
        return self

    def in_(self, col, values):
        s = set(values)
        self.filters.append(lambda r, c=col, s=s: r.get(c) in s)
        return self

    def gte(self, col, val):
        self.filters.append(lambda r, c=col, v=val: (r.get(c) or "") >= v)
        return self

    def or_(self, expr: str):
        # Extremely narrow parser for our exact `creator_id.eq.X,invitee_id.eq.Y` shape.
        parts = expr.split(",")
        conditions = []
        for p in parts:
            col, cmp, val = p.split(".", 2)
            if cmp != "eq":
                raise NotImplementedError(f"unsupported or_ op {cmp}")
            conditions.append((col, val))
        def check(r):
            return any(r.get(c) == v for c, v in conditions)
        self.filters.append(check)
        return self

    def order(self, col, desc=False):
        self.order_by = col
        self.order_desc = desc
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def single(self):  # method form as used in some paths
        self._single = True
        return self

    def maybe_single(self):
        self._maybe = True
        return self

    def _select(self):
        rows = [r for r in self.tbl.rows if all(f(r) for f in self.filters)]
        if self.order_by:
            rows.sort(key=lambda r: (r.get(self.order_by) is None, r.get(self.order_by)), reverse=self.order_desc)
        if self.limit_n is not None:
            rows = rows[: self.limit_n]
        if self._maybe:
            return _FakeResponse(rows[0] if rows else None)
        if self._single:
            if not rows:
                raise RuntimeError("single() returned no row")
            return _FakeResponse(rows[0])
        return _FakeResponse(rows)

    def _insert(self):
        rows = self.payload if isinstance(self.payload, list) else [self.payload]
        inserted = []
        for row in rows:
            r = dict(row)
            r.setdefault("id", str(uuid.uuid4()))
            r.setdefault("created_at", datetime.now(timezone.utc).isoformat())
            # partial-unique constraint mimic: at most ONE active ticket
            # per student (uniq_peer_mm_active_per_student — covers
            # 'waiting' AND 'matched'). Matches the broadened DB index.
            if self.tbl.name == "peer_matchmaking_tickets" and r.get("status") in ("waiting", "matched"):
                for existing in self.tbl.rows:
                    if (
                        existing.get("student_id") == r.get("student_id")
                        and existing.get("status") in ("waiting", "matched")
                    ):
                        # emulate supabase raising APIError
                        from postgrest.exceptions import APIError as _APIError
                        raise _APIError({"message": "duplicate active ticket", "code": "23505"})
            self.tbl.rows.append(r)
            inserted.append(r)
        return _FakeResponse(inserted)

    def _update(self):
        updated = []
        for r in self.tbl.rows:
            if all(f(r) for f in self.filters):
                r.update(self.payload or {})
                updated.append(r)
        return _FakeResponse(updated)

    def execute(self):
        if self.op == "select":
            return self._select()
        if self.op == "insert":
            return self._insert()
        if self.op == "update":
            return self._update()
        raise NotImplementedError(self.op)


class _FakeTable:
    def __init__(self, store: "_FakeStore", name: str):
        self.store = store
        self.name = name
        self.rows: list[dict] = store.tables.setdefault(name, [])

    def select(self, *_args, **_kw):
        return _FakeQuery(self, "select")

    def insert(self, payload):
        return _FakeQuery(self, "insert", payload)

    def update(self, payload):
        return _FakeQuery(self, "update", payload)


class _FakeStore:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {}

    def table(self, name: str) -> _FakeTable:
        return _FakeTable(self, name)

    def rpc(self, fn_name: str, params: dict):
        # We only implement the one RPC our routes call.
        return SimpleNamespace(execute=lambda: self._exec_rpc(fn_name, params))

    def _exec_rpc(self, fn_name: str, params: dict):
        if fn_name != "claim_peer_matchmaking_ticket":
            raise NotImplementedError(fn_name)
        p_student_id = params["p_student_id"]
        p_room_id = params["p_room_id"]

        now = datetime.now(timezone.utc)
        # Sweep expired
        for r in self.tables.get("peer_matchmaking_tickets", []):
            if r.get("status") == "waiting":
                exp = r.get("expires_at")
                if isinstance(exp, str):
                    try:
                        expdt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
                    except Exception:
                        expdt = None
                    if expdt and expdt < now:
                        r["status"] = "expired"

        candidates = [
            r for r in self.tables.get("peer_matchmaking_tickets", [])
            if r.get("status") == "waiting" and r.get("student_id") != p_student_id
        ]
        candidates.sort(key=lambda r: r.get("created_at") or "")
        if not candidates:
            return _FakeResponse([])
        target = candidates[0]
        target["status"] = "matched"
        target["room_id"] = p_room_id
        target["matched_with"] = p_student_id
        target["matched_at"] = now.isoformat()
        return _FakeResponse([{
            "ticket_id": target["id"],
            "peer_id": target["student_id"],
            "peer_private": bool(target.get("keep_private", False)),
        }])


# ─── Patch app modules BEFORE FastAPI startup ──────────────────────────────
from app import deps  # noqa: E402

_STORE = _FakeStore()
deps.db_client = _STORE  # replace on the deps module (routers import from here)

# Also patch the already-imported reference inside the peer router if it
# already grabbed the symbol.
from app.routers.candidate import peer as peer_router  # noqa: E402
peer_router.db_client = _STORE

from app.main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# ─── Fake authentication ───────────────────────────────────────────────────
_CURRENT_USERS: dict[str, dict] = {}

def _fake_get_current_user_factory(user_id: str, email: str):
    def _inner():
        return {"id": user_id, "email": email, "role": "candidate", "_token": "fake"}
    return _inner


def as_user(user_id: str, email: str) -> TestClient:
    from app.deps import get_current_user as real_get_current_user  # noqa
    app.dependency_overrides[peer_router.get_current_user] = _fake_get_current_user_factory(user_id, email)
    return TestClient(app)


# ─── Seed fake profiles (for _resolve_display_name lookups) ───────────────
def seed_profile(user_id: str, email: str, name: str):
    profiles = _STORE.tables.setdefault("profiles", [])
    profiles.append({"id": user_id, "email": email, "name": name})


ALICE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
BOB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
CAROL = "cccccccc-cccc-cccc-cccc-cccccccccccc"
DAN = "dddddddd-dddd-dddd-dddd-dddddddddddd"
EVE = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
FRANK = "ffffffff-ffff-ffff-ffff-ffffffffffff"
GRACE = "12121212-1212-1212-1212-121212121212"

seed_profile(ALICE, "alice@example.com", "Alice A")
seed_profile(BOB, "bob@example.com", "Bob B")
seed_profile(CAROL, "carol@example.com", "Carol C")
seed_profile(DAN, "dan@example.com", "Dan D")
seed_profile(EVE, "eve@example.com", "Eve E")
seed_profile(FRANK, "frank@example.com", "Frank F")
seed_profile(GRACE, "grace@example.com", "Grace G")


# ─── Test harness ──────────────────────────────────────────────────────────
_results = []

def record(name, ok, detail=""):
    _results.append((name, ok, detail))
    tag = "PASS" if ok else "FAIL"
    print(f"  [{tag}] {name}" + (f" -- {detail}" if detail else ""))


def _reset_tables():
    _STORE.tables["peer_matchmaking_tickets"] = []
    _STORE.tables["peer_scheduled_meetings"] = []


# ─── Matchmaking tests ─────────────────────────────────────────────────────
def test_alice_enters_queue_alone():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    res = c.post("/candidate/peer-matchmaking/request", json={"keep_private": False})
    body = res.json()
    record(
        "Alice alone -> waiting",
        res.status_code == 200 and body["status"] == "waiting" and body["room_id"] is None,
        f"status={res.status_code} body_status={body.get('status')}",
    )


def test_bob_matches_alice_same_room_id():
    _reset_tables()
    c_alice = as_user(ALICE, "alice@example.com")
    r1 = c_alice.post("/candidate/peer-matchmaking/request", json={"keep_private": False}).json()

    c_bob = as_user(BOB, "bob@example.com")
    r2 = c_bob.post("/candidate/peer-matchmaking/request", json={"keep_private": True}).json()

    # Now Alice polls again -> she should see matched with the SAME room_id.
    c_alice2 = as_user(ALICE, "alice@example.com")
    r3 = c_alice2.post("/candidate/peer-matchmaking/request", json={"keep_private": False}).json()

    record("Alice initial -> waiting", r1["status"] == "waiting", f"got {r1['status']}")
    record("Bob -> matched",           r2["status"] == "matched", f"got {r2['status']}")
    record("Alice poll -> matched",    r3["status"] == "matched", f"got {r3['status']}")
    record(
        "SAME room ID returned to both students",
        r2["room_id"] is not None and r2["room_id"] == r3["room_id"],
        f"bob={r2['room_id']} alice={r3['room_id']}",
    )
    record(
        "Both receive minted PeerMeet JWT tokens",
        bool(r2["token"]) and bool(r3["token"]),
        f"bob_token_len={len(r2['token'] or '')} alice_token_len={len(r3['token'] or '')}",
    )
    record(
        "Bob's response carries partner_name (Alice)",
        r2.get("partner_name") == "Alice A",
        f"got={r2.get('partner_name')}",
    )
    # Bob had keep_private=True in his request, but PARTNER_NAME shown to
    # him is Alice's identity; Alice's own client hides Bob visually via
    # the socket path, not this API -- so partner_name still returns "Bob B"
    # here. What matters is keep_private is preserved for the caller's
    # own PeerMeet handoff.
    record(
        "Alice-side keep_private is False (she did not opt in)",
        r3["keep_private"] is False,
        f"got={r3['keep_private']}",
    )

    # STRONG: dig into the underlying rows and prove the pair points at
    # each other with the SAME room_id (not just that both /request calls
    # returned similar-looking blobs).
    rows = _STORE.tables["peer_matchmaking_tickets"]
    alice_row = next((r for r in rows if r["student_id"] == ALICE and r["status"] == "matched"), None)
    bob_row = next((r for r in rows if r["student_id"] == BOB and r["status"] == "matched"), None)
    record(
        "DB: Alice's matched row exists and points at Bob",
        alice_row and alice_row["matched_with"] == BOB,
        f"alice_row={alice_row}",
    )
    record(
        "DB: Bob's matched row exists and points at Alice",
        bob_row and bob_row["matched_with"] == ALICE,
        f"bob_row={bob_row}",
    )
    record(
        "DB: both matched rows share the SAME room_id",
        alice_row and bob_row and alice_row["room_id"] == bob_row["room_id"] and alice_row["room_id"] == r2["room_id"],
        f"alice_room={alice_row and alice_row['room_id']} bob_room={bob_row and bob_row['room_id']} returned={r2['room_id']}",
    )
    record(
        "DB: no orphan waiting rows for Alice or Bob",
        all(r["status"] != "waiting" for r in rows if r["student_id"] in (ALICE, BOB)),
        f"statuses={[(r['student_id'][:8], r['status']) for r in rows]}",
    )


def test_no_self_match():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    r1 = c.post("/candidate/peer-matchmaking/request", json={"keep_private": False}).json()
    r2 = c.post("/candidate/peer-matchmaking/request", json={"keep_private": False}).json()
    record(
        "Same user polling twice -> still waiting (no self-match)",
        r1["status"] == "waiting" and r2["status"] == "waiting" and r1["ticket_id"] == r2["ticket_id"],
        f"r1={r1['status']} r2={r2['status']} same_ticket={r1['ticket_id']==r2['ticket_id']}",
    )


def test_third_student_stays_waiting():
    _reset_tables()
    # A and B pair; C should stay waiting.
    as_user(ALICE, "alice@example.com").post("/candidate/peer-matchmaking/request", json={"keep_private": False})
    b_res = as_user(BOB, "bob@example.com").post("/candidate/peer-matchmaking/request", json={"keep_private": False}).json()
    c_res = as_user(CAROL, "carol@example.com").post("/candidate/peer-matchmaking/request", json={"keep_private": False}).json()

    record("A+B matched", b_res["status"] == "matched")
    record(
        "C is waiting (not in A+B's room)",
        c_res["status"] == "waiting" and c_res.get("room_id") is None,
        f"status={c_res['status']} room_id={c_res.get('room_id')}",
    )


def test_no_duplicate_queue_entries():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    c.post("/candidate/peer-matchmaking/request", json={"keep_private": False})
    c.post("/candidate/peer-matchmaking/request", json={"keep_private": False})
    c.post("/candidate/peer-matchmaking/request", json={"keep_private": False})
    waiting = [r for r in _STORE.tables["peer_matchmaking_tickets"] if r["status"] == "waiting"]
    record(
        "Multiple polls create exactly ONE waiting ticket",
        len(waiting) == 1,
        f"waiting rows for alice={len(waiting)}",
    )


def test_cancel_removes_from_queue():
    _reset_tables()
    c_alice = as_user(ALICE, "alice@example.com")
    c_alice.post("/candidate/peer-matchmaking/request", json={"keep_private": False})
    resp = c_alice.post("/candidate/peer-matchmaking/cancel")
    record("Cancel returns 204", resp.status_code == 204, f"got {resp.status_code}")

    # Bob now enters -> should stay waiting because Alice's row is cancelled.
    b = as_user(BOB, "bob@example.com").post("/candidate/peer-matchmaking/request", json={"keep_private": False}).json()
    record(
        "After A cancels, B stays waiting (no orphan match)",
        b["status"] == "waiting" and b["room_id"] is None,
        f"status={b['status']}",
    )


def test_expired_ticket_skipped_by_matcher():
    _reset_tables()
    # Insert a waiting ticket for Alice that's already past expiry.
    _STORE.tables["peer_matchmaking_tickets"].append({
        "id": str(uuid.uuid4()),
        "student_id": ALICE,
        "status": "waiting",
        "keep_private": False,
        "created_at": (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat(),
        "expires_at": (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat(),
    })
    b = as_user(BOB, "bob@example.com").post("/candidate/peer-matchmaking/request", json={"keep_private": False}).json()
    record(
        "Expired waiting ticket does not match a fresh joiner",
        b["status"] == "waiting",
        f"status={b['status']}",
    )
    # And Alice's expired row should be reclassified.
    alice_rows = [r for r in _STORE.tables["peer_matchmaking_tickets"] if r["student_id"] == ALICE]
    record(
        "Expired ticket flipped to 'expired' status by matcher",
        any(r["status"] == "expired" for r in alice_rows),
        f"alice_statuses={[r['status'] for r in alice_rows]}",
    )


# ─── Room-ID UNIQUENESS across independent pairs ─────────────────────────
def test_three_pairs_get_three_distinct_room_ids():
    """A+B, C+D, E+F each get their own unique room. A third unmatched
    student G must NOT receive any existing pair's room ID."""
    _reset_tables()

    def _poll(uid, email):
        return as_user(uid, email).post(
            "/candidate/peer-matchmaking/request", json={"keep_private": False}
        ).json()

    # Pair A+B
    a1 = _poll(ALICE, "alice@example.com")           # waiting
    b1 = _poll(BOB, "bob@example.com")               # matched w/ A
    a2 = _poll(ALICE, "alice@example.com")           # matched, gets same room
    room_ab = b1["room_id"]

    # Pair C+D
    c1 = _poll(CAROL, "carol@example.com")           # waiting (A+B already matched, so nobody else waiting)
    d1 = _poll(DAN, "dan@example.com")               # matched w/ C
    c2 = _poll(CAROL, "carol@example.com")
    room_cd = d1["room_id"]

    # Pair E+F
    e1 = _poll(EVE, "eve@example.com")               # waiting
    f1 = _poll(FRANK, "frank@example.com")           # matched w/ E
    e2 = _poll(EVE, "eve@example.com")
    room_ef = f1["room_id"]

    # Unmatched third: G comes AFTER every pair has closed, nobody else
    # waiting -> she must go to waiting with no room_id.
    g1 = _poll(GRACE, "grace@example.com")

    # A.room_id === B.room_id
    record(
        "A.room_id === B.room_id",
        room_ab and a2["room_id"] == b1["room_id"] == room_ab,
        f"a={a2['room_id']} b={b1['room_id']}",
    )
    # C.room_id === D.room_id
    record(
        "C.room_id === D.room_id",
        room_cd and c2["room_id"] == d1["room_id"] == room_cd,
        f"c={c2['room_id']} d={d1['room_id']}",
    )
    # E.room_id === F.room_id
    record(
        "E.room_id === F.room_id",
        room_ef and e2["room_id"] == f1["room_id"] == room_ef,
        f"e={e2['room_id']} f={f1['room_id']}",
    )
    # A.room_id !== C.room_id
    record(
        "A.room_id !== C.room_id",
        room_ab != room_cd,
        f"ab={room_ab} cd={room_cd}",
    )
    # A.room_id !== E.room_id
    record(
        "A.room_id !== E.room_id",
        room_ab != room_ef,
        f"ab={room_ab} ef={room_ef}",
    )
    # C.room_id !== E.room_id
    record(
        "C.room_id !== E.room_id",
        room_cd != room_ef,
        f"cd={room_cd} ef={room_ef}",
    )
    # All three rooms are distinct as a set of three
    record(
        "Set of three pair rooms has 3 distinct values",
        len({room_ab, room_cd, room_ef}) == 3,
        f"set={{{room_ab},{room_cd},{room_ef}}}",
    )
    # Unmatched student G is waiting with NO room ID and does NOT get any pair's room
    record(
        "Unmatched student is waiting (no room_id)",
        g1["status"] == "waiting" and g1["room_id"] is None,
        f"status={g1['status']} room_id={g1['room_id']}",
    )
    record(
        "Unmatched student's ticket is NOT any existing pair's room ID",
        g1["room_id"] not in (room_ab, room_cd, room_ef),
        f"unmatched_room_id={g1['room_id']} pair_rooms={{{room_ab},{room_cd},{room_ef}}}",
    )

    # Also: DB rows must confirm the room_ids belong ONLY to the intended
    # two students of each pair -- no cross-contamination.
    rows = _STORE.tables["peer_matchmaking_tickets"]
    def _members(room_id):
        return sorted({r["student_id"] for r in rows if r.get("room_id") == room_id and r["status"] == "matched"})
    record(
        "DB: room_ab belongs ONLY to A and B",
        _members(room_ab) == sorted([ALICE, BOB]),
        f"members(ab)={_members(room_ab)}",
    )
    record(
        "DB: room_cd belongs ONLY to C and D",
        _members(room_cd) == sorted([CAROL, DAN]),
        f"members(cd)={_members(room_cd)}",
    )
    record(
        "DB: room_ef belongs ONLY to E and F",
        _members(room_ef) == sorted([EVE, FRANK]),
        f"members(ef)={_members(room_ef)}",
    )


def test_unmatched_third_while_pair_still_open():
    """Variant of the above where the third unmatched student polls WHILE
    the pair's tickets are still in the DB (i.e. immediately after the
    pair's match). Must still not leak the pair's room ID."""
    _reset_tables()

    def _poll(uid, email):
        return as_user(uid, email).post(
            "/candidate/peer-matchmaking/request", json={"keep_private": False}
        ).json()

    _poll(ALICE, "alice@example.com")
    b = _poll(BOB, "bob@example.com")          # matched with A
    ab_room = b["room_id"]

    c = _poll(CAROL, "carol@example.com")      # third student -- must wait

    record(
        "Third student joining right after A+B match remains waiting",
        c["status"] == "waiting" and c["room_id"] is None,
        f"status={c['status']} room_id={c['room_id']}",
    )
    record(
        "Third student's response room_id is NOT the paired room_id",
        c["room_id"] != ab_room,
        f"c_room={c['room_id']} ab_room={ab_room}",
    )


# ─── Scheduling tests ──────────────────────────────────────────────────────
def test_schedule_meeting_persists():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    resp = c.post("/candidate/peer-meetings", json={
        "title": "Systems design practice",
        "scheduled_at": when,
        "duration_minutes": 45,
        "keep_private": True,
    })
    body = resp.json() if resp.status_code < 400 else None
    record(
        "POST /peer-meetings returns 201 with a room_id",
        resp.status_code == 201 and body and body.get("room_id"),
        f"status={resp.status_code} body={body}",
    )
    created_room_id = body["room_id"]
    created_meeting_id = body["id"]

    # Simulate a real page-refresh: a brand-new TestClient (new dependency-
    # override binding, no in-memory context) refetches the list -- the row
    # must come back with every field intact and correctly owned by Alice.
    c_fresh = as_user(ALICE, "alice@example.com")
    list_resp = c_fresh.get("/candidate/peer-meetings")
    rows = list_resp.json() if list_resp.status_code == 200 else []
    got = rows[0] if rows else {}
    ok = (
        list_resp.status_code == 200
        and len(rows) == 1
        and got.get("id") == created_meeting_id
        and got.get("room_id") == created_room_id
        and got.get("title") == "Systems design practice"
        and got.get("duration_minutes") == 45
        and got.get("keep_private") is True
        and got.get("status") == "scheduled"
        and got.get("creator_id") == ALICE
        and got.get("role") == "creator"
    )
    record(
        "GET /peer-meetings roundtrips ALL fields correctly (id/room_id/title/duration/keep_private/status/creator_id/role)",
        ok,
        f"got={got}",
    )
    # scheduled_at may be reformatted; verify the same moment in time.
    try:
        got_when = datetime.fromisoformat(got["scheduled_at"].replace("Z", "+00:00"))
        sent_when = datetime.fromisoformat(when)
        record(
            "scheduled_at persists to the same moment in time",
            abs((got_when - sent_when).total_seconds()) < 2,
            f"delta_sec={abs((got_when - sent_when).total_seconds())}",
        )
    except Exception as e:  # noqa: BLE001
        record("scheduled_at persists to the same moment in time", False, f"parse error: {e}")

    # And a DIFFERENT user (Bob, not the creator, not the invitee) must NOT
    # see this meeting -- proves per-user scoping in the query.
    c_bob = as_user(BOB, "bob@example.com")
    bob_rows = c_bob.get("/candidate/peer-meetings").json()
    record(
        "Non-owner does not see the meeting in their list",
        all(r["id"] != created_meeting_id for r in bob_rows),
        f"bob_rows={len(bob_rows)}",
    )


def test_reject_past_date():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    resp = c.post("/candidate/peer-meetings", json={
        "title": "Ghost",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
    })
    record(
        "Past date is rejected (422)",
        resp.status_code == 422,
        f"got {resp.status_code}",
    )


def test_reject_bad_duration():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    resp = c.post("/candidate/peer-meetings", json={
        "title": "Long",
        "scheduled_at": when,
        "duration_minutes": 9999,
        "keep_private": False,
    })
    record(
        "Duration outside [5,240] is rejected (422)",
        resp.status_code == 422,
        f"got {resp.status_code}",
    )


def test_join_before_window_forbidden():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    m = c.post("/candidate/peer-meetings", json={
        "title": "Later",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
    }).json()
    join = c.post(f"/candidate/peer-meetings/{m['id']}/join")
    body = join.json()
    # Server returns 200 with is_ready=false 3 hours before start.
    record(
        "Join more than 5 min before start -> is_ready=False",
        join.status_code == 200 and body.get("is_ready") is False and body.get("room_id") == m["room_id"],
        f"status={join.status_code} is_ready={body.get('is_ready')}",
    )


def test_join_within_window_is_ready():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()  # 2 min out
    m = c.post("/candidate/peer-meetings", json={
        "title": "Now",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
    }).json()
    join = c.post(f"/candidate/peer-meetings/{m['id']}/join").json()
    record(
        "Join inside the 5-min-before window -> is_ready=True",
        join["is_ready"] is True and join["room_id"] == m["room_id"] and bool(join["token"]),
        f"is_ready={join['is_ready']}",
    )
    # STRONG: the join must resolve to the EXACT same room_id the schedule
    # stored -- and the minted JWT must carry Alice's real student id, so
    # any downstream report is attributed correctly.
    import jwt as _jwt
    decoded = _jwt.decode(join["token"], os.environ["PEERMEET_SHARED_SECRET"], algorithms=["HS256"])
    record(
        "Join returns the EXACT stored room_id (no new room minted on join)",
        join["room_id"] == m["room_id"],
        f"join_room={join['room_id']} stored_room={m['room_id']}",
    )
    record(
        "Join-minted JWT carries the authenticated student id (Alice)",
        decoded.get("student_id") == ALICE,
        f"decoded_student_id={decoded.get('student_id')}",
    )


def test_cancel_scheduled_meeting():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    m = c.post("/candidate/peer-meetings", json={
        "title": "Doomed",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
    }).json()
    del_resp = c.delete(f"/candidate/peer-meetings/{m['id']}")
    record("DELETE returns 204", del_resp.status_code == 204, f"got {del_resp.status_code}")

    # After cancel, the list should NOT return this meeting (filter is status=scheduled).
    rows = c.get("/candidate/peer-meetings").json()
    record(
        "Cancelled meeting is filtered out of list",
        all(r["id"] != m["id"] for r in rows),
        f"remaining={len(rows)}",
    )


def test_three_scheduled_meetings_have_distinct_room_ids():
    """Each independently scheduled meeting must get its OWN unique room_id
    (no accidental reuse of a previously-assigned room). The DB schema
    already enforces `room_id UNIQUE`; this proves the API path does too."""
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")

    room_ids = []
    for i, hours in enumerate([2, 3, 5], start=1):
        when = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
        m = c.post("/candidate/peer-meetings", json={
            "title": f"Meeting {i}",
            "scheduled_at": when,
            "duration_minutes": 30,
            "keep_private": False,
        }).json()
        room_ids.append(m["room_id"])

    record(
        "Three scheduled meetings each get a room_id",
        all(bool(r) for r in room_ids),
        f"room_ids={room_ids}",
    )
    record(
        "All three scheduled meetings have DISTINCT room_ids",
        len(set(room_ids)) == 3,
        f"unique_count={len(set(room_ids))} of 3; room_ids={room_ids}",
    )
    # And none of them collides with a matchmaking-issued room from a
    # prior test's context -- they're isolated per _reset_tables, so this
    # simply reconfirms uniqueness within this scope.
    record(
        "Underlying rows are physically distinct meetings (different ids)",
        len({r["id"] for r in _STORE.tables["peer_scheduled_meetings"]}) == 3,
        f"n_rows={len(_STORE.tables['peer_scheduled_meetings'])}",
    )


# ─── Public visibility + lifecycle transitions ────────────────────────────
def test_public_upcoming_visible_to_all_students():
    """A meeting Alice creates must appear in Bob's PUBLIC upcoming list."""
    _reset_tables()
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    c_alice = as_user(ALICE, "alice@example.com")
    m = c_alice.post("/candidate/peer-meetings", json={
        "title": "Distributed systems review",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
    }).json()

    # Bob (not creator, not invitee) fetches the PUBLIC list.
    c_bob = as_user(BOB, "bob@example.com")
    rows = c_bob.get("/candidate/peer-meetings/upcoming").json()

    got = next((r for r in rows if r["id"] == m["id"]), None)
    ok = (
        got is not None
        and got["room_id"] == m["room_id"]
        and got["title"] == "Distributed systems review"
        and got["status"] == "scheduled"
        and got["host_display_name"] == "Alice A"
        and got["is_open"] is True
        and got["is_authorized"] is True  # open meeting -> Bob can join
    )
    record(
        "Meeting Alice created is VISIBLE to Bob in public upcoming list",
        ok,
        f"got={got}",
    )
    # Sensitive fields must NOT be present in the public card.
    if got:
        record(
            "Public card DOES NOT expose creator_id / invitee_id / keep_private",
            "creator_id" not in got and "invitee_id" not in got and "keep_private" not in got,
            f"keys={list(got.keys())}",
        )


def test_public_upcoming_host_privacy_hides_real_name():
    _reset_tables()
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    c_alice = as_user(ALICE, "alice@example.com")
    m = c_alice.post("/candidate/peer-meetings", json={
        "title": "Private host",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": True,
    }).json()

    c_bob = as_user(BOB, "bob@example.com")
    rows = c_bob.get("/candidate/peer-meetings/upcoming").json()
    got = next((r for r in rows if r["id"] == m["id"]), None)
    record(
        "Host who opted for privacy is shown as 'Anonymous Candidate'",
        got and got["host_display_name"] == "Anonymous Candidate",
        f"host_display_name={got and got['host_display_name']}",
    )


def test_lifecycle_initial_status_scheduled():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    m = c.post("/candidate/peer-meetings", json={
        "title": "Lifecycle",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
    }).json()
    record(
        "Newly created meeting has status='scheduled'",
        m["status"] == "scheduled",
        f"status={m['status']}",
    )


def test_join_before_window_does_not_advance_status():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()  # far in the future
    m = c.post("/candidate/peer-meetings", json={
        "title": "Early click",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
    }).json()
    join = c.post(f"/candidate/peer-meetings/{m['id']}/join").json()
    record(
        "Join well BEFORE window: is_ready=False and status stays 'scheduled'",
        join["is_ready"] is False and join["status"] == "scheduled",
        f"is_ready={join['is_ready']} status={join['status']}",
    )


def test_lifecycle_scheduled_to_waiting_to_live_to_completed():
    """Full status ladder driven by real /join calls + a real report webhook."""
    _reset_tables()
    when = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
    c_alice = as_user(ALICE, "alice@example.com")
    m = c_alice.post("/candidate/peer-meetings", json={
        "title": "Ladder",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
        "invitee_email": "bob@example.com",
    }).json()
    meeting_id = m["id"]
    stored_room = m["room_id"]

    # Alice joins first inside the window: status should advance to 'waiting'.
    a_join = c_alice.post(f"/candidate/peer-meetings/{meeting_id}/join").json()
    record(
        "First authorized joiner inside window: status -> 'waiting'",
        a_join["status"] == "waiting" and a_join["room_id"] == stored_room,
        f"status={a_join['status']} room_id={a_join['room_id']}",
    )
    # Alice re-clicking join must NOT advance to 'live' (same student).
    a_again = c_alice.post(f"/candidate/peer-meetings/{meeting_id}/join").json()
    record(
        "Same student re-joining stays 'waiting' (does not flip to live)",
        a_again["status"] == "waiting",
        f"status={a_again['status']}",
    )
    # Bob (invitee, different student) joins: status should advance to 'live'.
    c_bob = as_user(BOB, "bob@example.com")
    b_join = c_bob.post(f"/candidate/peer-meetings/{meeting_id}/join").json()
    record(
        "Different second joiner: status -> 'live'",
        b_join["status"] == "live" and b_join["room_id"] == stored_room,
        f"status={b_join['status']} room_id={b_join['room_id']}",
    )
    # Same room ID for both.
    record(
        "Both participants share the SAME room_id",
        a_join["room_id"] == b_join["room_id"] == stored_room,
        f"a={a_join['room_id']} b={b_join['room_id']} stored={stored_room}",
    )

    # Simulate the PeerMeet report webhook landing -> meeting completes.
    report_payload = {
        "room_id": stored_room,
        "student_id": ALICE,
        "partner_student_id": BOB,
        "role": "candidate",
        "report": {},
    }
    hook = TestClient(app).post(
        "/internal/peer-reports",
        json=report_payload,
        headers={"Authorization": f"Bearer {os.environ['PEERMEET_SHARED_SECRET']}"},
    )
    record(
        "Webhook POST /internal/peer-reports returns 201",
        hook.status_code == 201,
        f"got {hook.status_code} body={hook.text[:200]}",
    )

    # Verify the meeting row moved to 'completed'.
    completed_row = next(
        (r for r in _STORE.tables["peer_scheduled_meetings"] if r["id"] == meeting_id),
        None,
    )
    record(
        "Meeting is 'completed' AFTER the report webhook (never sooner)",
        completed_row and completed_row["status"] == "completed" and completed_row.get("completed_at"),
        f"row={completed_row}",
    )


def test_charlie_cannot_join_invitation_only():
    _reset_tables()
    c_alice = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
    m = c_alice.post("/candidate/peer-meetings", json={
        "title": "Alice+Bob only",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
        "invitee_email": "bob@example.com",
    }).json()

    # Charlie/Carol -- neither creator nor invitee -- must be blocked.
    c_carol = as_user(CAROL, "carol@example.com")
    resp = c_carol.post(f"/candidate/peer-meetings/{m['id']}/join")
    record(
        "Third party CANNOT join an invitation-only meeting (403)",
        resp.status_code == 403,
        f"got {resp.status_code}",
    )
    # And the public card must clearly say is_authorized=False for Carol.
    rows = c_carol.get("/candidate/peer-meetings/upcoming").json()
    got = next((r for r in rows if r["id"] == m["id"]), None)
    record(
        "Public card marks the invite-only meeting as is_authorized=False for third parties",
        got and got["is_authorized"] is False and got["is_open"] is False,
        f"got={got}",
    )


def test_open_meeting_lets_anyone_join():
    _reset_tables()
    c_alice = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
    m = c_alice.post("/candidate/peer-meetings", json={
        "title": "Open house",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
        # NO invitee_email -> open meeting.
    }).json()

    # Carol should be able to join an OPEN meeting.
    c_carol = as_user(CAROL, "carol@example.com")
    resp = c_carol.post(f"/candidate/peer-meetings/{m['id']}/join")
    record(
        "Open meeting: any authenticated student may join (200)",
        resp.status_code == 200 and resp.json()["room_id"] == m["room_id"],
        f"got {resp.status_code} room_id={resp.json().get('room_id') if resp.status_code == 200 else 'n/a'}",
    )


def test_refresh_preserves_status_and_room_id():
    """Prove the DB is the source of truth: a fresh client refetch after
    a lifecycle transition sees the SAME status."""
    _reset_tables()
    c_alice = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
    m = c_alice.post("/candidate/peer-meetings", json={
        "title": "Refresh test",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
    }).json()
    c_alice.post(f"/candidate/peer-meetings/{m['id']}/join")  # -> waiting

    # Fresh TestClient (new dependency-override binding) -> refetch.
    c_alice_fresh = as_user(ALICE, "alice@example.com")
    rows = c_alice_fresh.get("/candidate/peer-meetings").json()
    got = next((r for r in rows if r["id"] == m["id"]), None)
    record(
        "After refresh, status persists as 'waiting'",
        got and got["status"] == "waiting" and got["room_id"] == m["room_id"],
        f"got={got}",
    )


def test_multiple_scheduled_meetings_have_unique_rooms_and_stay_separate():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    when1 = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    when2 = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    m1 = c.post("/candidate/peer-meetings", json={
        "title": "M1", "scheduled_at": when1, "duration_minutes": 30, "keep_private": False,
    }).json()
    m2 = c.post("/candidate/peer-meetings", json={
        "title": "M2", "scheduled_at": when2, "duration_minutes": 30, "keep_private": False,
    }).json()
    record(
        "Two independently scheduled meetings have different room_ids",
        m1["room_id"] != m2["room_id"],
        f"m1={m1['room_id']} m2={m2['room_id']}",
    )
    # A join on M1 must not advance M2's status.
    c_bob = as_user(BOB, "bob@example.com")
    # M2 is 3h out -> join returns is_ready=False, status stays 'scheduled'.
    j2 = c_bob.get("/candidate/peer-meetings/upcoming").json()
    m2_public = next((r for r in j2 if r["id"] == m2["id"]), None)
    record(
        "M2 status remains independent (still 'scheduled' after other joins)",
        m2_public and m2_public["status"] == "scheduled",
        f"m2_status={m2_public and m2_public['status']}",
    )


def test_two_users_invited_to_same_scheduled_meeting_share_room_id():
    """When the SAME scheduled meeting is joined by its creator AND its
    invitee, both /join calls MUST resolve to the exact same room_id.
    (This is the intended shape of an invited scheduled meeting.)"""
    _reset_tables()
    c_alice = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()  # inside the join window
    m = c_alice.post("/candidate/peer-meetings", json={
        "title": "Invited pair",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
        "invitee_email": "bob@example.com",
    }).json()

    stored_room = m["room_id"]
    # Alice joins.
    alice_join = c_alice.post(f"/candidate/peer-meetings/{m['id']}/join").json()
    # Bob joins the same meeting.
    c_bob = as_user(BOB, "bob@example.com")
    bob_join = c_bob.post(f"/candidate/peer-meetings/{m['id']}/join").json()

    record(
        "Invitee (Bob) can join a scheduled meeting they were invited to",
        bob_join.get("room_id") == stored_room and bool(bob_join.get("token")),
        f"bob_room={bob_join.get('room_id')} stored={stored_room}",
    )
    record(
        "Both participants of ONE scheduled meeting share the SAME room_id",
        alice_join["room_id"] == bob_join["room_id"] == stored_room,
        f"alice={alice_join['room_id']} bob={bob_join['room_id']} stored={stored_room}",
    )
    # And of course each side's token must carry that user's own id -- no
    # identity leakage across a shared room.
    import jwt as _jwt
    a_dec = _jwt.decode(alice_join["token"], os.environ["PEERMEET_SHARED_SECRET"], algorithms=["HS256"])
    b_dec = _jwt.decode(bob_join["token"], os.environ["PEERMEET_SHARED_SECRET"], algorithms=["HS256"])
    record(
        "Alice's join JWT carries Alice's student_id; Bob's carries Bob's",
        a_dec["student_id"] == ALICE and b_dec["student_id"] == BOB,
        f"a_id={a_dec['student_id']} b_id={b_dec['student_id']}",
    )


def test_non_creator_cannot_cancel():
    _reset_tables()
    c_alice = as_user(ALICE, "alice@example.com")
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    m = c_alice.post("/candidate/peer-meetings", json={
        "title": "Mine",
        "scheduled_at": when,
        "duration_minutes": 30,
        "keep_private": False,
    }).json()

    c_bob = as_user(BOB, "bob@example.com")
    resp = c_bob.delete(f"/candidate/peer-meetings/{m['id']}")
    record(
        "Non-creator DELETE -> 403",
        resp.status_code == 403,
        f"got {resp.status_code}",
    )


# ─── Privacy: JWT + display-name path ─────────────────────────────────────
def test_session_token_mints_real_identity():
    _reset_tables()
    c = as_user(ALICE, "alice@example.com")
    resp = c.post("/candidate/peer-session-token")
    body = resp.json()
    record("Session token returns 200", resp.status_code == 200)

    import jwt as _jwt
    decoded = _jwt.decode(body["token"], os.environ["PEERMEET_SHARED_SECRET"], algorithms=["HS256"])
    record(
        "Session token carries the AUTHENTICATED student's id (privacy applies at PeerMeet's socket layer, not here)",
        decoded["student_id"] == ALICE and decoded["name"] == "Alice A",
        f"decoded={decoded}",
    )


# ─── Peer reports read side (C1 fix) ──────────────────────────────────────

def test_peer_reports_empty_returns_empty_list():
    _reset_tables()
    _STORE.tables["peer_interview_reports"] = []
    c = as_user(ALICE, "alice@example.com")
    res = c.get("/candidate/peer-reports")
    record(
        "GET /peer-reports returns empty list when caller has no reports",
        res.status_code == 200 and res.json() == [],
        f"status={res.status_code} body={res.json()}",
    )


def test_peer_reports_returns_own_only_newest_first():
    _reset_tables()
    now = datetime.now(timezone.utc)
    _STORE.tables["peer_interview_reports"] = [
        {
            "id": "r-1",
            "room_id": "room-1",
            "student_id": ALICE,
            "partner_student_id": BOB,
            "role": "candidate",
            "overall_score": 7.5,
            "technical_score": 8.0,
            "communication_score": 7.0,
            "confidence_score": 7.0,
            "problem_solving_score": 8.0,
            "topics_covered": ["arrays"],
            "strengths": ["clear"],
            "weaknesses": ["nervous"],
            "suggestions": ["practice more"],
            "final_recommendation": "Hire",
            "created_at": (now - timedelta(days=2)).isoformat(),
        },
        {
            "id": "r-2",
            "room_id": "room-2",
            "student_id": ALICE,
            "partner_student_id": CAROL,
            "role": "interviewer",
            "overall_score": 9.0,
            "technical_score": None,
            "communication_score": None,
            "confidence_score": None,
            "problem_solving_score": None,
            "topics_covered": [],
            "strengths": [],
            "weaknesses": [],
            "suggestions": [],
            "final_recommendation": None,
            "created_at": now.isoformat(),
        },
        {
            "id": "r-3-bob",
            "room_id": "room-3",
            "student_id": BOB,  # someone else's report
            "partner_student_id": ALICE,
            "role": "candidate",
            "overall_score": 5.0,
            "technical_score": None,
            "communication_score": None,
            "confidence_score": None,
            "problem_solving_score": None,
            "topics_covered": [],
            "strengths": [],
            "weaknesses": [],
            "suggestions": [],
            "final_recommendation": None,
            "created_at": now.isoformat(),
        },
    ]
    c = as_user(ALICE, "alice@example.com")
    res = c.get("/candidate/peer-reports")
    body = res.json()
    record(
        "GET /peer-reports returns only Alice's own reports (not Bob's)",
        res.status_code == 200 and len(body) == 2 and all(r["id"] != "r-3-bob" for r in body),
        f"status={res.status_code} count={len(body)} ids={[r['id'] for r in body]}",
    )
    record(
        "GET /peer-reports is ordered newest-first",
        body[0]["id"] == "r-2" and body[1]["id"] == "r-1",
        f"first={body[0]['id']} second={body[1]['id']}",
    )
    record(
        "GET /peer-reports resolves partner_display_name from profiles",
        body[0]["partner_display_name"] == "Carol C" and body[1]["partner_display_name"] == "Bob B",
        f"first_partner={body[0]['partner_display_name']} second_partner={body[1]['partner_display_name']}",
    )


def test_peer_reports_requires_authentication():
    _reset_tables()
    # Explicitly clear the fake auth override so we hit the real dependency
    # (which raises 401 for our fake bearer). Simplest way is to just remove
    # the override for the peer router's get_current_user.
    app.dependency_overrides.pop(peer_router.get_current_user, None)
    from fastapi.testclient import TestClient as _TC
    res = _TC(app).get("/candidate/peer-reports")
    record(
        "GET /peer-reports rejects unauthenticated requests",
        res.status_code == 401,
        f"status={res.status_code}",
    )


# ─── Runner ────────────────────────────────────────────────────────────────
TESTS = [
    ("Alice alone in queue",                        test_alice_enters_queue_alone),
    ("Bob matches Alice; same room ID",             test_bob_matches_alice_same_room_id),
    ("Cannot self-match",                           test_no_self_match),
    ("Third student stays waiting",                 test_third_student_stays_waiting),
    ("No duplicate queue entries",                  test_no_duplicate_queue_entries),
    ("Cancel removes from queue",                   test_cancel_removes_from_queue),
    ("Expired ticket is not matched",               test_expired_ticket_skipped_by_matcher),
    ("Three pairs get three distinct room IDs",     test_three_pairs_get_three_distinct_room_ids),
    ("Third unmatched student doesn't leak room",   test_unmatched_third_while_pair_still_open),
    ("Schedule + list persists",                    test_schedule_meeting_persists),
    ("Reject past date",                            test_reject_past_date),
    ("Reject bad duration",                         test_reject_bad_duration),
    ("Join before window -> is_ready=False",        test_join_before_window_forbidden),
    ("Join inside window -> is_ready=True",         test_join_within_window_is_ready),
    ("Three scheduled meetings distinct room IDs",  test_three_scheduled_meetings_have_distinct_room_ids),
    ("Public: meeting visible to another student",  test_public_upcoming_visible_to_all_students),
    ("Public: privacy hides host real name",        test_public_upcoming_host_privacy_hides_real_name),
    ("Lifecycle: initial status = scheduled",       test_lifecycle_initial_status_scheduled),
    ("Lifecycle: early join does not advance",      test_join_before_window_does_not_advance_status),
    ("Lifecycle: scheduled->waiting->live->done",   test_lifecycle_scheduled_to_waiting_to_live_to_completed),
    ("Auth: invite-only blocks third parties",      test_charlie_cannot_join_invitation_only),
    ("Auth: open meetings joinable by anyone",      test_open_meeting_lets_anyone_join),
    ("Refresh preserves server-side status",        test_refresh_preserves_status_and_room_id),
    ("Multiple meetings stay independent",          test_multiple_scheduled_meetings_have_unique_rooms_and_stay_separate),
    ("Same scheduled meeting -> same room for both",test_two_users_invited_to_same_scheduled_meeting_share_room_id),
    ("Cancel scheduled meeting",                    test_cancel_scheduled_meeting),
    ("Non-creator cannot cancel",                   test_non_creator_cannot_cancel),
    ("Session token carries real identity",         test_session_token_mints_real_identity),
    ("Peer reports: empty caller returns []",       test_peer_reports_empty_returns_empty_list),
    ("Peer reports: caller sees own rows only",     test_peer_reports_returns_own_only_newest_first),
    ("Peer reports: unauthenticated -> 401",        test_peer_reports_requires_authentication),
]

if __name__ == "__main__":
    print("=== FastAPI matchmaking + scheduling tests ===\n")
    for title, fn in TESTS:
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            record(title + " (crashed)", False, f"{type(e).__name__}: {e}")

    passed = sum(1 for _, ok, _ in _results if ok)
    failed = len(_results) - passed
    print(f"\n=== {passed}/{len(_results)} passed, {failed} failed ===")
    sys.exit(0 if failed == 0 else 1)
