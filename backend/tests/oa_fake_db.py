"""In-memory stand-in for the Supabase client subset the OA routers use."""
import uuid
from types import SimpleNamespace


DEFAULTS = {
    "oa_invites": {"status": "invited"},
    "oa_assessments": {"invite_mode": "invited"},
}


class Q:
    def __init__(self, store, name):
        self.store, self.name = store, name
        self.rows = store.setdefault(name, [])
        self.f, self.op, self.payload, self.lim, self.ord = [], "select", None, None, None
        self.conflict = None

    def select(self, *_): return self
    def eq(self, c, v): self.f.append(lambda r: r.get(c) == v); return self
    def neq(self, c, v): self.f.append(lambda r: r.get(c) != v); return self
    def in_(self, c, vs): s = set(vs); self.f.append(lambda r: r.get(c) in s); return self
    def order(self, c, desc=False): self.ord = (c, desc); return self
    def limit(self, n): self.lim = n; return self
    def insert(self, p): self.op, self.payload = "insert", p; return self
    def update(self, p): self.op, self.payload = "update", p; return self
    def delete(self): self.op = "delete"; return self
    def upsert(self, p, on_conflict=None): self.op, self.payload, self.conflict = "upsert", p, on_conflict; return self

    def execute(self):
        m = lambda r: all(f(r) for f in self.f)
        if self.op == "insert":
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for it in items:
                row = {"id": str(uuid.uuid4()), **DEFAULTS.get(self.name, {}), **it}
                if self.name == "oa_submissions": row.setdefault("created_at", __import__("datetime").datetime.now().isoformat())
                if self.name == "oa_attempts":
                    if any(r["application_id"] == row["application_id"] for r in self.rows):
                        raise __import__("postgrest").exceptions.APIError({"message": "dup", "code": "23505"})
                    row.setdefault("status", "in_progress"); row.setdefault("tab_switches", 0)
                self.rows.append(row); out.append(row)
            return SimpleNamespace(data=out)
        if self.op == "update":
            out = [r for r in self.rows if m(r)]
            for r in out: r.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in out])
        if self.op == "delete":
            self.rows[:] = [r for r in self.rows if not m(r)]
            return SimpleNamespace(data=[])
        if self.op == "upsert":
            keys = self.conflict.split(",")
            for r in self.rows:
                if all(r.get(k) == self.payload[k] for k in keys):
                    r.update(self.payload); return SimpleNamespace(data=[r])
            row = {"id": str(uuid.uuid4()), **self.payload}; self.rows.append(row)
            return SimpleNamespace(data=[row])
        out = [dict(r) for r in self.rows if m(r)]
        if self.ord: out.sort(key=lambda r: r[self.ord[0]], reverse=self.ord[1])
        return SimpleNamespace(data=out[: self.lim] if self.lim else out)


class FakeDB:
    def __init__(self): self.store = {}
    def table(self, n): return Q(self.store, n)
