from datetime import date
from pydantic import BaseModel, Field, model_validator
from typing import Optional, List


# ── Allowed values ─────────────────────────────────────────────────────
VALID_INDUSTRIES: List[str] = [
    "Technology",
    "Finance & Banking",
    "Healthcare",
    "Education",
    "E-commerce & Retail",
    "Manufacturing",
    "Consulting",
    "Real Estate",
    "Media & Entertainment",
    "Logistics & Supply Chain",
    "Automotive",
    "Government & Public Sector",
    "Other",
]

VALID_SIZES: List[str] = ["1-10", "11-50", "51-200", "201-500", "500+"]


# ── Auth request payloads ──────────────────────────────────────────────
class AuthIn(BaseModel):
    email: str
    password: str
    role: str = "candidate"


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


class SessionOut(BaseModel):
    user: UserOut
    token: str
    expiresAt: str


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


# ── Company schemas ────────────────────────────────────────────────────

class CompanySignupIn(BaseModel):
    """
    Atomic company registration payload.
    Creates Supabase auth user + public.profiles row + public.companies row.
    """
    # HR account
    email: str
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=40)
    last_name: str = Field(min_length=1, max_length=40)
    # Company details
    company_name: str = Field(min_length=2, max_length=120)
    industry: str
    size: str
    hiring_domains: List[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_company_fields(self) -> "CompanySignupIn":
        if self.industry not in VALID_INDUSTRIES:
            raise ValueError(
                f"Invalid industry. Must be one of: {', '.join(VALID_INDUSTRIES)}"
            )
        if self.size not in VALID_SIZES:
            raise ValueError(
                f"Invalid company size. Must be one of: {', '.join(VALID_SIZES)}"
            )
        cleaned = [d.strip() for d in self.hiring_domains if d.strip()]
        if not cleaned:
            raise ValueError("At least one hiring domain is required.")
        if len(cleaned) > 20:
            raise ValueError("Maximum 20 hiring domains allowed.")
        self.hiring_domains = cleaned
        return self


class CompanyOut(BaseModel):
    id: str
    owner_id: str
    name: str
    industry: str
    size: str
    hiring_domains: List[str]
    website: Optional[str] = None
    logo_url: Optional[str] = None
    is_verified: bool
    created_at: str


class CompanySessionOut(SessionOut):
    """Session response that also carries the newly created company profile."""
    company: Optional[CompanyOut] = None


class CompanyUpdateIn(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    industry: Optional[str] = None
    size: Optional[str] = None
    hiring_domains: Optional[List[str]] = None
    website: Optional[str] = Field(None, max_length=255)
    logo_url: Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def validate_optional_fields(self) -> "CompanyUpdateIn":
        if self.industry is not None and self.industry not in VALID_INDUSTRIES:
            raise ValueError(f"Invalid industry.")
        if self.size is not None and self.size not in VALID_SIZES:
            raise ValueError(f"Invalid company size.")
        if self.hiring_domains is not None:
            cleaned = [d.strip() for d in self.hiring_domains if d.strip()]
            if not cleaned:
                raise ValueError("At least one hiring domain is required.")
            self.hiring_domains = cleaned
        return self


# ── Role (job posting) schemas ─────────────────────────────────────────

VALID_EXPERIENCE_LEVELS: List[str] = [
    "Entry-Level",
    "Mid-Level",
    "Senior",
    "Lead",
    "Executive",
]

VALID_ROLE_STATUSES: List[str] = ["draft", "published", "archived"]

VALID_ROLE_TYPES: List[str] = [
    "Full-time",
    "Part-time",
    "Internship",
    "Contract",
    "Freelance",
]


def _clean_string_list(values: List[str], *, field_label: str, max_items: int) -> List[str]:
    cleaned = [v.strip() for v in values if v.strip()]
    if len(cleaned) > max_items:
        raise ValueError(f"Maximum {max_items} {field_label} allowed.")
    return cleaned


class RoleCreateIn(BaseModel):
    title: str = Field(min_length=3, max_length=150)
    description: str = Field(min_length=20, max_length=5000)
    required_skills: List[str] = Field(default_factory=list)
    experience_level: str
    role_type: Optional[str] = None
    preferred_qualifications: List[str] = Field(default_factory=list)
    deadline: date
    minimum_employability_score: int = Field(default=0, ge=0, le=100)
    job_description_path: Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def validate_fields(self) -> "RoleCreateIn":
        if self.experience_level not in VALID_EXPERIENCE_LEVELS:
            raise ValueError(
                f"Invalid experience level. Must be one of: {', '.join(VALID_EXPERIENCE_LEVELS)}"
            )
        if self.role_type is not None and self.role_type not in VALID_ROLE_TYPES:
            raise ValueError(f"Invalid role type. Must be one of: {', '.join(VALID_ROLE_TYPES)}")
        cleaned = _clean_string_list(self.required_skills, field_label="required skills", max_items=30)
        if not cleaned:
            raise ValueError("At least one required skill is needed.")
        self.required_skills = cleaned
        self.preferred_qualifications = _clean_string_list(
            self.preferred_qualifications, field_label="preferred qualifications", max_items=30
        )
        if self.deadline < date.today():
            raise ValueError("Deadline must be today or a future date.")
        return self


class RoleUpdateIn(BaseModel):
    title: Optional[str] = Field(None, min_length=3, max_length=150)
    description: Optional[str] = Field(None, min_length=20, max_length=5000)
    required_skills: Optional[List[str]] = None
    experience_level: Optional[str] = None
    role_type: Optional[str] = None
    preferred_qualifications: Optional[List[str]] = None
    deadline: Optional[date] = None
    minimum_employability_score: Optional[int] = Field(None, ge=0, le=100)
    job_description_path: Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def validate_optional_fields(self) -> "RoleUpdateIn":
        if self.experience_level is not None and self.experience_level not in VALID_EXPERIENCE_LEVELS:
            raise ValueError(
                f"Invalid experience level. Must be one of: {', '.join(VALID_EXPERIENCE_LEVELS)}"
            )
        if self.role_type is not None and self.role_type not in VALID_ROLE_TYPES:
            raise ValueError(f"Invalid role type. Must be one of: {', '.join(VALID_ROLE_TYPES)}")
        if self.required_skills is not None:
            cleaned = _clean_string_list(self.required_skills, field_label="required skills", max_items=30)
            if not cleaned:
                raise ValueError("At least one required skill is needed.")
            self.required_skills = cleaned
        if self.preferred_qualifications is not None:
            self.preferred_qualifications = _clean_string_list(
                self.preferred_qualifications, field_label="preferred qualifications", max_items=30
            )
        return self


class RoleOut(BaseModel):
    id: str
    company_id: str
    title: str
    description: str
    required_skills: List[str]
    experience_level: str
    role_type: Optional[str] = None
    preferred_qualifications: List[str] = Field(default_factory=list)
    deadline: str
    minimum_employability_score: int
    status: str
    job_description_path: Optional[str] = None
    created_at: str
    updated_at: str


# ── Job description extraction schema ──────────────────────────────────


class JobDescriptionExtractionOut(BaseModel):
    """Response for POST /company/roles/extract-jd. Not a persisted role —
    the frontend uses this to pre-fill the role creation form."""

    storage_path: str
    title: str
    description: str
    required_skills: List[str]
    experience_level: str
    role_type: str
    preferred_qualifications: List[str]
    warnings: List[str] = Field(default_factory=list)
