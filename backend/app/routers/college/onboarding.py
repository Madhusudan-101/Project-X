"""College onboarding — GET / PUT /api/dashboard/onboarding

What a TPO tells the platform about their college the first time they sign in: institute details, their
own contact details, the departments, what they want to use the platform for, and the acceptance of the
Terms of Service and the data-handling acknowledgement.

Persistence uses the tables that db/college_onboarding_migration.sql already defines — nothing here
invents a column:

  colleges                 website, city, state, type + is_custom_type, student_strength, onboarding_completed
  college_contacts         one row for this TPO (designation, phone); the first one becomes the primary contact
  college_platform_intent  one row per chosen intent (a CHECK constraint fixes the allowed values)
  departments              the existing departments table; names are only ever ADDED, never removed or renamed
  college_consents         one row per accepted (TOS, data-consent) version pair

Safety properties:
  * The college is always the caller's own (deps.get_current_tpo) — never taken from the request.
  * The college NAME, its plan and every other column are not writable here. `colleges` has no UPDATE
    policy for College users (and must not get one), so the whitelisted columns are written with the
    service-role client, scoped by id; everything else goes through the caller's own RLS-bound client.
  * Saving is idempotent and ordered so that `onboarding_completed` is set LAST: if any step fails the
    college is not marked complete, nothing is recorded as consented unless everything before it saved,
    and submitting again simply finishes the job.
  * There is no logo upload: that needs a Storage bucket, which is shared infrastructure. `logo_url`
    stays untouched. The page's "placement cycle status" question is not stored anywhere either (no
    column exists for it), so the page no longer asks it.
  * The consent version strings below identify the exact wording the page shows. Change the wording ->
    bump the version, and the page asks again. The wording itself still needs the owner's/legal sign-off.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field, field_validator, model_validator
from supabase import Client

from ...crud import get_profile_by_id
from ...deps import db_client, get_current_tpo, get_user_supabase
from ...services.college.audit import log_college_action

log = logging.getLogger(__name__)
router = APIRouter(prefix="/onboarding", tags=["college-onboarding"])

TOS_VERSION = "tos-v1"
DATA_CONSENT_VERSION = "data-consent-v1"

# college_platform_intent.intent has a CHECK constraint with exactly these values.
INTENTS = ("placement_mgmt", "readiness_tracking", "jd_matching", "weakness_analysis")
STUDENT_STRENGTHS = ("Under 500", "500-2,000", "2,000-5,000", "5,000-10,000", "10,000+")
OTHER = "Other"
MAX_DEPARTMENTS = 30

_PHONE_RE = re.compile(r"^[0-9+()\-\s]{0,20}$")


def _clean(value: Optional[str]) -> str:
    return (value or "").strip()


class OnboardingIn(BaseModel):
    website: Optional[str] = Field(default=None, max_length=255)
    city: str = Field(min_length=1, max_length=80)
    state: str = Field(min_length=1, max_length=80)
    type: str = Field(min_length=1, max_length=80)
    customType: Optional[str] = Field(default=None, max_length=80)
    designation: str = Field(min_length=1, max_length=60)
    customDesignation: Optional[str] = Field(default=None, max_length=60)
    phone: Optional[str] = Field(default=None, max_length=20)
    studentStrength: str
    departments: List[str] = Field(min_length=1, max_length=MAX_DEPARTMENTS)
    intents: List[str] = Field(min_length=1)
    tosAccepted: Literal[True]
    dataConsentAccepted: Literal[True]

    @field_validator("website", "customType", "customDesignation", "phone", mode="before")
    @classmethod
    def _blank_is_none(cls, v):
        v = _clean(v) if isinstance(v, str) else v
        return v or None

    @field_validator("city", "state", "type", "designation", mode="before")
    @classmethod
    def _strip(cls, v):
        return _clean(v) if isinstance(v, str) else v

    @field_validator("website")
    @classmethod
    def _website(cls, v):
        if v and (not re.match(r"^https?://\S+$", v)):
            raise ValueError("website must start with http:// or https:// and contain no spaces")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        if v and not _PHONE_RE.match(v):
            raise ValueError("phone may contain only digits, spaces and + - ( )")
        return v

    @field_validator("studentStrength")
    @classmethod
    def _strength(cls, v):
        if v not in STUDENT_STRENGTHS:
            raise ValueError(f"studentStrength must be one of {list(STUDENT_STRENGTHS)}")
        return v

    @field_validator("intents")
    @classmethod
    def _intents(cls, v):
        bad = sorted(set(v) - set(INTENTS))
        if bad:
            raise ValueError(f"unknown intent(s) {bad}; allowed: {list(INTENTS)}")
        return list(dict.fromkeys(v))

    @field_validator("departments", mode="before")
    @classmethod
    def _departments(cls, v):
        if not isinstance(v, list):
            return v
        names: List[str] = []
        for item in v:
            name = _clean(item) if isinstance(item, str) else item
            if not isinstance(name, str) or not 1 <= len(name) <= 80 or "\x00" in name:
                raise ValueError("each department name must be 1-80 characters")
            if name.lower() not in {n.lower() for n in names}:
                names.append(name)
        return names

    @model_validator(mode="after")
    def _other_needs_text(self):
        if self.type == OTHER and not self.customType:
            raise ValueError("customType is required when type is 'Other'")
        if self.designation == OTHER and not self.customDesignation:
            raise ValueError("customDesignation is required when designation is 'Other'")
        return self


# ── reading ────────────────────────────────────────────────────────────

def _first(rows: Any) -> Optional[Dict[str, Any]]:
    return rows[0] if rows else None


def _read_state(sb: Client, tpo: dict) -> Dict[str, Any]:
    college_id = tpo["college_id"]
    try:
        college = _first(
            sb.table("colleges")
            .select("id, name, website, city, state, type, is_custom_type, student_strength, onboarding_completed")
            .eq("id", college_id).limit(1).execute().data
        )
        contacts = sb.table("college_contacts").select("*").eq("college_id", college_id).execute().data or []
        intents = sb.table("college_platform_intent").select("intent").eq("college_id", college_id).execute().data or []
        departments = sb.table("departments").select("name").eq("college_id", college_id).order("name").execute().data or []
        consent = _first(
            sb.table("college_consents").select("tos_version, consent_version, data_consent_accepted_at")
            .eq("college_id", college_id).eq("tos_version", TOS_VERSION).eq("consent_version", DATA_CONSENT_VERSION)
            .limit(1).execute().data
        )
    except APIError as e:
        log.error("Could not read onboarding state for college %s: %s", college_id, e)
        raise HTTPException(status_code=500, detail="Could not load your saved details.")
    if not college:
        raise HTTPException(status_code=404, detail="College not found.")

    mine = next((c for c in contacts if (c.get("email") or "").lower() == (tpo.get("email") or "").lower()), None)
    stored_type = college.get("type")
    custom_type = bool(college.get("is_custom_type"))
    designation = (mine or {}).get("designation")
    custom_designation = bool((mine or {}).get("is_custom_designation"))
    return {
        "college": {
            "name": college.get("name"),
            "website": college.get("website"),
            "city": college.get("city"),
            "state": college.get("state"),
            "type": OTHER if custom_type else stored_type,
            "customType": stored_type if custom_type else None,
            "studentStrength": college.get("student_strength"),
            "onboardingCompleted": bool(college.get("onboarding_completed")),
        },
        "contact": None if not mine else {
            "designation": OTHER if custom_designation else designation,
            "customDesignation": designation if custom_designation else None,
            "phone": mine.get("phone"),
        },
        "departments": [d["name"] for d in departments],
        "intents": sorted(i["intent"] for i in intents),
        "consent": None if not consent else {
            "tosVersion": consent["tos_version"], "consentVersion": consent["consent_version"],
            "acceptedAt": consent.get("data_consent_accepted_at"),
        },
        "consentVersions": {"tos": TOS_VERSION, "dataConsent": DATA_CONSENT_VERSION},
    }


@router.get("")
def get_onboarding(tpo: dict = Depends(get_current_tpo), sb: Client = Depends(get_user_supabase)):
    """The details saved so far (empty fields for a first visit), so a refresh or a return visit never loses them."""
    return _read_state(sb, tpo)


# ── saving ─────────────────────────────────────────────────────────────

def _contact_name(tpo: dict) -> str:
    profile = get_profile_by_id(tpo["id"]) or {}
    name = _clean(profile.get("name")) or _clean(f"{profile.get('first_name') or ''} {profile.get('last_name') or ''}")
    return name or (tpo.get("email") or "TPO").split("@")[0]


def _step(label: str, fn):
    try:
        return fn()
    except APIError as e:
        log.error("Onboarding step %r failed: %s", label, e)
        raise HTTPException(
            status_code=500,
            detail=f"Could not save {label}. Your workspace is not marked ready yet — nothing is lost, "
                   "submit again to finish.",
        )


@router.put("")
def save_onboarding(payload: OnboardingIn, tpo: dict = Depends(get_current_tpo), sb: Client = Depends(get_user_supabase)):
    college_id = tpo["college_id"]
    _read_state(sb, tpo)  # 404 when the college row is missing, before anything is written

    def save_contact():
        email = (tpo.get("email") or "").lower()
        rows = sb.table("college_contacts").select("id, email, is_primary_contact").eq("college_id", college_id).execute().data or []
        fields = {
            "designation": payload.customDesignation if payload.designation == OTHER else payload.designation,
            "is_custom_designation": payload.designation == OTHER,
            "phone": payload.phone,
        }
        mine = next((r for r in rows if (r.get("email") or "").lower() == email), None)
        if mine:
            sb.table("college_contacts").update(fields).eq("college_id", college_id).eq("id", mine["id"]).execute()
        else:
            sb.table("college_contacts").insert({
                "college_id": college_id, "full_name": _contact_name(tpo), "email": email, **fields,
                "is_primary_contact": not any(r.get("is_primary_contact") for r in rows),
            }).execute()

    def save_intents():
        have = {r["intent"] for r in sb.table("college_platform_intent").select("intent").eq("college_id", college_id).execute().data or []}
        want = set(payload.intents)
        if have - want:
            sb.table("college_platform_intent").delete().eq("college_id", college_id).in_("intent", sorted(have - want)).execute()
        if want - have:
            sb.table("college_platform_intent").insert([{"college_id": college_id, "intent": i} for i in sorted(want - have)]).execute()

    added_departments: List[str] = []

    def save_departments():
        have = {(r["name"] or "").lower() for r in sb.table("departments").select("name").eq("college_id", college_id).execute().data or []}
        added_departments.extend(n for n in payload.departments if n.lower() not in have)
        if added_departments:
            sb.table("departments").insert([{"college_id": college_id, "name": n} for n in added_departments]).execute()

    def save_college():
        # The caller has no UPDATE policy on `colleges` (by design); only these columns are ever written, for their own id.
        custom = payload.type == OTHER
        db_client.table("colleges").update({
            "website": payload.website, "city": payload.city, "state": payload.state,
            "type": payload.customType if custom else payload.type, "is_custom_type": custom,
            "student_strength": payload.studentStrength,
        }).eq("id", college_id).execute()

    def save_consent():
        found = sb.table("college_consents").select("id").eq("college_id", college_id) \
            .eq("tos_version", TOS_VERSION).eq("consent_version", DATA_CONSENT_VERSION).limit(1).execute().data
        if not found:
            sb.table("college_consents").insert({
                "college_id": college_id, "tos_version": TOS_VERSION, "consent_version": DATA_CONSENT_VERSION,
            }).execute()

    def mark_complete():
        db_client.table("colleges").update({"onboarding_completed": True}).eq("id", college_id).execute()

    _step("your contact details", save_contact)
    _step("your platform goals", save_intents)
    _step("your departments", save_departments)
    _step("your college details", save_college)
    _step("your acceptance of the terms", save_consent)   # only after everything above has saved
    _step("the final confirmation", mark_complete)

    log_college_action(
        "college_onboarding_saved", tpo, target_type="college", target_id=college_id,
        metadata={"completed": True, "departments_added": len(added_departments), "intents": len(payload.intents),
                  "tos_version": TOS_VERSION, "consent_version": DATA_CONSENT_VERSION},
    )
    return _read_state(sb, tpo)
