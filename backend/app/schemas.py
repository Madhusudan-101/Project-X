from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, List, Union, Dict, Any
from datetime import date

from .utils.email_rules import is_valid_email_format


# ── Auth request payloads ──────────────────────────────────────────────
class AuthIn(BaseModel):
    email: str
    password: str
    role: str = "candidate"

    @field_validator("email")
    @classmethod
    def _validate_email_format(cls, v: str) -> str:
        if not is_valid_email_format(v):
            raise ValueError("Enter a valid email address.")
        return v


class SignupIn(AuthIn):
    """Accepts both camelCase and snake_case for firstName/lastName
    because the frontend sends snake_case on signup but camelCase elsewhere."""
    name: Optional[str] = None
    firstName: Optional[str] = Field(None, alias="firstName")
    lastName: Optional[str] = Field(None, alias="lastName")
    # Also accept snake_case from frontend auth.ts  (first_name / last_name)
    first_name: Optional[str] = None
    last_name: Optional[str] = None

    model_config = {"populate_by_name": True}

    @property
    def resolved_first_name(self) -> Optional[str]:
        return self.firstName or self.first_name

    @property
    def resolved_last_name(self) -> Optional[str]:
        return self.lastName or self.last_name


# ── User / Session response models ────────────────────────────────────
class UserOut(BaseModel):
    id: str
    email: str
    role: str = "candidate"
    name: Optional[str] = None
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    onboarded: bool = False
    # Candidate onboarding fields (unused for company/college accounts)
    skills: List[str] = Field(default_factory=list)
    interestedRoles: List[str] = Field(default_factory=list)
    collegeName: Optional[str] = None
    graduationYear: Optional[int] = None
    domain: Optional[str] = None
    collegeId: Optional[str] = None
    # Academic identity — `branch` gates drive eligibility (eligible_branches).
    degree: Optional[str] = None
    branch: Optional[str] = None
    # Stable candidate identity (job_drives_migration.sql, 1.6). `gender`
    # is aggregate-only and never shown to companies.
    cgpa: Optional[float] = None
    nationality: Optional[str] = None
    needsSponsorship: Optional[bool] = None
    sponsorshipCountry: Optional[str] = None
    gender: Optional[str] = None
    preferredLocations: List[str] = Field(default_factory=list)
    willingToRelocate: Optional[bool] = None


class SessionOut(BaseModel):
    user: UserOut
    token: str
    refreshToken: str = ""
    expiresAt: str


class RefreshIn(BaseModel):
    refreshToken: str


class OAuthSessionIn(BaseModel):
    """Sent after the frontend completes a Supabase OAuth (Google) redirect —
    accessToken/refreshToken/expiresAt are already-valid Supabase tokens from
    that client-side flow, not re-derived here."""
    accessToken: str
    refreshToken: str = ""
    expiresAt: str = ""
    role: str = "candidate"


class SetPasswordIn(BaseModel):
    """One-time password set for accounts created via Google OAuth, which
    never have a password at all — Google never shares it, by design."""
    password: str


# ── Misc payloads ─────────────────────────────────────────────────────
class ForgotIn(BaseModel):
    email: str


class VerifyOtpIn(BaseModel):
    email: str
    code: str


class ResetIn(BaseModel):
    token: str
    password: str


class ProfileUpdateIn(BaseModel):
    name: Optional[str] = None
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    onboarded: Optional[bool] = None
    skills: Optional[List[str]] = None
    interestedRoles: Optional[List[str]] = None
    collegeName: Optional[str] = None
    graduationYear: Optional[int] = None
    domain: Optional[str] = None
    # `branch` gates on-campus drive eligibility (job_drives.eligible_branches);
    # `degree` is informational.
    degree: Optional[str] = None
    branch: Optional[str] = None
    # ── Stable candidate identity (job_drives_migration.sql, 1.6) ──
    # `gender` is aggregate-only (College Portal diversity analytics) — it
    # is NEVER an eligibility filter and NEVER surfaced per-candidate to a
    # company. Free text, with a "prefer not to say" option in the UI.
    cgpa: Optional[float] = Field(default=None, ge=0, le=10)
    nationality: Optional[str] = None
    needsSponsorship: Optional[bool] = None
    sponsorshipCountry: Optional[str] = None
    gender: Optional[str] = None
    preferredLocations: Optional[List[str]] = None
    willingToRelocate: Optional[bool] = None


