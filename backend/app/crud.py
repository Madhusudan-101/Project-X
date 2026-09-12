"""Database helpers for the profiles table.

Uses db_client (a dedicated Supabase client) so that auth operations
on the auth_client don't taint the DB client's auth context / RLS.
"""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from postgrest.exceptions import APIError
from .deps import db_client
from .utils.college.branch import branch_matches


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def upsert_profile(user_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Insert or update a profile row.  Requires at least email + role for inserts."""
    res = db_client.table("profiles").upsert({"id": user_id, **payload}).execute()
    return res.data[0] if res.data else None


def get_profile_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    """Return a single profile dict, or None if not found."""
    try:
        res = db_client.table("profiles").select("*").eq("id", user_id).single().execute()
        return res.data
    except APIError as e:
        if e.code == "PGRST116":  # 0 rows → profile doesn't exist
            return None
        raise


def update_profile(user_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Partial update of an existing profile row."""
    if not payload:
        return get_profile_by_id(user_id)
    res = db_client.table("profiles").update(payload).eq("id", user_id).execute()
    return res.data[0] if res.data else None


def get_profile_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Return a single profile dict by email, or None if not found."""
    res = db_client.table("profiles").select("*").eq("email", email).limit(1).execute()
    return res.data[0] if res.data else None


def find_or_create_college_by_name(name: str) -> Optional[str]:
    """Resolve a free-text college name to a public.colleges row id, creating
    the row if it doesn't exist yet. Used to actually populate
    profiles.college_id for candidate accounts (restricted-job visibility)."""
    clean = (name or "").strip()
    if not clean:
        return None
    existing = (
        db_client.table("colleges").select("id").ilike("name", clean).limit(1).execute()
    )
    if existing.data:
        return existing.data[0]["id"]
    created = db_client.table("colleges").insert({"name": clean}).execute()
    return created.data[0]["id"] if created.data else None


# ── Companies ────────────────────────────────────────────────────────────

def create_company(owner_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    res = db_client.table("companies").insert({"owner_id": owner_id, **payload}).execute()
    return res.data[0] if res.data else None


def get_company_by_owner_id(owner_id: str) -> Optional[Dict[str, Any]]:
    res = db_client.table("companies").select("*").eq("owner_id", owner_id).limit(1).execute()
    return res.data[0] if res.data else None


def update_company(owner_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not payload:
        return get_company_by_owner_id(owner_id)
    res = db_client.table("companies").update(payload).eq("owner_id", owner_id).execute()
    return res.data[0] if res.data else None


def upsert_company(owner_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Insert or update a company row keyed by owner_id (unique). Used by
    company onboarding, which is the single create-point for accounts that
    signed up via Google/generic signup rather than the atomic
    /auth/company-signup form. Inserts require name + industry + size
    (all NOT NULL)."""
    res = (
        db_client.table("companies")
        .upsert({"owner_id": owner_id, **payload}, on_conflict="owner_id")
        .execute()
    )
    return res.data[0] if res.data else None


# ── Job roles ────────────────────────────────────────────────────────────

def create_role(company_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    res = db_client.table("job_roles").insert({"company_id": company_id, **payload}).execute()
    return res.data[0] if res.data else None


def get_role_by_id(role_id: str, company_id: str) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("job_roles")
        .select("*")
        .eq("id", role_id)
        .eq("company_id", company_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def list_roles_by_company(company_id: str, status: Optional[str] = None) -> list:
    query = db_client.table("job_roles").select("*").eq("company_id", company_id)
    if status is not None:
        query = query.eq("status", status)
    res = query.order("created_at", desc=True).execute()
    return res.data or []


def update_role(role_id: str, company_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not payload:
        return get_role_by_id(role_id, company_id)
    res = (
        db_client.table("job_roles")
        .update(payload)
        .eq("id", role_id)
        .eq("company_id", company_id)
        .execute()
    )
    return res.data[0] if res.data else None


def delete_role(role_id: str, company_id: str) -> bool:
    res = (
        db_client.table("job_roles")
        .delete()
        .eq("id", role_id)
        .eq("company_id", company_id)
        .execute()
    )
    return bool(res.data)


# ── Skills master taxonomy ───────────────────────────────────────────────

def resolve_skill_ids(names: list) -> tuple:
    """Map a list of skill names to (skill_ids, canonical_names).

    A name already in public.skills (case-insensitive) resolves to its row;
    a name not found is inserted as a custom, non-predefined skill so
    job_skills.skill_id always has a valid FK target.
    """
    ids: list = []
    canonical: list = []
    seen: set = set()
    for raw in names:
        name = (raw or "").strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        existing = (
            db_client.table("skills")
            .select("id, name")
            .ilike("name", name)
            .limit(1)
            .execute()
        )
        if existing.data:
            ids.append(existing.data[0]["id"])
            canonical.append(existing.data[0]["name"])
            continue
        created = (
            db_client.table("skills")
            .insert({"name": name, "is_predefined": False})
            .execute()
        )
        if created.data:
            ids.append(created.data[0]["id"])
            canonical.append(created.data[0]["name"])
    return ids, canonical


# ── Jobs ────────────────────────────────────────────────────────────────

def create_job(company_id: str, data: dict) -> Optional[Dict[str, Any]]:
    # `data` is a plain column→value dict from the router, so any jobs column
    # (incl. the eligibility / offer-detail columns from
    # jobs_eligibility_migration.sql) passes straight through.
    res = db_client.table("jobs").insert({"company_id": company_id, **data}).execute()
    return res.data[0] if res.data else None


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    res = db_client.table("jobs").select("*").eq("id", job_id).limit(1).execute()
    return res.data[0] if res.data else None


def list_jobs_by_company(company_id: str, status: Optional[str] = None) -> list:
    q = db_client.table("jobs").select("*").eq("company_id", company_id)
    if status is not None:
        q = q.eq("status", status)
    res = q.order("created_at", desc=True).execute()
    return res.data or []


def update_job(job_id: str, data: dict) -> Optional[Dict[str, Any]]:
    # `data` is a partial column→value dict; any jobs column (incl. the
    # eligibility / offer-detail columns) passes straight through.
    if not data:
        return get_job(job_id)
    res = db_client.table("jobs").update(data).eq("id", job_id).execute()
    return res.data[0] if res.data else None


def set_job_skills(job_id: str, skill_ids: list) -> None:
    db_client.table("job_skills").delete().eq("job_id", job_id).execute()
    if skill_ids:
        db_client.table("job_skills").insert(
            [{"job_id": job_id, "skill_id": sid} for sid in skill_ids]
        ).execute()


def set_job_visible_colleges(job_id: str, college_ids: list) -> None:
    db_client.table("job_visible_colleges").delete().eq("job_id", job_id).execute()
    if college_ids:
        db_client.table("job_visible_colleges").insert(
            [{"job_id": job_id, "college_id": cid} for cid in college_ids]
        ).execute()


# ── Screening questions (screening_questions_migration.sql) ──────────

def set_job_screening_questions(job_id: str, questions: list) -> None:
    """Delete-and-reinsert the job's screening questions. `questions` is a
    list of {question_text, required, position} dicts."""
    db_client.table("job_screening_questions").delete().eq("job_id", job_id).execute()
    if questions:
        db_client.table("job_screening_questions").insert([
            {
                "job_id": job_id,
                "question_text": q["question_text"],
                "required": bool(q.get("required", True)),
                "position": int(q.get("position", i)),
            }
            for i, q in enumerate(questions)
        ]).execute()


def get_job_screening_questions(job_id: str) -> list:
    res = (
        db_client.table("job_screening_questions")
        .select("*")
        .eq("job_id", job_id)
        .order("position", desc=False)
        .order("created_at", desc=False)
        .execute()
    )
    return res.data or []


def get_screening_answers_for_application(
    application_id: str, job_id: str
) -> list:
    """One row per question on this job, in position order, with this
    application's answer merged in (None if the student left an optional
    question blank or the job has no questions)."""
    questions = get_job_screening_questions(job_id)  # already ordered
    res = (
        db_client.table("application_screening_answers")
        .select("question_id, answer")
        .eq("application_id", application_id)
        .execute()
    )
    answers_by_qid = {r["question_id"]: r["answer"] for r in (res.data or [])}
    return [
        {
            "question_text": q["question_text"],
            "required": bool(q.get("required", True)),
            "answer": answers_by_qid.get(q["id"]),
        }
        for q in questions
    ]


def job_ids_with_screening_questions(job_ids: list) -> set:
    ids = [j for j in set(job_ids) if j]
    if not ids:
        return set()
    res = (
        db_client.table("job_screening_questions")
        .select("job_id")
        .in_("job_id", ids)
        .execute()
    )
    return {r["job_id"] for r in (res.data or [])}


def insert_application_screening_answers(application_id: str, answers: list) -> None:
    """`answers` is a list of {question_id, answer} dicts."""
    rows = [
        {"application_id": application_id, "question_id": a["question_id"], "answer": a.get("answer")}
        for a in answers
        if a.get("question_id")
    ]
    if rows:
        db_client.table("application_screening_answers").upsert(
            rows, on_conflict="application_id,question_id"
        ).execute()


def upsert_job_weights(job_id: str, weights: dict) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("job_weights")
        .upsert({"job_id": job_id, **weights}, on_conflict="job_id")
        .execute()
    )
    return res.data[0] if res.data else None


def get_job_weights(job_id: str) -> Optional[Dict[str, Any]]:
    res = db_client.table("job_weights").select("*").eq("job_id", job_id).limit(1).execute()
    return res.data[0] if res.data else None


def get_job_skill_names(job_id: str) -> list:
    res = (
        db_client.table("job_skills")
        .select("skills(name)")
        .eq("job_id", job_id)
        .execute()
    )
    out = []
    for row in res.data or []:
        skill = row.get("skills")
        if isinstance(skill, dict) and skill.get("name"):
            out.append(skill["name"])
    return out


def get_job_visible_college_ids(job_id: str) -> list:
    res = (
        db_client.table("job_visible_colleges")
        .select("college_id")
        .eq("job_id", job_id)
        .execute()
    )
    return [r["college_id"] for r in (res.data or [])]


def count_applications_for_job(job_id: str) -> int:
    res = (
        db_client.table("applications")
        .select("id", count="exact")
        .eq("job_id", job_id)
        .execute()
    )
    return res.count or 0


# ── Student job board ──────────────────────────────────────────────────

def list_live_jobs_for_student(domain: Optional[str], college_id: Optional[str]) -> list:
    """Step 2 query: live jobs whose domain matches the student, that are
    either open to all colleges or explicitly allow the student's college.

    If the student has no domain set yet (accounts onboarded before the
    field existed), domain filtering is skipped so the board is not empty —
    they still only see 'all'-visibility jobs plus their own college's.
    """
    open_q = (
        db_client.table("jobs")
        .select("*")
        .eq("status", "live")
        .eq("visibility", "all")
        .order("created_at", desc=True)
    )
    if domain:
        open_q = open_q.eq("domain", domain)
    jobs = {r["id"]: r for r in (open_q.execute().data or [])}

    if college_id:
        restricted_ids_res = (
            db_client.table("job_visible_colleges")
            .select("job_id")
            .eq("college_id", college_id)
            .execute()
        )
        restricted_job_ids = [r["job_id"] for r in (restricted_ids_res.data or [])]
        if restricted_job_ids:
            r_q = (
                db_client.table("jobs")
                .select("*")
                .eq("status", "live")
                .eq("visibility", "restricted")
                .in_("id", restricted_job_ids)
            )
            if domain:
                r_q = r_q.eq("domain", domain)
            for r in r_q.execute().data or []:
                jobs[r["id"]] = r

    return sorted(jobs.values(), key=lambda j: j.get("created_at") or "", reverse=True)


def student_can_see_job(job: dict, college_id: Optional[str]) -> bool:
    """Mirror of list_live_jobs_for_student for a single job (detail page / apply)."""
    if job.get("status") != "live":
        return False
    if job.get("visibility") == "all":
        return True
    if not college_id:
        return False
    res = (
        db_client.table("job_visible_colleges")
        .select("college_id")
        .eq("job_id", job["id"])
        .eq("college_id", college_id)
        .limit(1)
        .execute()
    )
    return bool(res.data)


# ── Companies (names for display) ─────────────────────────────────────

def get_company_names(company_ids: list) -> Dict[str, str]:
    ids = [c for c in set(company_ids) if c]
    if not ids:
        return {}
    res = db_client.table("companies").select("id, name").in_("id", ids).execute()
    return {r["id"]: r["name"] for r in (res.data or [])}


# ── Applications ──────────────────────────────────────────────────────

def create_application(
    student_id: str, job_id: str, company_id: str, cover_letter: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    row: Dict[str, Any] = {
        "student_id": student_id,
        "job_id": job_id,
        "company_id": company_id,
    }
    if cover_letter is not None:
        row["cover_letter"] = cover_letter
    res = db_client.table("applications").insert(row).execute()
    return res.data[0] if res.data else None


def get_application(application_id: str) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("applications")
        .select("*")
        .eq("id", application_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def get_application_by_student_job(student_id: str, job_id: str) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("applications")
        .select("*")
        .eq("student_id", student_id)
        .eq("job_id", job_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def list_applications_for_student(student_id: str) -> list:
    res = (
        db_client.table("applications")
        .select("*")
        .eq("student_id", student_id)
        .order("applied_at", desc=True)
        .execute()
    )
    return res.data or []


def list_applications_for_job(job_id: str) -> list:
    res = (
        db_client.table("applications")
        .select("*")
        .eq("job_id", job_id)
        .order("applied_at", desc=True)
        .execute()
    )
    return res.data or []


def set_application_status(application_id: str, status: str) -> Optional[Dict[str, Any]]:
    """Unscoped status write — used by the scoring pipeline only."""
    res = (
        db_client.table("applications")
        .update({"status": status})
        .eq("id", application_id)
        .execute()
    )
    return res.data[0] if res.data else None


def update_application_status_for_company(
    application_id: str, company_id: str, status: str
) -> Optional[Dict[str, Any]]:
    """Company-scoped status write — the .eq('company_id') is the guard that
    a company can only move its own jobs' applications."""
    res = (
        db_client.table("applications")
        .update({"status": status})
        .eq("id", application_id)
        .eq("company_id", company_id)
        .execute()
    )
    return res.data[0] if res.data else None


# ── Application analyses (job-scoped scoring results) ─────────────────

def get_application_analysis(application_id: str) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("application_analyses")
        .select("*")
        .eq("application_id", application_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def upsert_application_analysis(payload: dict) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("application_analyses")
        .upsert(payload, on_conflict="application_id")
        .execute()
    )
    return res.data[0] if res.data else None


# ── Preparation plans (prep_plan_migration.sql) ──────────────────────


def get_prep_plan(application_id: str) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("application_prep_plans")
        .select("*")
        .eq("application_id", application_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def upsert_prep_plan(payload: dict) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("application_prep_plans")
        .upsert(payload, on_conflict="application_id")
        .execute()
    )
    return res.data[0] if res.data else None


# ── Resume tailoring (resume_tailoring_migration.sql) ────────────────


def create_tailoring_run(payload: dict) -> Optional[Dict[str, Any]]:
    res = db_client.table("resume_tailoring_runs").insert(payload).execute()
    return res.data[0] if res.data else None


def get_tailoring_run(run_id: str) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("resume_tailoring_runs")
        .select("*")
        .eq("id", run_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def get_latest_tailoring_run_for_application(application_id: str) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("resume_tailoring_runs")
        .select("*")
        .eq("application_id", application_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def update_tailoring_run(run_id: str, patch: dict) -> Optional[Dict[str, Any]]:
    if not patch:
        return get_tailoring_run(run_id)
    res = db_client.table("resume_tailoring_runs").update(patch).eq("id", run_id).execute()
    return res.data[0] if res.data else None


def insert_tailoring_hunks(run_id: str, hunks: list) -> list:
    if not hunks:
        return []
    res = db_client.table("resume_tailoring_hunks").insert(
        [{"run_id": run_id, **h} for h in hunks]
    ).execute()
    return res.data or []


def list_tailoring_hunks(run_id: str) -> list:
    res = (
        db_client.table("resume_tailoring_hunks")
        .select("*")
        .eq("run_id", run_id)
        .order("hunk_index", desc=False)
        .execute()
    )
    return res.data or []


def set_tailoring_hunk_decision(hunk_id: str, decision: str) -> None:
    db_client.table("resume_tailoring_hunks").update({"decision": decision}).eq("id", hunk_id).execute()


def get_analyses_for_job(job_id: str) -> Dict[str, Dict[str, Any]]:
    """application_id -> analysis row, for the ranked-candidates view."""
    res = (
        db_client.table("application_analyses")
        .select("*")
        .eq("job_id", job_id)
        .execute()
    )
    return {r["application_id"]: r for r in (res.data or [])}


def get_profiles_basic(profile_ids: list) -> Dict[str, Dict[str, Any]]:
    ids = [p for p in set(profile_ids) if p]
    if not ids:
        return {}
    res = (
        db_client.table("profiles")
        .select("id, name, first_name, last_name, email")
        .in_("id", ids)
        .execute()
    )
    return {r["id"]: r for r in (res.data or [])}


def get_profiles_college_map(profile_ids: list) -> Dict[str, Optional[str]]:
    ids = [p for p in set(profile_ids) if p]
    if not ids:
        return {}
    res = (
        db_client.table("profiles")
        .select("id, college_id")
        .in_("id", ids)
        .execute()
    )
    return {r["id"]: r.get("college_id") for r in (res.data or [])}


def get_college_names(college_ids: list) -> Dict[str, str]:
    ids = [c for c in set(college_ids) if c]
    if not ids:
        return {}
    res = db_client.table("colleges").select("id, name").in_("id", ids).execute()
    return {r["id"]: r["name"] for r in (res.data or [])}


# ═════════════════════════════════════════════════════════════════════
# Job drives — one row per (job, college). job_drives_migration.sql.
# APIError bubbles to the router; nothing is swallowed here.
# ═════════════════════════════════════════════════════════════════════


def create_job_drive(job_id: str, data: dict) -> Optional[Dict[str, Any]]:
    res = db_client.table("job_drives").insert({"job_id": job_id, **data}).execute()
    return res.data[0] if res.data else None


def get_job_drive(drive_id: str) -> Optional[Dict[str, Any]]:
    res = db_client.table("job_drives").select("*").eq("id", drive_id).limit(1).execute()
    return res.data[0] if res.data else None


def get_drive_for_job_college(job_id: str, college_id: str) -> Optional[Dict[str, Any]]:
    if not college_id:
        return None
    res = (
        db_client.table("job_drives")
        .select("*")
        .eq("job_id", job_id)
        .eq("college_id", college_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def list_drives_for_job(job_id: str) -> list:
    res = (
        db_client.table("job_drives")
        .select("*")
        .eq("job_id", job_id)
        .order("created_at", desc=False)
        .execute()
    )
    return res.data or []


def list_live_drives_for_college(college_id: str) -> list:
    if not college_id:
        return []
    res = (
        db_client.table("job_drives")
        .select("*")
        .eq("college_id", college_id)
        .eq("status", "live")
        .execute()
    )
    return res.data or []


def update_job_drive(drive_id: str, data: dict) -> Optional[Dict[str, Any]]:
    if not data:
        return get_job_drive(drive_id)
    res = db_client.table("job_drives").update(data).eq("id", drive_id).execute()
    return res.data[0] if res.data else None


# ── Drive rounds ────────────────────────────────────────────────────


def create_drive_round(drive_id: str, data: dict) -> Optional[Dict[str, Any]]:
    res = db_client.table("job_drive_rounds").insert({"drive_id": drive_id, **data}).execute()
    return res.data[0] if res.data else None


def get_drive_round(round_id: str) -> Optional[Dict[str, Any]]:
    res = db_client.table("job_drive_rounds").select("*").eq("id", round_id).limit(1).execute()
    return res.data[0] if res.data else None


def list_rounds_for_drive(drive_id: str) -> list:
    res = (
        db_client.table("job_drive_rounds")
        .select("*")
        .eq("drive_id", drive_id)
        .order("round_number", desc=False)
        .execute()
    )
    return res.data or []


def list_rounds_for_drives(drive_ids: list) -> Dict[str, list]:
    ids = [d for d in set(drive_ids) if d]
    if not ids:
        return {}
    res = (
        db_client.table("job_drive_rounds")
        .select("*")
        .in_("drive_id", ids)
        .order("round_number", desc=False)
        .execute()
    )
    out: Dict[str, list] = {}
    for r in res.data or []:
        out.setdefault(r["drive_id"], []).append(r)
    return out


def update_drive_round(round_id: str, data: dict) -> Optional[Dict[str, Any]]:
    if not data:
        return get_drive_round(round_id)
    res = db_client.table("job_drive_rounds").update(data).eq("id", round_id).execute()
    return res.data[0] if res.data else None


def replace_drive_rounds(drive_id: str, rounds: list) -> None:
    """Delete-and-reinsert the full round set for a drive (used on drive
    create / template apply). `rounds` is a list of column→value dicts."""
    db_client.table("job_drive_rounds").delete().eq("drive_id", drive_id).execute()
    if rounds:
        db_client.table("job_drive_rounds").insert(
            [{"drive_id": drive_id, **r} for r in rounds]
        ).execute()


def clone_drive(
    source_drive_id: str, target_college_id: str, new_dates: dict
) -> Optional[Dict[str, Any]]:
    """Copy a source drive's eligibility / is_on_campus and its round
    structure to a NEW drive at `target_college_id`. The caller supplies
    only the new college and the new date fields:
        new_dates = {
          "apply_deadline": iso, "oa_window_start": iso?, "oa_window_end": iso?,
          "round_dates": [{"window_start": iso?, "window_end": iso?}, ...],
        }
    round_dates lines up positionally with the source rounds (round order).
    """
    src = get_job_drive(source_drive_id)
    if not src:
        raise APIError({"message": "Source drive not found.", "code": "PGRST404"})

    drive = create_job_drive(src["job_id"], {
        "college_id": target_college_id,
        "status": "draft",
        "is_on_campus": src.get("is_on_campus", True),
        "apply_deadline": new_dates["apply_deadline"],
        "oa_window_start": new_dates.get("oa_window_start"),
        "oa_window_end": new_dates.get("oa_window_end"),
        "min_cgpa": src.get("min_cgpa"),
        "eligible_branches": src.get("eligible_branches"),
        "eligible_batch_years": src.get("eligible_batch_years"),
    })
    if not drive:
        return None

    src_rounds = list_rounds_for_drive(source_drive_id)
    round_dates = new_dates.get("round_dates") or []
    new_rounds = []
    for i, r in enumerate(src_rounds):
        d = round_dates[i] if i < len(round_dates) else {}
        new_rounds.append({
            "round_number": r["round_number"],
            "round_type": r["round_type"],
            "mode": r["mode"],
            "window_start": d.get("window_start"),
            "window_end": d.get("window_end"),
        })
    replace_drive_rounds(drive["id"], new_rounds)
    return drive


# ── Drive templates ────────────────────────────────────────────────


def create_drive_template(company_id: str, data: dict) -> Optional[Dict[str, Any]]:
    res = db_client.table("company_drive_templates").insert(
        {"company_id": company_id, **data}
    ).execute()
    return res.data[0] if res.data else None


def list_drive_templates_for_company(company_id: str) -> list:
    res = (
        db_client.table("company_drive_templates")
        .select("*")
        .eq("company_id", company_id)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


def get_drive_template(template_id: str) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("company_drive_templates")
        .select("*")
        .eq("id", template_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def apply_template_to_drive(drive_id: str, template_id: str, dates: dict) -> Optional[Dict[str, Any]]:
    """Write a template's rounds_json into job_drive_rounds for `drive_id`
    with the supplied per-round dates, and copy the template's default
    eligibility onto the drive where the drive has not overridden it.

    dates = {
      "apply_deadline": iso?, "oa_window_start": iso?, "oa_window_end": iso?,
      "round_dates": [{"round_number": n, "window_start": iso?, "window_end": iso?}],
    }
    """
    tmpl = get_drive_template(template_id)
    if not tmpl:
        raise APIError({"message": "Template not found.", "code": "PGRST404"})
    drive = get_job_drive(drive_id)
    if not drive:
        raise APIError({"message": "Drive not found.", "code": "PGRST404"})

    by_num = {rd.get("round_number"): rd for rd in (dates.get("round_dates") or [])}
    rounds = []
    for r in sorted(tmpl.get("rounds_json") or [], key=lambda x: x.get("round_number", 0)):
        d = by_num.get(r.get("round_number"), {})
        rounds.append({
            "round_number": r["round_number"],
            "round_type": r["round_type"],
            "mode": r["mode"],
            "window_start": d.get("window_start"),
            "window_end": d.get("window_end"),
        })
    replace_drive_rounds(drive_id, rounds)

    drive_patch: dict = {}
    if dates.get("apply_deadline"):
        drive_patch["apply_deadline"] = dates["apply_deadline"]
    if dates.get("oa_window_start") is not None:
        drive_patch["oa_window_start"] = dates["oa_window_start"]
    if dates.get("oa_window_end") is not None:
        drive_patch["oa_window_end"] = dates["oa_window_end"]
    if drive.get("min_cgpa") is None and tmpl.get("default_min_cgpa") is not None:
        drive_patch["min_cgpa"] = tmpl["default_min_cgpa"]
    if not drive.get("eligible_branches") and tmpl.get("default_eligible_branches"):
        drive_patch["eligible_branches"] = tmpl["default_eligible_branches"]
    if drive_patch:
        return update_job_drive(drive_id, drive_patch)
    return drive


# ═════════════════════════════════════════════════════════════════════
# Per-round shortlist status. The ONLY non-'pending' writer is
# set_round_result_status (called by the manual company route).
# ═════════════════════════════════════════════════════════════════════


def get_or_create_round_result(application_id: str, round_id: str) -> Optional[Dict[str, Any]]:
    res = (
        db_client.table("application_round_results")
        .select("*")
        .eq("application_id", application_id)
        .eq("round_id", round_id)
        .limit(1)
        .execute()
    )
    if res.data:
        return res.data[0]
    created = (
        db_client.table("application_round_results")
        .upsert(
            {"application_id": application_id, "round_id": round_id, "status": "pending"},
            on_conflict="application_id,round_id",
        )
        .execute()
    )
    return created.data[0] if created.data else None


def set_round_result_status(
    application_id: str, round_id: str, status: str, decided_by: Optional[str]
) -> Optional[Dict[str, Any]]:
    """Manual shortlist/reject. Upserts the row so a decision can be made
    even if the pending row was never explicitly created."""
    payload = {
        "application_id": application_id,
        "round_id": round_id,
        "status": status,
        "decided_by": decided_by,
        "decided_at": _utcnow_iso(),
    }
    res = (
        db_client.table("application_round_results")
        .upsert(payload, on_conflict="application_id,round_id")
        .execute()
    )
    return res.data[0] if res.data else None


def set_round_result_score(application_id: str, round_id: str, score: Optional[float]) -> None:
    """Records an AI round's score WITHOUT touching status — status stays
    'pending' until a human decides. Safe for a scoring job to call."""
    db_client.table("application_round_results").upsert(
        {"application_id": application_id, "round_id": round_id, "round_score": score},
        on_conflict="application_id,round_id",
    ).execute()


def list_round_results_for_drive_round(round_id: str) -> list:
    res = (
        db_client.table("application_round_results")
        .select("*")
        .eq("round_id", round_id)
        .execute()
    )
    return res.data or []


def list_round_results_for_application(application_id: str) -> list:
    res = (
        db_client.table("application_round_results")
        .select("*")
        .eq("application_id", application_id)
        .execute()
    )
    return res.data or []


def list_round_results_for_applications(application_ids: list) -> Dict[str, list]:
    ids = [a for a in set(application_ids) if a]
    if not ids:
        return {}
    res = (
        db_client.table("application_round_results")
        .select("*")
        .in_("application_id", ids)
        .execute()
    )
    out: Dict[str, list] = {}
    for r in res.data or []:
        out.setdefault(r["application_id"], []).append(r)
    return out


# ═════════════════════════════════════════════════════════════════════
# Student job board — drive-aware. Replaces list_live_jobs_for_student.
# ═════════════════════════════════════════════════════════════════════


def list_live_drives_for_student(college_id: Optional[str], domain: Optional[str]) -> list:
    """Live drives at the student's college whose apply_deadline has not
    passed, joined to their job. Returns a list of {"job": ..., "drive": ...}.

    A student with no college_id sees nothing here — a drive is always
    college-scoped. Domain filtering is skipped when the student has no
    domain set (pre-domain accounts), same leniency as the old query.
    """
    if not college_id:
        return []
    drive_res = (
        db_client.table("job_drives")
        .select("*")
        .eq("college_id", college_id)
        .eq("status", "live")
        .gte("apply_deadline", _utcnow_iso())
        .execute()
    )
    drives = drive_res.data or []
    if not drives:
        return []

    job_ids = list({d["job_id"] for d in drives})
    jobs_res = (
        db_client.table("jobs")
        .select("*")
        .in_("id", job_ids)
        .eq("status", "live")
        .execute()
    )
    jobs = {j["id"]: j for j in (jobs_res.data or [])}

    out = []
    for d in drives:
        job = jobs.get(d["job_id"])
        if not job:
            continue
        if domain and job.get("domain") != domain:
            continue
        out.append({"job": job, "drive": d})
    out.sort(key=lambda x: x["drive"].get("apply_deadline") or "", reverse=False)
    return out


def compute_eligibility(drive: dict, profile: dict) -> Tuple[bool, Optional[str]]:
    """Pure check of a drive's three eligibility filters against a student
    profile. A null filter = no restriction on that axis; returns
    (True, None) when every set filter passes (or none are set)."""
    if not drive:
        return True, None

    min_cgpa = drive.get("min_cgpa")
    if min_cgpa is not None:
        cgpa = profile.get("cgpa")
        try:
            if cgpa is None or float(cgpa) < float(min_cgpa):
                return False, f"This drive requires CGPA ≥ {float(min_cgpa):g}."
        except (TypeError, ValueError):
            return False, f"This drive requires CGPA ≥ {float(min_cgpa):g}."

    branches = drive.get("eligible_branches")
    if branches:
        if not branch_matches(profile.get("branch"), branches):
            return False, f"Open to branches: {', '.join(branches)}."

    years = drive.get("eligible_batch_years")
    if years:
        grad = profile.get("graduation_year")
        if grad is None or int(grad) not in [int(y) for y in years]:
            return False, f"Open to graduating batches: {', '.join(str(y) for y in years)}."

    return True, None


def get_profile_eligibility_fields(student_id: str) -> Dict[str, Any]:
    res = (
        db_client.table("profiles")
        .select("id, cgpa, branch, graduation_year, preferred_locations, "
                "needs_sponsorship, sponsorship_country")
        .eq("id", student_id)
        .limit(1)
        .execute()
    )
    return (res.data[0] if res.data else {}) or {}


# ═════════════════════════════════════════════════════════════════════
# Company dashboard funnel — aggregate counts, one query set.
# ═════════════════════════════════════════════════════════════════════


def get_company_funnel_counts(company_id: str) -> Dict[str, int]:
    """New Applications = applications.status='applied'.
       Shortlisted     = applications with a 'shortlisted' round result.
       In Interview    = applications currently sitting at a live-mode round
                         (most recent shortlisted round is mode='live', or
                         applications.status='in_interview').
       Hired           = applications.status='hired'."""
    apps_res = (
        db_client.table("applications")
        .select("id, status")
        .eq("company_id", company_id)
        .execute()
    )
    apps = apps_res.data or []
    app_ids = [a["id"] for a in apps]

    new_applications = sum(1 for a in apps if a["status"] == "applied")
    hired = sum(1 for a in apps if a["status"] == "hired")

    shortlisted = 0
    in_interview = sum(1 for a in apps if a["status"] == "in_interview")
    if app_ids:
        rr_by_app = list_round_results_for_applications(app_ids)
        live_round_ids: set = set()
        rounds_cache: Dict[str, dict] = {}
        for aid, results in rr_by_app.items():
            if any(r["status"] == "shortlisted" for r in results):
                shortlisted += 1
            # highest-numbered shortlisted round for this app
            sl = [r for r in results if r["status"] == "shortlisted"]
            if not sl:
                continue
            round_ids = [r["round_id"] for r in sl]
            for rid in round_ids:
                if rid not in rounds_cache:
                    rounds_cache[rid] = get_drive_round(rid) or {}
            top = max(sl, key=lambda r: rounds_cache.get(r["round_id"], {}).get("round_number", 0))
            if rounds_cache.get(top["round_id"], {}).get("mode") == "live":
                live_round_ids.add(aid)
        # union with status-based in_interview, avoid double count
        in_interview = len(
            {a["id"] for a in apps if a["status"] == "in_interview"} | live_round_ids
        )

    return {
        "new_applications": new_applications,
        "shortlisted": shortlisted,
        "in_interview": in_interview,
        "hired": hired,
    }
