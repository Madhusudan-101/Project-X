from pydantic import BaseModel, Field
from typing import Optional, List, Union
from datetime import date


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
