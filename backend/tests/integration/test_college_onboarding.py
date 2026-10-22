"""Integration: College onboarding persistence (GET/PUT /api/dashboard/onboarding).

The in-memory fakes do not evaluate RLS or database constraints, so what is proven here is the
application behaviour: validation, tenant scoping, idempotent saving, the save order (completion and
consent last), and the audit event. The CHECK constraint on college_platform_intent and the RLS
policies are in db/college_onboarding_migration.sql and are covered only by the SQL tests.
"""
import copy
import os
import re

import pytest

from app.routers.college import onboarding as ob

URL = "/api/dashboard/onboarding"

VALID = {
    "website": "https://alpha.edu",
    "city": "Pune",
    "state": "Maharashtra",
    "type": "Private University",
    "designation": "TPO",
    "phone": "+91 98765 43210",
    "studentStrength": "2,000-5,000",
    "departments": ["Computer Science", "Mechanical"],
    "intents": ["placement_mgmt", "jd_matching"],
    "tosAccepted": True,
    "dataConsentAccepted": True,
}


def payload(**over):
    p = copy.deepcopy(VALID)
    p.update(over)
    return p


@pytest.fixture
def h(env):
    env.college("col-1", "Alpha College")
    env.db.tables["colleges"][0]["plan"] = "standard"
    env.college("col-2", "Beta College")
    env.db.tables["colleges"][1]["plan"] = "pro"
    return env.user("tpo-1", "college", profile={"college_id": "col-1", "name": "Asha Rao"})


def college(env, cid="col-1"):
    return env.db.one("colleges", id=cid)


def events(env, kind):
    return [e for e in env.db.rows("admin_events") if e["event_type"] == kind]


# ── reading ─────────────────────────────────────────────────────────

