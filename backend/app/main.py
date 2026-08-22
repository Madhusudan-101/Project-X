from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers.shared import auth
from .routers.college import students, drives, dashboard, shortlist, departments
from .routers.candidate import sync, analyze, practice
# NOTE: routers/company/{company,roles}.py exist but are NOT wired in here —
# they depend on deps.require_company_role, crud helpers (get_company_by_owner_id,
# create_role, etc.) and schemas (CompanyOut, RoleCreateIn, etc.) that were never
# implemented, and no `companies`/`roles` tables exist in db/ migrations yet.
# Importing them here would crash the app at startup. That's a separate feature
# to scope and build (migrations + RLS + crud + schemas + the auth dependency),
# not something to bundle into a folder reorg.

app = FastAPI(title="Mirracle API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
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

@app.get("/")
def root():
    return {"ok": True, "msg": "Mirracle backend"}
