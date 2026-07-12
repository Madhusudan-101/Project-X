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
