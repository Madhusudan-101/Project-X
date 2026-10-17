import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from .routers.shared import auth, peer_reports, ai_interview_reports

# Without this, every `logger.exception(...)`/`logger.warning(...)` call across
# the whole backend is a silent no-op — the root logger has no handler
# attached unless something configures one, and nothing did.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
from .routers.college import students, drives, dashboard, shortlist, departments
from .routers.candidate import sync, analyze, practice, peer, ai_interview
from .routers.candidate import jobs as candidate_jobs
from .routers.candidate import assessment as candidate_assessment
from .routers.candidate import assessment_code as candidate_assessment_code
from .routers.candidate import resume_tailor as candidate_resume_tailor
from .routers.company import company, roles as company_roles
from .routers.company import jobs as company_jobs
from .routers.company import applicants as company_applicants
from .routers.company import drives as company_drives
from .routers.company import assessment as company_assessment
from .routers.admin import overview as admin_overview
from .routers.admin import colleges as admin_colleges
from .routers.admin import companies as admin_companies
from .routers.admin import candidates as admin_candidates
from .routers.admin import placements as admin_placements
from .routers.admin import finance as admin_finance
from .routers.admin import users as admin_users
from .routers.admin import activity as admin_activity
from .routers.admin import alerts as admin_alerts
from .routers.admin import search as admin_search
from .routers.admin import system as admin_system
from .routers.admin import reports as admin_reports
from .routers.admin import departments as admin_departments
from .routers.admin import admin_users as admin_admin_users

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

_log = logging.getLogger(__name__)
# PostgREST errors that mean "the database doesn't have what this code expects" (a migration wasn't run).
_SCHEMA_CODES = {"PGRST204", "PGRST205", "42703", "42P01"}


@app.exception_handler(APIError)
async def _database_error(request, exc: APIError):
    """An uncaught database error used to surface as a bare 500 with no CORS headers, which the browser
    reports as an opaque "NetworkError". Answer with JSON instead (this handler runs inside the CORS
    middleware), and name the likely cause when it is a missing column or table."""
    code, message = getattr(exc, "code", None), getattr(exc, "message", None) or str(exc)
    _log.error("Unhandled database error on %s %s: [%s] %s", request.method, request.url.path, code, message)
    if code in _SCHEMA_CODES or "schema cache" in (message or ""):
        return JSONResponse(status_code=503, content={"detail": (
            "The database is missing a column or table this feature needs. Run the newest SQL files in "
            "backend/db/ (for the online assessment: the online_assessment_*_migration.sql files, in order), "
            f"then run: notify pgrst, 'reload schema';   [database said: {message}]")})
    return JSONResponse(status_code=500, content={"detail": "A database error occurred. Check the backend log."})


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
app.include_router(ai_interview.router)
app.include_router(ai_interview_reports.router)
app.include_router(company.router)
app.include_router(company_roles.router)
app.include_router(company_jobs.router)
app.include_router(company_applicants.router)
app.include_router(company_drives.router)
app.include_router(company_assessment.router)
app.include_router(candidate_jobs.router)
app.include_router(candidate_assessment.router)
app.include_router(candidate_assessment_code.router)
app.include_router(candidate_resume_tailor.router)
# Admin Portal — every router carries the require_admin_role dependency.
app.include_router(admin_overview.router)
app.include_router(admin_colleges.router)
app.include_router(admin_companies.router)
app.include_router(admin_candidates.router)
app.include_router(admin_placements.router)
app.include_router(admin_finance.router)
app.include_router(admin_users.router)
app.include_router(admin_activity.router)
app.include_router(admin_alerts.router)
app.include_router(admin_search.router)
app.include_router(admin_system.router)
app.include_router(admin_reports.router)
app.include_router(admin_departments.router)
app.include_router(admin_admin_users.router)

@app.get("/")
def root():
    return {"ok": True, "msg": "Mirracle backend"}
