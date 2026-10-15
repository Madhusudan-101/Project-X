"""Integration: signup -> verify -> login -> profile -> refresh -> reset -> block, against the real
FastAPI app with only Supabase replaced."""
import pytest

SIGNUP = dict(email="cand@test.dev", password="Passw0rd!x", role="candidate", name="Cara Cand",
              first_name="Cara", last_name="Cand")


def H(token): return {"Authorization": f"Bearer {token}"}


def test_root_and_docs_are_up(env):
    assert env.client.get("/").json() == {"ok": True, "msg": "Mirracle backend"}
    assert env.client.get("/openapi.json").status_code == 200


def test_signup_creates_profile_and_returns_session(env):
    r = env.client.post("/auth/signup", json=SIGNUP)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token"] and body["refreshToken"]
    assert body["user"]["email"] == "cand@test.dev" and body["user"]["role"] == "candidate"
    assert body["user"]["firstName"] == "Cara"
    prof = env.db.one("profiles", email="cand@test.dev")
    assert prof["role"] == "candidate" and prof["first_name"] == "Cara"


def test_signup_with_email_confirmation_returns_empty_token(env):
    env.auth.confirm_email = True
    r = env.client.post("/auth/signup", json=SIGNUP)
    assert r.status_code == 200
    assert r.json()["token"] == ""


@pytest.mark.parametrize("role", ["admin", "college", "superuser", ""])
def test_public_signup_cannot_mint_privileged_roles(env, role):
    r = env.client.post("/auth/signup", json={**SIGNUP, "role": role})
    assert r.status_code == 403
    assert env.db.rows("profiles") == []
    assert env.auth.users == {}


def test_signup_rejects_bad_email_and_weak_password(env):
    assert env.client.post("/auth/signup", json={**SIGNUP, "email": "nope"}).status_code == 422
    r = env.client.post("/auth/signup", json={**SIGNUP, "password": "123"})
    assert r.status_code == 400 and "6 characters" in r.json()["detail"]


def test_duplicate_email_and_cross_role_conflict(env):
    assert env.client.post("/auth/signup", json=SIGNUP).status_code == 200
    # same email, other role -> explicit 409 from the app
    r = env.client.post("/auth/signup", json={**SIGNUP, "role": "company"})
    assert r.status_code == 409 and "candidate" in r.json()["detail"]
    # same email, same role -> upstream "already registered"
    r = env.client.post("/auth/signup", json=SIGNUP)
    assert r.status_code == 400


def test_login_success_and_wrong_password(env):
    env.client.post("/auth/signup", json=SIGNUP)
    ok = env.client.post("/auth/login", json={"email": "cand@test.dev", "password": "Passw0rd!x", "role": "candidate"})
    assert ok.status_code == 200 and ok.json()["token"]
    bad = env.client.post("/auth/login", json={"email": "cand@test.dev", "password": "wrong", "role": "candidate"})
    assert bad.status_code == 400 and "Invalid login credentials" in bad.json()["detail"]


def test_login_wrong_portal_is_refused(env):
    env.client.post("/auth/signup", json=SIGNUP)
    r = env.client.post("/auth/login", json={"email": "cand@test.dev", "password": "Passw0rd!x", "role": "company"})
    assert r.status_code == 403 and "candidate" in r.json()["detail"]


def test_login_cannot_self_heal_a_privileged_profile(env):
    env.auth.add_user("ghost", "ghost@test.dev")          # auth user with NO profile row
    r = env.client.post("/auth/login", json={"email": "ghost@test.dev", "password": "Passw0rd!x", "role": "admin"})
    assert r.status_code == 403
    assert env.db.rows("profiles", id="ghost") == []


def test_login_self_heals_missing_candidate_profile(env):
    env.auth.add_user("legacy", "legacy@test.dev")
    r = env.client.post("/auth/login", json={"email": "legacy@test.dev", "password": "Passw0rd!x", "role": "candidate"})
    assert r.status_code == 200
    assert env.db.one("profiles", id="legacy")["role"] == "candidate"


def test_login_records_audit_event(env):
    env.client.post("/auth/signup", json=SIGNUP)
    env.client.post("/auth/login", json={"email": "cand@test.dev", "password": "Passw0rd!x", "role": "candidate"})
    ev = env.db.rows("admin_events", event_type="user_login")
    assert len(ev) == 1 and ev[0]["result"] == "success"


