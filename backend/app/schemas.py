from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Union
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


class SessionOut(BaseModel):
    user: UserOut
    token: str
    refreshToken: str = ""
    expiresAt: str


class RefreshIn(BaseModel):
    refreshToken: str


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
