import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers.shared import auth, peer_reports

# Without this, every `logger.exception(...)`/`logger.warning(...)` call across
# the whole backend is a silent no-op — the root logger has no handler
# attached unless something configures one, and nothing did.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
from .routers.college import students, drives, dashboard, shortlist, departments
from .routers.candidate import sync, analyze, practice, peer
from .routers.company import company, roles as company_roles

app = FastAPI(title="Mirracle API")

# CORS: default allow-list covers the dev origins the dashboard, admin, and
# PeerMeet client run on. Production origins are added via `FRONTEND_ORIGINS`
# (comma-separated) so a deploy can grant its real domain access without a
# code change and without keeping localhost in the browser-facing list. The
# localhost regex covers arbitrary Vite/TanStack port choices during dev; it
# is intentionally NOT sourced from env so it always stays scoped to loopback.
_DEV_ORIGINS = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
def _normalize_origin(raw: str) -> str:
    """CORSMiddleware does exact-string origin matching, so a stray trailing
    slash or surrounding whitespace in the env value silently blocks the
    real browser origin. Normalize to `scheme://host[:port]` before the
    allow-list gets built."""
    return raw.strip().rstrip("/")


_env_origins = [
    _normalize_origin(o)
    for o in (os.getenv("FRONTEND_ORIGINS") or "").split(",")
    if _normalize_origin(o)
]
_ALLOWED_ORIGINS = list({*_DEV_ORIGINS, *_env_origins})

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(students.router)
app.include_router(drives.router)
app.include_router(dashboard.router)
app.include_router(shortlist.router)
app.include_router(departments.router)
app.include_router(sync.router)
app.include_router(analyze.router)
app.include_router(practice.router)
app.include_router(peer.router)
app.include_router(peer_reports.router)
app.include_router(company.router)
app.include_router(company_roles.router)

@app.get("/")
def root():
    return {"ok": True, "msg": "Mirracle backend"}