def test_a_first_visit_shows_the_college_name_and_nothing_else(env, h):
    r = env.client.get(URL, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["college"]["name"] == "Alpha College" and body["college"]["onboardingCompleted"] is False
    assert body["college"]["city"] is None and body["contact"] is None
    assert (body["departments"], body["intents"], body["consent"]) == ([], [], None)
    assert body["consentVersions"] == {"tos": ob.TOS_VERSION, "dataConsent": ob.DATA_CONSENT_VERSION}


# ── saving ──────────────────────────────────────────────────────────

def test_saving_persists_every_part_and_a_later_visit_reads_it_back(env, h):
    r = env.client.put(URL, headers=h, json=payload())
    assert r.status_code == 200, r.text

    c = college(env)
    assert (c["website"], c["city"], c["state"], c["type"], c["is_custom_type"], c["student_strength"], c["onboarding_completed"]) == (
        "https://alpha.edu", "Pune", "Maharashtra", "Private University", False, "2,000-5,000", True)
    (contact,) = env.db.rows("college_contacts")
    assert (contact["college_id"], contact["email"], contact["full_name"], contact["designation"], contact["phone"],
            contact["is_custom_designation"], contact["is_primary_contact"]) == (
        "col-1", "tpo-1@test.dev", "Asha Rao", "TPO", "+91 98765 43210", False, True)
    assert sorted(i["intent"] for i in env.db.rows("college_platform_intent")) == ["jd_matching", "placement_mgmt"]
    assert sorted(d["name"] for d in env.db.rows("departments")) == ["Computer Science", "Mechanical"]
    (consent,) = env.db.rows("college_consents")
    assert (consent["college_id"], consent["tos_version"], consent["consent_version"]) == ("col-1", ob.TOS_VERSION, ob.DATA_CONSENT_VERSION)

    again = env.client.get(URL, headers=h).json()            # a refresh / a new session
    assert again == r.json()
    assert again["college"]["onboardingCompleted"] is True and again["departments"] == ["Computer Science", "Mechanical"]
    assert again["contact"] == {"designation": "TPO", "customDesignation": None, "phone": "+91 98765 43210"}
    assert again["intents"] == ["jd_matching", "placement_mgmt"] and again["consent"]["tosVersion"] == ob.TOS_VERSION


def test_other_type_and_other_designation_are_stored_as_text_with_the_custom_flag_and_read_back_as_other(env, h):
    env.client.put(URL, headers=h, json=payload(type="Other", customType="Autonomous College", designation="Other", customDesignation="Dean of Placements"))
    assert (college(env)["type"], college(env)["is_custom_type"]) == ("Autonomous College", True)
    assert (env.db.rows("college_contacts")[0]["designation"], env.db.rows("college_contacts")[0]["is_custom_designation"]) == ("Dean of Placements", True)
    got = env.client.get(URL, headers=h).json()
    assert (got["college"]["type"], got["college"]["customType"]) == ("Other", "Autonomous College")
    assert (got["contact"]["designation"], got["contact"]["customDesignation"]) == ("Other", "Dean of Placements")


def test_saving_twice_changes_nothing_but_what_was_edited_and_never_duplicates_or_removes_departments(env, h):
    env.client.put(URL, headers=h, json=payload())
    dept_ids = {d["name"]: d["id"] for d in env.db.rows("departments")}
    second = payload(city="Mumbai", phone="", departments=["Computer Science", "Civil"], intents=["readiness_tracking"])
    r = env.client.put(URL, headers=h, json=second)
    assert r.status_code == 200
    assert college(env)["city"] == "Mumbai"
    assert len(env.db.rows("college_contacts")) == 1 and env.db.rows("college_contacts")[0]["phone"] is None
    assert [i["intent"] for i in env.db.rows("college_platform_intent")] == ["readiness_tracking"]     # the choice was replaced
    names = sorted(d["name"] for d in env.db.rows("departments"))
    assert names == ["Civil", "Computer Science", "Mechanical"]                                       # added, never removed
    assert {d["name"]: d["id"] for d in env.db.rows("departments") if d["name"] in dept_ids} == dept_ids
    assert len(env.db.rows("college_consents")) == 1                                                  # one consent per version


def test_a_department_that_differs_only_in_case_is_not_added_twice(env, h):
    env.db.add("departments", id="d1", college_id="col-1", name="computer science")
    env.client.put(URL, headers=h, json=payload(departments=["Computer Science", "CIVIL", "civil"]))
    assert sorted(d["name"].lower() for d in env.db.rows("departments")) == ["civil", "computer science"]


def test_the_first_contact_is_primary_and_a_colleague_who_saves_later_is_not(env, h):
    env.client.put(URL, headers=h, json=payload())
    colleague = env.user("tpo-9", "college", profile={"college_id": "col-1", "name": "Ravi K"})
    env.client.put(URL, headers=colleague, json=payload(designation="Placement Coordinator"))
    rows = {c["email"]: c for c in env.db.rows("college_contacts")}
    assert rows["tpo-1@test.dev"]["is_primary_contact"] is True
    assert rows["tpo-9@test.dev"]["is_primary_contact"] is False and rows["tpo-9@test.dev"]["designation"] == "Placement Coordinator"
    assert env.client.get(URL, headers=colleague).json()["contact"]["designation"] == "Placement Coordinator"


def test_the_college_name_plan_and_any_client_supplied_college_cannot_be_changed(env, h):
    sneaky = payload(name="Hijacked", plan="enterprise", college_id="col-2", collegeId="col-2", logo_url="https://x/logo.png", onboarding_completed=False)
    assert env.client.put(URL, headers=h, json=sneaky).status_code == 200
    assert (college(env)["name"], college(env)["plan"], college(env).get("logo_url")) == ("Alpha College", "standard", None)
    other = college(env, "col-2")
    assert (other["name"], other["plan"], other.get("city"), other.get("onboarding_completed")) == ("Beta College", "pro", None, None)
    assert {c["college_id"] for c in env.db.rows("college_contacts")} == {"col-1"}


def test_two_colleges_never_see_or_change_each_others_onboarding(env, h):
    env.client.put(URL, headers=h, json=payload())
    b = env.user("tpo-b", "college", profile={"college_id": "col-2", "name": "Bela"})
    first_visit = env.client.get(URL, headers=b).json()
    assert first_visit["college"]["name"] == "Beta College" and first_visit["departments"] == [] and first_visit["consent"] is None
    env.client.put(URL, headers=b, json=payload(city="Delhi", departments=["Physics"], intents=["weakness_analysis"]))
    assert college(env, "col-1")["city"] == "Pune"
    assert sorted(d["name"] for d in env.db.rows("departments") if d["college_id"] == "col-1") == ["Computer Science", "Mechanical"]
    assert sorted(i["intent"] for i in env.db.rows("college_platform_intent") if i["college_id"] == "col-1") == ["jd_matching", "placement_mgmt"]
    assert sorted(c["college_id"] for c in env.db.rows("college_consents")) == ["col-1", "col-2"]


# ── validation ──────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [
    {"tosAccepted": False}, {"dataConsentAccepted": False}, {"tosAccepted": None},
    {"intents": []}, {"intents": ["placement_mgmt", "hack"]},
    {"departments": []}, {"departments": ["x"] * 0 + ["a" * 81]}, {"departments": [f"D{i}" for i in range(31)]}, {"departments": ["Bad\x00name"]},
    {"studentStrength": "a lot"}, {"city": ""}, {"city": "  "}, {"state": "x" * 81}, {"type": ""},
    {"type": "Other"}, {"type": "Other", "customType": "  "}, {"designation": "Other"},
    {"website": "alpha.edu"}, {"website": "javascript:alert(1)"}, {"website": "https://a b.edu"},
    {"phone": "call me maybe"}, {"phone": "1" * 21},
])
def test_invalid_submissions_are_refused_and_nothing_is_written(env, h, bad):
    r = env.client.put(URL, headers=h, json=payload(**bad))
    assert r.status_code == 422, (bad, r.text)
    assert env.db.rows("college_consents") == [] and env.db.rows("college_contacts") == []
    assert college(env).get("onboarding_completed") is None


def test_an_absent_consent_field_is_also_refused(env, h):
    p = payload()
    del p["dataConsentAccepted"]
    assert env.client.put(URL, headers=h, json=p).status_code == 422
    assert env.db.rows("college_consents") == []


