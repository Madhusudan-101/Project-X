"""College view of the platform pipeline — GET /api/dashboard/platform  (read-only)

Companies open drives at a college through the Company Portal (job_drives), and the college's students
apply to them through the Candidate Portal (applications). Until now the College Portal could see none of
that. This endpoint shows a TPO, for THEIR college only:

  * the platform drives aimed at the college (live or closed — a company's drafts are its own business),
    with the rounds and a funnel of how their students are doing in each;
  * which of their roster students applied, to what, and how far they got.

What it never does:
  * write anything — this module has no insert / update / delete;
  * show another college's drives or students: drives are filtered by the caller's college_id, and a
    student appears only if (a) their platform account is at THIS college and (b) their email is on THIS
    college's roster. A self-declared college on a profile therefore reveals nothing by itself: an
    unrostered account never shows up, and the roster is the TPO's own record;
  * expose scores, AI analyses, resumes, cover letters, screening answers or compensation — only the
    status of each application and round.

Data access: job_drives / jobs / applications / profiles have no College row-level-security policy, and
adding one would change tables owned by the Company and Candidate portals, so they are read with the
service-role client under explicit tenant scoping (the same pattern as
services/college/student_access._find_linked_profile). The roster is read through the caller's own
RLS-bound client, like every other College endpoint.

Open product question (not a code issue): students are not shown a notice that their college's placement
cell can see their application status. That notice belongs to the Candidate Portal.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Iterable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from supabase import Client

from ...deps import db_client, get_current_tpo, get_user_supabase

log = logging.getLogger(__name__)
router = APIRouter(prefix="/platform", tags=["college-platform"])

VISIBLE_DRIVE_STATUSES = ["live", "closed"]
_CHUNK = 100     # ids per in.(...) filter: keeps the URL short
_PAGE = 1000     # PostgREST's default row cap per request

_IN_PROGRESS = {"applied", "scoring", "scored"}


def _chunks(items: Iterable[Any], size: Optional[int] = None) -> Iterable[List[Any]]:
    size = size or _CHUNK
    items = list(items)
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _all_pages(build: Callable[[], Any]) -> List[Dict[str, Any]]:
    """Every row of a query, page by page, so a big college is not silently cut at PostgREST's row cap."""
    rows: List[Dict[str, Any]] = []
    start = 0
    while True:
        page = build().range(start, start + _PAGE - 1).execute().data or []
        rows += page
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _in(table: str, columns: str, column: str, ids: Iterable[Any], client=db_client, **eq) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for chunk in _chunks(ids):
        q = client.table(table).select(columns).in_(column, chunk)
        for k, v in eq.items():
            q = q.eq(k, v)
        out += q.execute().data or []
    return out


def _iso(value: Any) -> Optional[str]:
    return str(value) if value else None