def test_blocked_user_cannot_login_refresh_or_call_api(env):
    h = env.user("blk", "candidate", profile={"blocked_permanent": True, "blocked_reason": "abuse"})
    r = env.client.post("/auth/login", json={"email": "blk@test.dev", "password": "Passw0rd!x", "role": "candidate"})
    assert r.status_code == 403 and "suspended" in r.json()["detail"] and "abuse" in r.json()["detail"]
    assert env.db.rows("admin_events", result="failure")
    assert env.client.get("/auth/profile", headers=h).status_code == 403
    rt = next(k for k, v in env.auth.refresh.items() if v == "blk")
    assert env.client.post("/auth/refresh", json={"refreshToken": rt}).status_code == 403


def test_expired_temporary_block_lets_the_user_back_in(env):
    env.user("tmp", "candidate", profile={"blocked_until": "2000-01-01T00:00:00+00:00"})
    r = env.client.post("/auth/login", json={"email": "tmp@test.dev", "password": "Passw0rd!x", "role": "candidate"})
    assert r.status_code == 200


def test_otp_verify_logs_user_in_and_bad_code_fails(env):
    env.auth.confirm_email = True
    env.client.post("/auth/signup", json=SIGNUP)
    assert env.client.post("/auth/login", json={"email": "cand@test.dev", "password": "Passw0rd!x", "role": "candidate"}).status_code == 400
    assert env.client.post("/auth/otp/verify", json={"email": "cand@test.dev", "code": "000000"}).status_code == 400
    r = env.client.post("/auth/otp/verify", json={"email": "cand@test.dev", "code": "123456"})
    assert r.status_code == 200 and r.json()["token"]
    assert env.client.post("/auth/otp/resend", json={"email": "cand@test.dev"}).json() == {"ok": True}


def test_refresh_rotates_tokens_and_refuses_reuse(env):
    env.client.post("/auth/signup", json=SIGNUP)
    login = env.client.post("/auth/login", json={"email": "cand@test.dev", "password": "Passw0rd!x", "role": "candidate"}).json()
    r1 = env.client.post("/auth/refresh", json={"refreshToken": login["refreshToken"]})
    assert r1.status_code == 200 and r1.json()["token"] != login["token"]
    # single-use: replaying the old refresh token is a 401
    assert env.client.post("/auth/refresh", json={"refreshToken": login["refreshToken"]}).status_code == 401
    # new access token works
    assert env.client.get("/auth/profile", headers=H(r1.json()["token"])).status_code == 200


def test_protected_endpoints_reject_missing_and_malformed_auth(env):
    assert env.client.get("/auth/profile").status_code == 401
    assert env.client.get("/auth/profile", headers={"Authorization": "Token abc"}).status_code == 401
    assert env.client.get("/auth/profile", headers=H("garbage")).status_code == 401
    assert env.client.get("/company/me", headers={"Authorization": "Bearer"}).status_code == 401


def test_profile_get_and_patch_roundtrip(env):
    token = env.client.post("/auth/signup", json=SIGNUP).json()["token"]
    r = env.client.patch("/auth/profile", headers=H(token), json={
        "skills": ["Python", "SQL"], "interestedRoles": ["Backend Engineer"], "domain": "tech",
        "graduationYear": 2027, "cgpa": 8.7, "branch": "CSE", "onboarded": True,
        "preferredLocations": ["Pune"], "willingToRelocate": True,
    })
    assert r.status_code == 200, r.text
    got = env.client.get("/auth/profile", headers=H(token)).json()
    assert got["skills"] == ["Python", "SQL"] and got["cgpa"] == 8.7 and got["onboarded"] is True
    assert got["domain"] == "tech" and got["branch"] == "CSE" and got["preferredLocations"] == ["Pune"]


def test_profile_patch_validation(env):
    token = env.client.post("/auth/signup", json=SIGNUP).json()["token"]
    for bad in ({"cgpa": 11}, {"cgpa": -1}, {"graduationYear": 1066}, {"graduationYear": 3000}):
        assert env.client.patch("/auth/profile", headers=H(token), json=bad).status_code == 422, bad
    assert env.client.patch("/auth/profile", headers=H(token), json={"domain": "other"}).status_code == 422


def test_profile_college_name_resolves_or_creates_college_once(env):
    token = env.client.post("/auth/signup", json=SIGNUP).json()["token"]
    for _ in range(2):
        env.client.patch("/auth/profile", headers=H(token), json={"collegeName": "  IIT Pune "})
    cols = env.db.rows("colleges")
    assert len(cols) == 1 and cols[0]["name"] == "IIT Pune"
    assert env.db.one("profiles", email="cand@test.dev")["college_id"] == cols[0]["id"]


def test_college_name_wildcards_do_not_match_other_colleges(env):
    env.college("c1", "Alpha College")
    token = env.client.post("/auth/signup", json=SIGNUP).json()["token"]
    env.client.patch("/auth/profile", headers=H(token), json={"collegeName": "%"})
    assert env.db.one("profiles", email="cand@test.dev")["college_id"] != "c1"