# ── College Portal payloads ───────────────────────────────────────────

class DriveEligibilityIn(BaseModel):
    branch: Optional[Union[str, List[str]]] = None
    graduationYear: Optional[int] = None
    minimumScore: Optional[float] = None


class DriveIn(BaseModel):
    companyName: str
    role: str
    eligibility: DriveEligibilityIn = Field(default_factory=DriveEligibilityIn)
    date: date
    status: str = "Active"


class ShortlistFilterIn(BaseModel):
    branch: Optional[str] = None
    graduationYear: Optional[int] = None
    minimumScore: Optional[float] = None
    verificationStatus: Optional[str] = None


class DepartmentIn(BaseModel):
    name: str
    code: Optional[str] = None
    hodName: Optional[str] = None


class DepartmentUpdateIn(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    hodName: Optional[str] = None


# ── Company Portal payloads ───────────────────────────────────────────

class CompanySignupIn(BaseModel):
    """Atomic HR account + company registration."""
    email: str
    password: str
    first_name: str
    last_name: str
    company_name: str
    industry: str
    size: str
    hiring_domains: List[str] = Field(default_factory=list)

    @field_validator("email")
    @classmethod
    def _validate_email_format(cls, v: str) -> str:
        if not is_valid_email_format(v):
            raise ValueError("Enter a valid email address.")
        return v


class CompanyOut(BaseModel):
    id: str
    owner_id: str
    name: str
    industry: str
    size: str
    hiring_domains: List[str] = Field(default_factory=list)
    website: Optional[str] = None
    logo_url: Optional[str] = None
    is_verified: bool = False
    created_at: str


class CompanyUpdateIn(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    size: Optional[str] = None
    hiring_domains: Optional[List[str]] = None
    website: Optional[str] = None
    logo_url: Optional[str] = None


# ── Job role payloads ──────────────────────────────────────────────────

VALID_ROLE_STATUSES = ("draft", "published", "archived")


class RoleCreateIn(BaseModel):
    title: str
    description: str
    required_skills: List[str] = Field(default_factory=list)
    experience_level: str
    deadline: date
    minimum_employability_score: int = 0


class RoleUpdateIn(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    required_skills: Optional[List[str]] = None
    experience_level: Optional[str] = None
    deadline: Optional[date] = None
    minimum_employability_score: Optional[int] = None


class RoleOut(BaseModel):
    id: str
    company_id: str
    title: str
    description: str
    required_skills: List[str] = Field(default_factory=list)
    experience_level: str
    deadline: str
    minimum_employability_score: int = 0
    status: str
    created_at: str
    updated_at: str


# ── Jobs / Job board / Applications / Job-scoped scoring ───────────────
#
# Distinct from the legacy `job_roles` feature above. See
# db/jobs_and_applications_migration.sql.

JOB_EXPERIENCE_LEVELS = ("fresher", "0-1", "1-3", "3-5", "5+")
JOB_STATUSES = ("draft", "live", "closed")
JOB_VISIBILITIES = ("all", "restricted")
JOB_EMPLOYMENT_TYPES = ("full-time", "intern", "contract")
JOB_INTERVIEW_DURATIONS = (30, 60, 90)
JOB_INTERVIEW_MODES = ("ai", "live", "both")
# Per-college job drives (job_drives_migration.sql).
DRIVE_STATUSES = ("draft", "live", "closed")
ROUND_TYPES = ("tech", "hr", "managerial", "other")
ROUND_MODES = ("ai", "live")
ROUND_RESULT_STATUSES = ("pending", "shortlisted", "rejected")
# Statuses a company may set manually from the ranked-candidates view.
COMPANY_SETTABLE_APPLICATION_STATUSES = (
    "applied", "shortlisted", "in_interview", "hired", "rejected",
)
SCORING_DIMENSIONS = ("resume", "github", "leetcode", "interview", "assessment")


class JobWeightsIn(BaseModel):
    """The five weight sliders. Must sum to exactly 100 — validated here
    AND re-checked against the DB CHECK constraint on job_weights."""
    resume_weight: int = Field(ge=0, le=100)
    github_weight: int = Field(ge=0, le=100)
    leetcode_weight: int = Field(ge=0, le=100)
    interview_weight: int = Field(ge=0, le=100)
    assessment_weight: int = Field(ge=0, le=100)

    @model_validator(mode="after")
    def _sum_to_100(self) -> "JobWeightsIn":
        total = (
            self.resume_weight + self.github_weight + self.leetcode_weight
            + self.interview_weight + self.assessment_weight
        )
        if total != 100:
            raise ValueError(f"Weights must sum to exactly 100 (got {total}).")
        return self


class JobWeightsOut(BaseModel):
    resume_weight: int
    github_weight: int
    leetcode_weight: int
    interview_weight: int
    assessment_weight: int


class JobCreateIn(BaseModel):
    title: str = Field(min_length=3, max_length=150)
    description: str = Field(min_length=20, max_length=8000)
    domain: str
    experience_level: str
    location: str = Field(min_length=1, max_length=120)
    openings_count: int = Field(ge=1, le=10000)
    deadline: date
    visibility: str = "all"
    # Skill names (resolved to skills.id in the router; a name not already in
    # the master table is added as a custom, non-predefined skill).
    skills: List[str] = Field(default_factory=list)
    # colleges.id values — required (non-empty) only when visibility='restricted'.
    visible_college_ids: List[str] = Field(default_factory=list)
    weights: JobWeightsIn
    # If true the job is created directly as 'live' (after full validation);
    # otherwise it starts as 'draft'.
    publish: bool = False

    # ── Eligibility & offer detail (jobs_eligibility_migration.sql) ──
    employment_type: str = "full-time"
    interview_duration_minutes: int = 30
    interview_mode: str = "ai"
    is_on_campus: bool = True
    # min_cgpa / eligible_branches / eligible_batch_years are really only
    # meaningful for a restricted (typically on-campus) posting — they are
    # NOT hard-blocked when set on an open job, just ignored by the student
    # board query. Left as free-form so a company can still record them.
    min_cgpa: Optional[float] = Field(default=None, ge=0, le=10)
    eligible_branches: Optional[List[str]] = None
    eligible_batch_years: Optional[List[int]] = None
    ctc_min: Optional[float] = None
    ctc_max: Optional[float] = None
    ctc_currency: Optional[str] = "INR"
    # ── Internship offer detail (only meaningful when employment_type=='intern') ──
    stipend_min: Optional[float] = None
    stipend_max: Optional[float] = None
    internship_duration_months: Optional[int] = Field(default=None, ge=1, le=24)
    ppo_ctc_min: Optional[float] = None
    ppo_ctc_max: Optional[float] = None
    # ── Perks / benefits (any job) — free-form list ──
    perks: Optional[List[str]] = None

    @field_validator("employment_type")
    @classmethod
    def _emp_type(cls, v: str) -> str:
        if v not in JOB_EMPLOYMENT_TYPES:
            raise ValueError(f"employment_type must be one of {JOB_EMPLOYMENT_TYPES}.")
        return v

    @field_validator("interview_duration_minutes")
    @classmethod
    def _int_dur(cls, v: int) -> int:
        if v not in JOB_INTERVIEW_DURATIONS:
            raise ValueError(f"interview_duration_minutes must be one of {JOB_INTERVIEW_DURATIONS}.")
        return v

    @field_validator("interview_mode")
    @classmethod
    def _int_mode(cls, v: str) -> str:
        if v not in JOB_INTERVIEW_MODES:
            raise ValueError(f"interview_mode must be one of {JOB_INTERVIEW_MODES}.")
        return v

    @field_validator("domain")
    @classmethod
    def _domain(cls, v: str) -> str:
        if v not in ("tech", "non-tech"):
            raise ValueError("domain must be 'tech' or 'non-tech'.")
        return v

    @field_validator("experience_level")
    @classmethod
    def _exp(cls, v: str) -> str:
        if v not in JOB_EXPERIENCE_LEVELS:
            raise ValueError(f"experience_level must be one of {JOB_EXPERIENCE_LEVELS}.")
        return v

    @field_validator("visibility")
    @classmethod
    def _vis(cls, v: str) -> str:
        if v not in JOB_VISIBILITIES:
            raise ValueError(f"visibility must be one of {JOB_VISIBILITIES}.")
        return v

    @model_validator(mode="after")
    def _restricted_needs_colleges(self) -> "JobCreateIn":
        if self.visibility == "restricted" and not self.visible_college_ids:
            raise ValueError("Restricted jobs must list at least one college.")
        if self.visibility == "all":
            self.visible_college_ids = []
        return self


class JobUpdateIn(BaseModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=150)
    description: Optional[str] = Field(default=None, min_length=20, max_length=8000)
    domain: Optional[str] = None
    experience_level: Optional[str] = None
    location: Optional[str] = Field(default=None, min_length=1, max_length=120)
    openings_count: Optional[int] = Field(default=None, ge=1, le=10000)
    deadline: Optional[date] = None
    visibility: Optional[str] = None
    skills: Optional[List[str]] = None
    visible_college_ids: Optional[List[str]] = None
    weights: Optional[JobWeightsIn] = None

    # ── Eligibility & offer detail (all optional on update) ──
    employment_type: Optional[str] = None
    interview_duration_minutes: Optional[int] = None
    interview_mode: Optional[str] = None
    is_on_campus: Optional[bool] = None
    min_cgpa: Optional[float] = Field(default=None, ge=0, le=10)
    eligible_branches: Optional[List[str]] = None
    eligible_batch_years: Optional[List[int]] = None
    ctc_min: Optional[float] = None
    ctc_max: Optional[float] = None
    ctc_currency: Optional[str] = None
    stipend_min: Optional[float] = None
    stipend_max: Optional[float] = None
    internship_duration_months: Optional[int] = Field(default=None, ge=1, le=24)
    ppo_ctc_min: Optional[float] = None
    ppo_ctc_max: Optional[float] = None
    perks: Optional[List[str]] = None

    @field_validator("employment_type")
    @classmethod
    def _emp_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in JOB_EMPLOYMENT_TYPES:
            raise ValueError(f"employment_type must be one of {JOB_EMPLOYMENT_TYPES}.")
        return v

    @field_validator("interview_duration_minutes")
    @classmethod
    def _int_dur(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v not in JOB_INTERVIEW_DURATIONS:
            raise ValueError(f"interview_duration_minutes must be one of {JOB_INTERVIEW_DURATIONS}.")
        return v

    @field_validator("interview_mode")
    @classmethod
    def _int_mode(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in JOB_INTERVIEW_MODES:
            raise ValueError(f"interview_mode must be one of {JOB_INTERVIEW_MODES}.")
        return v

    @field_validator("domain")
    @classmethod
    def _domain(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("tech", "non-tech"):
            raise ValueError("domain must be 'tech' or 'non-tech'.")
        return v

    @field_validator("experience_level")
    @classmethod
    def _exp(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in JOB_EXPERIENCE_LEVELS:
            raise ValueError(f"experience_level must be one of {JOB_EXPERIENCE_LEVELS}.")
        return v

    @field_validator("visibility")
    @classmethod
    def _vis(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in JOB_VISIBILITIES:
            raise ValueError(f"visibility must be one of {JOB_VISIBILITIES}.")
        return v


class JobOut(BaseModel):
    """Full job as the owning company sees it (includes weights)."""
    id: str
    company_id: str
    title: str
    description: str
    domain: str
    experience_level: str
    location: str
    openings_count: int
    deadline: str
    visibility: str
    status: str
    skills: List[str] = Field(default_factory=list)
    visible_college_ids: List[str] = Field(default_factory=list)
    weights: Optional[JobWeightsOut] = None
    application_count: int = 0
    # ── Eligibility & offer detail (jobs_eligibility_migration.sql) ──
    employment_type: str = "full-time"
    interview_duration_minutes: int = 30
    interview_mode: str = "ai"
    is_on_campus: bool = True
    min_cgpa: Optional[float] = None
    eligible_branches: List[str] = Field(default_factory=list)
    eligible_batch_years: List[int] = Field(default_factory=list)
    ctc_min: Optional[float] = None
    ctc_max: Optional[float] = None
    ctc_currency: Optional[str] = "INR"
    stipend_min: Optional[float] = None
    stipend_max: Optional[float] = None
    internship_duration_months: Optional[int] = None
    ppo_ctc_min: Optional[float] = None
    ppo_ctc_max: Optional[float] = None
    perks: List[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class JobBoardCardOut(BaseModel):
    """A job as it appears on the student job board (no weights).

    `deadline` is the student's own college drive's apply_deadline (falls
    back to jobs.deadline when there is somehow no drive). `eligible` is
    computed per student by crud.compute_eligibility against that drive.
    """
    id: str
    title: str
    company_name: str
    location: str
    domain: str
    experience_level: str
    deadline: str
    summary: str
    already_applied: bool = False
    # ── Offer detail + this student's drive (job_drives_migration.sql) ──
    employment_type: str = "full-time"
    ctc_min: Optional[float] = None
    ctc_max: Optional[float] = None
    ctc_currency: Optional[str] = "INR"
    is_on_campus: bool = True
    eligible: bool = True


class JobDriveRoundOut(BaseModel):
    id: str
    drive_id: str
    round_number: int
    round_type: str
    mode: str
    window_start: Optional[str] = None
    window_end: Optional[str] = None


class JobDetailOut(JobBoardCardOut):
    """Full JD detail page for a student (still no weights). Carries the
    student's own college's drive: apply deadline, OA window, full round
    list, and the eligibility verdict."""
    description: str
    required_skills: List[str] = Field(default_factory=list)
    openings_count: int
    application_status: Optional[str] = None
    interview_mode: str = "ai"
    # Internship offer detail + perks.
    stipend_min: Optional[float] = None
    stipend_max: Optional[float] = None
    internship_duration_months: Optional[int] = None
    ppo_ctc_min: Optional[float] = None
    ppo_ctc_max: Optional[float] = None
    perks: List[str] = Field(default_factory=list)
    # This student's college drive (None only if no drive exists yet).
    drive_id: Optional[str] = None
    apply_deadline: Optional[str] = None
    oa_window_start: Optional[str] = None
    oa_window_end: Optional[str] = None
    rounds: List[JobDriveRoundOut] = Field(default_factory=list)
    ineligible_reason: Optional[str] = None


class DraftJDIn(BaseModel):
    brief: str = Field(min_length=10, max_length=4000)
    title: Optional[str] = None
    domain: Optional[str] = None
    experience_level: Optional[str] = None
    location: Optional[str] = None
    skills: List[str] = Field(default_factory=list)


class DraftJDOut(BaseModel):
    description: str


class ApplicationRoundResultOut(BaseModel):
    """One application's status at one round of its drive."""
    id: str
    application_id: str
    round_id: str
    round_number: int
    round_type: str
    mode: str
    status: str
    round_score: Optional[float] = None
    decided_at: Optional[str] = None
    window_start: Optional[str] = None
    window_end: Optional[str] = None


class ApplicationOut(BaseModel):
    id: str
    student_id: str
    job_id: str
    company_id: str
    status: str
    applied_at: str
    updated_at: str
    # Denormalized display fields for the student's application tracker.
    job_title: Optional[str] = None
    company_name: Optional[str] = None
    placement_probability: Optional[float] = None
    # "Round X of Y" progress for the student's tracker. current_round is
    # the highest round they've been shortlisted into (1 = not yet through
    # round 1); total_rounds is the drive's round count.
    current_round: Optional[int] = None
    total_rounds: Optional[int] = None


class ApplicationDetailOut(ApplicationOut):
    """ApplicationOut plus the full per-round result list for this
    application, so the student can see which round they're on."""
    round_results: List[ApplicationRoundResultOut] = Field(default_factory=list)


class ApplicationStatusUpdateIn(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        if v not in COMPANY_SETTABLE_APPLICATION_STATUSES:
            raise ValueError(
                f"status must be one of {COMPANY_SETTABLE_APPLICATION_STATUSES}."
            )
        return v


class ApplicationAnalysisOut(BaseModel):
    id: str
    application_id: str
    student_id: str
    job_id: str
    company_id: str
    analysis_json: Dict[str, Any]
    placement_probability: float
    weighted_composite: float
    weights_snapshot: Dict[str, Any]
    generated_at: str


class RankedApplicantOut(BaseModel):
    """One row of the company's ranked-candidates table for a job."""
    application_id: str
    student_id: str
    student_name: Optional[str] = None
    student_email: Optional[str] = None
    status: str
    applied_at: str
    placement_probability: Optional[float] = None
    weighted_composite: Optional[float] = None
    has_analysis: bool = False


# ── Job drives — per (job, college) instances (job_drives_migration.sql) ──


class JobDriveRoundIn(BaseModel):
    round_number: int = Field(ge=1)
    round_type: str
    mode: str
    window_start: Optional[str] = None
    window_end: Optional[str] = None

    @field_validator("round_type")
    @classmethod
    def _rt(cls, v: str) -> str:
        if v not in ROUND_TYPES:
            raise ValueError(f"round_type must be one of {ROUND_TYPES}.")
        return v

    @field_validator("mode")
    @classmethod
    def _rm(cls, v: str) -> str:
        if v not in ROUND_MODES:
            raise ValueError(f"mode must be one of {ROUND_MODES}.")
        return v

    @model_validator(mode="after")
    def _window_order(self) -> "JobDriveRoundIn":
        if self.window_start and self.window_end and self.window_end <= self.window_start:
            raise ValueError("A round's window_end must be after its window_start.")
        return self


class JobDriveIn(BaseModel):
    """Create/replace a drive for one college under a job. Rounds are
    optional here — they can be added later or applied from a template."""
    college_id: str
    is_on_campus: bool = True
    apply_deadline: str
    oa_window_start: Optional[str] = None
    oa_window_end: Optional[str] = None
    min_cgpa: Optional[float] = Field(default=None, ge=0, le=10)
    eligible_branches: Optional[List[str]] = None
    eligible_batch_years: Optional[List[int]] = None
    rounds: List[JobDriveRoundIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate(self) -> "JobDriveIn":
        if self.oa_window_start and self.oa_window_end and self.oa_window_end <= self.oa_window_start:
            raise ValueError("oa_window_end must be after oa_window_start.")
        nums = sorted(r.round_number for r in self.rounds)
        if nums and nums != list(range(1, len(nums) + 1)):
            raise ValueError("Round numbers must be a gap-free 1..N sequence.")
        return self


class JobDriveUpdateIn(BaseModel):
    is_on_campus: Optional[bool] = None
    apply_deadline: Optional[str] = None
    oa_window_start: Optional[str] = None
    oa_window_end: Optional[str] = None
    min_cgpa: Optional[float] = Field(default=None, ge=0, le=10)
    eligible_branches: Optional[List[str]] = None
    eligible_batch_years: Optional[List[int]] = None


class JobDriveOut(BaseModel):
    id: str
    job_id: str
    college_id: str
    college_name: Optional[str] = None
    status: str
    is_on_campus: bool
    apply_deadline: str
    oa_window_start: Optional[str] = None
    oa_window_end: Optional[str] = None
    min_cgpa: Optional[float] = None
    eligible_branches: List[str] = Field(default_factory=list)
    eligible_batch_years: List[int] = Field(default_factory=list)
    rounds: List[JobDriveRoundOut] = Field(default_factory=list)
    applicant_count: int = 0
    created_at: str
    updated_at: str


class DriveCloneIn(BaseModel):
    target_college_id: str
    apply_deadline: str
    oa_window_start: Optional[str] = None
    oa_window_end: Optional[str] = None
    # One {window_start, window_end} per source round, in round order.
    round_dates: List[Dict[str, Optional[str]]] = Field(default_factory=list)


class RoundDatesIn(BaseModel):
    round_number: int
    window_start: Optional[str] = None
    window_end: Optional[str] = None


class ApplyTemplateIn(BaseModel):
    template_id: str
    apply_deadline: Optional[str] = None
    oa_window_start: Optional[str] = None
    oa_window_end: Optional[str] = None
    round_dates: List[RoundDatesIn] = Field(default_factory=list)


class DriveTemplateRoundIn(BaseModel):
    round_number: int = Field(ge=1)
    round_type: str
    mode: str

    @field_validator("round_type")
    @classmethod
    def _rt(cls, v: str) -> str:
        if v not in ROUND_TYPES:
            raise ValueError(f"round_type must be one of {ROUND_TYPES}.")
        return v

    @field_validator("mode")
    @classmethod
    def _rm(cls, v: str) -> str:
        if v not in ROUND_MODES:
            raise ValueError(f"mode must be one of {ROUND_MODES}.")
        return v


class DriveTemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    interview_mode: Optional[str] = None
    rounds_json: List[DriveTemplateRoundIn] = Field(default_factory=list)
    default_min_cgpa: Optional[float] = Field(default=None, ge=0, le=10)
    default_eligible_branches: Optional[List[str]] = None

    @field_validator("interview_mode")
    @classmethod
    def _im(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in JOB_INTERVIEW_MODES:
            raise ValueError(f"interview_mode must be one of {JOB_INTERVIEW_MODES}.")
        return v

    @model_validator(mode="after")
    def _seq(self) -> "DriveTemplateIn":
        nums = sorted(r.round_number for r in self.rounds_json)
        if nums and nums != list(range(1, len(nums) + 1)):
            raise ValueError("Template round numbers must be a gap-free 1..N sequence.")
        return self


class DriveTemplateOut(BaseModel):
    id: str
    company_id: str
    name: str
    interview_mode: Optional[str] = None
    rounds_json: List[Dict[str, Any]] = Field(default_factory=list)
    default_min_cgpa: Optional[float] = None
    default_eligible_branches: List[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class RoundStatusUpdateIn(BaseModel):
    """The manual shortlist/reject action — the ONLY thing that ever moves
    an application_round_results row off 'pending'."""
    status: str

    @field_validator("status")
    @classmethod
    def _s(cls, v: str) -> str:
        if v not in ("shortlisted", "rejected"):
            raise ValueError("status must be 'shortlisted' or 'rejected'.")
        return v


class RoundApplicantOut(BaseModel):
    """One row of a company's ranked list for a single round of a drive."""
    application_id: str
    student_id: str
    student_name: Optional[str] = None
    student_email: Optional[str] = None
    applied_at: str
    round_status: str            # pending | shortlisted | rejected
    round_score: Optional[float] = None
    # Job-scoped composite / placement probability for context.
    placement_probability: Optional[float] = None
    weighted_composite: Optional[float] = None
    has_analysis: bool = False
    decided_at: Optional[str] = None


class CompanyFunnelOut(BaseModel):
    """Aggregate counts for the company Dashboard funnel."""
    new_applications: int = 0
    shortlisted: int = 0
    in_interview: int = 0
    hired: int = 0