def build_platform_view(college_id: str, sb: Client) -> Dict[str, Any]:
    drives = (
        db_client.table("job_drives").select("*")
        .eq("college_id", college_id).in_("status", VISIBLE_DRIVE_STATUSES)
        .order("apply_deadline", desc=False).execute().data or []
    )
    empty = {"drives": [], "students": [], "studentsOnPlatform": 0,
             "totals": {"applications": 0, "selected": 0, "needsRosterUpdate": 0}}
    if not drives:
        return empty

    drive_by_job = {d["job_id"]: d for d in drives}
    jobs = {j["id"]: j for j in _in("jobs", "id, title, company_id, location, employment_type", "id", drive_by_job)}
    companies = {c["id"]: c["name"] for c in _in("companies", "id, name", "id", {j["company_id"] for j in jobs.values()})}
    rounds: Dict[str, List[Dict[str, Any]]] = {}
    for r in sorted(_in("job_drive_rounds", "id, drive_id, round_number, round_type, mode, window_start, window_end",
                        "drive_id", [d["id"] for d in drives]), key=lambda r: r["round_number"]):
        rounds.setdefault(r["drive_id"], []).append(r)

    # Applications to those jobs, then only the students who are really this college's (see module docstring).
    apps: List[Dict[str, Any]] = []
    for chunk in _chunks(drive_by_job):
        apps += _all_pages(lambda c=chunk: db_client.table("applications")
                           .select("id, student_id, job_id, status, applied_at").in_("job_id", c).order("id"))
    profiles = _in("profiles", "id, email, college_id", "id", {a["student_id"] for a in apps},
                   role="candidate", college_id=college_id)
    email_of = {p["id"]: (p.get("email") or "").strip().lower() for p in profiles}
    roster: Dict[str, Dict[str, Any]] = {}
    for chunk in _chunks({e for e in email_of.values() if e}):
        try:
            for s in (sb.table("students").select("id, name, email, branch, graduation_year, placement_status")
                      .eq("college_id", college_id).in_("email", chunk).execute().data or []):
                roster[(s["email"] or "").lower()] = s
        except APIError as e:
            log.error("Roster lookup failed for college %s: %s", college_id, e)
            raise HTTPException(status_code=500, detail="Could not load your roster.")
    student_row = {pid: roster[mail] for pid, mail in email_of.items() if mail in roster}
    mine = [a for a in apps if a["student_id"] in student_row]

    results: Dict[str, Dict[str, str]] = {}
    for r in _in("application_round_results", "application_id, round_id, status", "application_id", [a["id"] for a in mine]):
        results.setdefault(r["application_id"], {})[r["round_id"]] = r["status"]

    def application_out(a: Dict[str, Any]) -> Dict[str, Any]:
        drive = drive_by_job[a["job_id"]]
        job = jobs.get(a["job_id"], {})
        return {
            "driveId": drive["id"],
            "jobTitle": job.get("title"),
            "companyName": companies.get(job.get("company_id")),
            "status": a["status"],
            "appliedAt": _iso(a.get("applied_at")),
            "rounds": [
                {"number": r["round_number"], "type": r["round_type"], "mode": r["mode"],
                 "status": results.get(a["id"], {}).get(r["id"], "pending")}
                for r in rounds.get(drive["id"], [])
            ],
        }

    drives_out = []
    for d in drives:
        job = jobs.get(d["job_id"], {})
        its = [a for a in mine if a["job_id"] == d["job_id"]]
        drives_out.append({
            "id": d["id"],
            "jobTitle": job.get("title"),
            "companyName": companies.get(job.get("company_id")),
            "location": job.get("location"),
            "employmentType": job.get("employment_type"),
            "status": d["status"],
            "isOnCampus": bool(d.get("is_on_campus", True)),
            "applyDeadline": _iso(d.get("apply_deadline")),
            "eligibility": {
                "minCgpa": float(d["min_cgpa"]) if d.get("min_cgpa") is not None else None,
                "branches": d.get("eligible_branches") or [],
                "batchYears": d.get("eligible_batch_years") or [],
            },
            "rounds": [{"number": r["round_number"], "type": r["round_type"], "mode": r["mode"],
                        "windowStart": _iso(r.get("window_start")), "windowEnd": _iso(r.get("window_end"))}
                       for r in rounds.get(d["id"], [])],
            "funnel": {
                "applicants": len({a["student_id"] for a in its}),
                "inProgress": sum(a["status"] in _IN_PROGRESS for a in its),
                "shortlisted": sum(a["status"] == "shortlisted" for a in its),
                "inInterview": sum(a["status"] == "in_interview" for a in its),
                "selected": sum(a["status"] == "hired" for a in its),
                "rejected": sum(a["status"] == "rejected" for a in its),
            },
        })

    by_student: Dict[str, List[Dict[str, Any]]] = {}
    for a in sorted(mine, key=lambda a: str(a.get("applied_at") or ""), reverse=True):
        by_student.setdefault(a["student_id"], []).append(a)
    students_out = []
    needs_update = 0
    for pid, its in by_student.items():
        row = student_row[pid]
        selected = any(a["status"] == "hired" for a in its)
        # Selected on the platform while the roster still says otherwise: a prompt for the TPO to review
        # and update the roster themselves — nothing here ever changes it.
        stale = selected and row.get("placement_status") != "placed"
        needs_update += stale
        students_out.append({
            "studentId": row["id"], "name": row["name"], "email": row["email"], "branch": row["branch"],
            "graduationYear": row["graduation_year"], "placementStatus": row.get("placement_status"),
            "selectedOnPlatform": selected, "rosterNeedsReview": stale,
            "applications": [application_out(a) for a in its],
        })
    students_out.sort(key=lambda s: (not s["selectedOnPlatform"], (s["name"] or "").lower()))

    return {
        "drives": drives_out,
        "students": students_out,
        "studentsOnPlatform": len(by_student),
        "totals": {"applications": len(mine), "selected": sum(a["status"] == "hired" for a in mine),
                   "needsRosterUpdate": needs_update},
    }


@router.get("")
def platform_overview(tpo: dict = Depends(get_current_tpo), sb: Client = Depends(get_user_supabase)):
    try:
        return build_platform_view(tpo["college_id"], sb)
    except APIError as e:
        log.error("Platform overview failed for college %s: %s", tpo["college_id"], e)
        raise HTTPException(status_code=500, detail="Could not load platform activity.")