def test_forgot_and_reset_password_flow(env):
    env.client.post("/auth/signup", json=SIGNUP)
    assert env.client.post("/auth/forgot", json={"email": "cand@test.dev"}).json() == {"ok": True}
    assert env.auth.sent_recovery == ["cand@test.dev"]
    recovery_token = env.auth.issue("u-1")
    assert env.client.post("/auth/reset", json={"token": "forged.jwt.value", "password": "NewPassw0rd!"}).status_code == 400
    assert env.client.post("/auth/reset", json={"token": recovery_token, "password": "NewPassw0rd!"}).json() == {"ok": True}
    ok = env.client.post("/auth/login", json={"email": "cand@test.dev", "password": "NewPassw0rd!", "role": "candidate"})
    assert ok.status_code == 200
    assert env.client.post("/auth/login", json={"email": "cand@test.dev", "password": "Passw0rd!x", "role": "candidate"}).status_code == 400


def test_set_password_requires_auth_and_strength(env):
    token = env.client.post("/auth/signup", json=SIGNUP).json()["token"]
    assert env.client.post("/auth/set-password", json={"password": "Longenough1!"}).status_code == 401
    assert env.client.post("/auth/set-password", headers=H(token), json={"password": "abc"}).status_code == 400
    assert env.client.post("/auth/set-password", headers=H(token), json={"password": "Longenough1!"}).json() == {"ok": True}


def test_oauth_session_creates_profile_and_enforces_role_rules(env):
    tok = env.auth.add_user("g-1", "g@test.dev", meta={"full_name": "Gina Google"})
    r = env.client.post("/auth/oauth-session", json={"accessToken": tok, "refreshToken": "r", "expiresAt": "1", "role": "candidate"})
    assert r.status_code == 200 and r.json()["user"]["firstName"] == "Gina" and r.json()["user"]["lastName"] == "Google"
    # same Google account may not hop into the company portal
    r = env.client.post("/auth/oauth-session", json={"accessToken": tok, "role": "company"})
    assert r.status_code == 409
    # forged / unknown token
    assert env.client.post("/auth/oauth-session", json={"accessToken": "nope", "role": "candidate"}).status_code == 401
    # admin via oauth is refused
    tok2 = env.auth.add_user("g-2", "g2@test.dev")
    assert env.client.post("/auth/oauth-session", json={"accessToken": tok2, "role": "admin"}).status_code in (403, 409)
    assert env.db.rows("profiles", id="g-2") == []


def test_company_signup_creates_profile_and_company_atomically(env):
    r = env.client.post("/auth/company-signup", json={
        "email": "hr@acme.dev", "password": "Passw0rd!x", "first_name": "Hana", "last_name": "Roe",
        "company_name": "Acme", "industry": "Software", "size": "11-50", "hiring_domains": ["tech"],
    })
    assert r.status_code == 200, r.text
    assert r.json()["company"]["name"] == "Acme"
    assert env.db.one("profiles", email="hr@acme.dev")["role"] == "company"
    me = env.client.get("/company/me", headers=H(r.json()["token"]))
    assert me.status_code == 200 and me.json()["name"] == "Acme" and me.json()["is_verified"] is False


def test_company_signup_failure_to_create_company_is_reported(env):
    env.db.fail_tables["insert"] = {"companies"}
    r = env.client.post("/auth/company-signup", json={
        "email": "hr@acme.dev", "password": "Passw0rd!x", "first_name": "H", "last_name": "R",
        "company_name": "Acme", "industry": "Software", "size": "11-50",
    })
    assert r.status_code == 502


def test_role_isolation_between_portals(env):
    cand = env.user("c1", "candidate")
    comp, _ = env.company_user()
    tpo = env.user("t1", "college", profile={"college_id": "col-1"})
    adm = env.user("a1", "admin")
    assert env.client.get("/company/jobs", headers=cand).status_code == 403
    assert env.client.get("/candidate/jobs", headers=comp).status_code == 403
    assert env.client.get("/api/students/", headers=cand).status_code == 403
    assert env.client.get("/admin/overview", headers=tpo).status_code == 403
    assert env.client.get("/admin/overview", headers=cand).status_code == 403
    assert env.client.get("/company/jobs", headers=adm).status_code == 403


def test_token_metadata_cannot_grant_a_role(env):
    # user_metadata is user-editable; authorisation must come from the profiles row.
    h = env.user("sneaky", "candidate", meta={"role": "admin"})
    env.auth.users["sneaky"]["user_metadata"]["role"] = "admin"
    assert env.client.get("/admin/overview", headers=h).status_code == 403
    assert env.client.get("/company/me", headers=h).status_code == 403