def test_blank_website_and_phone_are_accepted_as_not_provided(env, h):
    assert env.client.put(URL, headers=h, json=payload(website="", phone="  ")).status_code == 200
    assert (college(env)["website"], env.db.rows("college_contacts")[0]["phone"]) == (None, None)


# ── failure handling ────────────────────────────────────────────────

@pytest.mark.parametrize("table,step", [
    ("college_contacts", "your contact details"), ("college_platform_intent", "your platform goals"),
    ("departments", "your departments"), ("college_consents", "your acceptance of the terms"),
])
def test_a_failed_step_never_marks_the_college_complete_and_never_records_consent_early(env, h, table, step):
    env.db.fail_tables["insert"] = {table}
    r = env.client.put(URL, headers=h, json=payload())
    assert r.status_code == 500 and step in r.json()["detail"] and "submit again" in r.json()["detail"]
    assert college(env).get("onboarding_completed") is None
    if table != "college_consents":
        assert env.db.rows("college_consents") == []          # consent is recorded only after everything before it saved
    assert events(env, "college_onboarding_saved") == []

    env.db.fail_tables.clear()
    assert env.client.put(URL, headers=h, json=payload()).status_code == 200        # simply submit again
    assert college(env)["onboarding_completed"] is True and len(env.db.rows("college_consents")) == 1
    assert len(env.db.rows("college_contacts")) == 1 and len(events(env, "college_onboarding_saved")) == 1


def test_a_failure_to_write_the_college_row_is_reported_and_leaves_it_incomplete(env, h):
    env.db.fail_tables["update"] = {"colleges"}
    r = env.client.put(URL, headers=h, json=payload())
    assert r.status_code == 500 and "your college details" in r.json()["detail"]
    assert env.db.rows("college_consents") == []


def test_reading_fails_cleanly_when_the_database_does(env, h):
    env.db.fail_tables["select"] = {"departments"}
    assert env.client.get(URL, headers=h).status_code == 500


def test_a_tpo_whose_college_row_is_missing_gets_404_and_nothing_is_written(env):
    ghost = env.user("tpo-g", "college", profile={"college_id": "no-such"})
    assert env.client.get(URL, headers=ghost).status_code == 404
    assert env.client.put(URL, headers=ghost, json=payload()).status_code == 404
    assert env.db.rows("college_contacts") == [] and env.db.rows("college_consents") == []


# ── audit ───────────────────────────────────────────────────────────

def test_saving_is_audited_with_counts_and_versions_but_without_contact_details(env, h):
    env.client.put(URL, headers=h, json=payload())
    (e,) = events(env, "college_onboarding_saved")
    assert (e["actor_role"], e["actor_user_id"], e["target_type"], e["target_id"], e["result"]) == ("college", "tpo-1", "college", "col-1", "success")
    assert e["metadata"] == {"completed": True, "departments_added": 2, "intents": 2,
                             "tos_version": ob.TOS_VERSION, "consent_version": ob.DATA_CONSENT_VERSION}
    dump = str(e)
    assert "98765" not in dump and "Asha" not in dump and "alpha.edu" not in dump


# ── who may call ────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ["candidate", "company", "admin"])
def test_other_roles_are_refused(env, role):
    other = env.user(f"u-{role}", role, profile={"is_super_admin": True} if role == "admin" else {})
    assert env.client.get(URL, headers=other).status_code == 403
    assert env.client.put(URL, headers=other, json=payload()).status_code == 403


def test_anonymous_and_unlinked_and_blocked_accounts_are_refused(env, h):
    assert env.client.get(URL).status_code == 401 and env.client.put(URL, json=payload()).status_code == 401
    unlinked = env.user("tpo-u", "college")
    assert env.client.put(URL, headers=unlinked, json=payload()).status_code == 403
    blocked = env.user("tpo-b2", "college", profile={"college_id": "col-1", "blocked_permanent": True})
    assert env.client.get(URL, headers=blocked).status_code == 403


# ── the page and the API agree ──────────────────────────────────────

PAGE = os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend", "src", "routes", "auth.college-onboarding.tsx")


@pytest.mark.skipif(not os.path.exists(PAGE), reason="frontend sources are not next to the backend in this checkout")
def test_the_option_lists_the_page_offers_are_exactly_the_ones_the_api_accepts():
    page = open(PAGE, encoding="utf-8").read()

    def literals(block_name):
        block = re.search(rf"const {block_name}[^=]*=\s*\[(.*?)\n\];", page, re.S).group(1)
        return re.findall(r'"([^"]+)"', block) if block_name != "PLATFORM_INTENTS" else re.findall(r'value:\s*"([^"]+)"', block)

    assert tuple(literals("STUDENT_STRENGTH_RANGES")) == ob.STUDENT_STRENGTHS
    assert tuple(literals("PLATFORM_INTENTS")) == ob.INTENTS
    assert "CYCLE_STATUSES" not in page          # no column stores it, so the page must not ask
