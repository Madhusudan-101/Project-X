"""Integration: TPO roster management, CSV upload/export, shortlist, drives, departments, dashboard, tenant isolation."""
import io

import pytest
from postgrest.exceptions import APIError

CSV_HEAD = "name,email,branch,graduationYear,employabilityScore,verificationStatus,placementStatus\n"


@pytest.fixture
def tpo(env):
    env.college("col-1", "Alpha College")
    env.college("col-2", "Beta College")
    return env.user("tpo-1", "college", profile={"college_id": "col-1"})


@pytest.fixture
def tpo2(env):
    return env.user("tpo-2", "college", profile={"college_id": "col-2"})


def upload(env, h, text, name="roster.csv"):
    return env.client.post("/api/students/upload", headers=h, files={"file": (name, io.BytesIO(text.encode()), "text/csv")})


def test_tpo_without_college_link_is_refused(env):
    h = env.user("tpo-x", "college")
    assert env.client.get("/api/students/", headers=h).status_code == 403


def test_student_crud_roundtrip(env, tpo):
    r = env.client.post("/api/students/", headers=tpo, json={"name": "Asha", "email": "ASHA@X.COM", "branch": "CSE", "graduationYear": 2027})
    assert r.status_code == 201 and r.json()["student"]["email"] == "asha@x.com"
    sid = r.json()["student"]["id"]
    assert env.client.post("/api/students/", headers=tpo, json={"name": "Asha2", "email": "asha@x.com", "branch": "CSE", "graduationYear": 2027}).status_code == 409
    assert env.client.get(f"/api/students/{sid}", headers=tpo).json()["name"] == "Asha"
    u = env.client.put(f"/api/students/{sid}", headers=tpo, json={"placementStatus": "placed", "name": "Asha K"})
    assert u.json()["student"]["placement_status"] == "placed" and u.json()["student"]["name"] == "Asha K"
    assert env.client.put(f"/api/students/{sid}", headers=tpo, json={"placementStatus": "hired"}).status_code == 422
    assert env.client.put(f"/api/students/{sid}", headers=tpo, json={"graduationYear": 1800}).status_code == 422
    assert env.client.delete(f"/api/students/{sid}", headers=tpo).status_code == 200
    assert env.client.get(f"/api/students/{sid}", headers=tpo).status_code == 404
    assert env.client.delete(f"/api/students/{sid}", headers=tpo).status_code == 404


def test_student_validation(env, tpo):
    bad = [{"name": "A", "email": "no", "branch": "CSE", "graduationYear": 2027},
           {"name": "A", "email": "a@x.com", "branch": "CSE", "graduationYear": 1900},
           {"name": "A", "email": "a@x.com", "branch": "CSE"}]
    for b in bad:
        assert env.client.post("/api/students/", headers=tpo, json=b).status_code == 422, b


def test_cross_college_isolation_for_every_student_route(env, tpo, tpo2):
    sid = env.client.post("/api/students/", headers=tpo, json={"name": "Asha", "email": "a@x.com", "branch": "CSE", "graduationYear": 2027}).json()["student"]["id"]
    assert env.client.get("/api/students/", headers=tpo2).json() == []
    assert env.client.get(f"/api/students/{sid}", headers=tpo2).status_code == 404
    assert env.client.put(f"/api/students/{sid}", headers=tpo2, json={"name": "Hacked"}).status_code == 404
    assert env.client.delete(f"/api/students/{sid}", headers=tpo2).status_code == 404
    r = env.client.put("/api/students/bulk-placement-status", headers=tpo2, json={"studentIds": [sid], "placementStatus": "placed"})
    assert r.json()["updatedCount"] == 0
    assert env.db.one("students", id=sid)["name"] == "Asha"
    assert env.db.one("students", id=sid)["placement_status"] == "not_placed"


def test_csv_upload_upsert_dedupe_and_defaults(env, tpo):
    r = upload(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,70,verified,placed\nBob,bob@x.com,IT,2026,50,,\nAnn,ANN@x.com,CSE,2026,,,\n")
    assert r.status_code == 201, r.text
    assert r.json()["addedStudents"] == 2                     # the agreeing repeat of Ann is counted once
    ann = env.db.one("students", email="ann@x.com")
    assert ann["employability_score"] == 70 and ann["placement_status"] == "placed" and ann["college_id"] == "col-1"
    # re-upload updates instead of duplicating
    upload(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,10,,\n")
    assert len(env.db.rows("students")) == 2 and env.db.one("students", email="ann@x.com")["employability_score"] == 10


def seed_placed_student(env, tpo):
    """A student the TPO has already worked on: verified, scored, placed."""
    upload(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,80,verified,placed\n")
    ann = env.db.one("students", email="ann@x.com")
    env.db.tables["students"][0].update(github_score=55, resume_score=65)
    return ann["id"]


def test_reupload_without_optional_columns_never_resets_existing_students(env, tpo):
    sid = seed_placed_student(env, tpo)
    r = upload(env, tpo, "name,email,branch,graduationYear\nAnn K,ann@x.com,CSE,2026\nNew,new@x.com,IT,2027\n")
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["created"], body["updated"], body["unchanged"], body["addedStudents"]) == (1, 1, 0, 2)
    ann = env.db.one("students", id=sid)
    assert ann["name"] == "Ann K"                                   # supplied -> updated
    assert ann["placement_status"] == "placed"                      # not supplied -> untouched
    assert ann["verification_status"] == "verified"
    assert (ann["employability_score"], ann["github_score"], ann["resume_score"]) == (80, 55, 65)
    new = env.db.one("students", email="new@x.com")
    assert new["placement_status"] == "not_placed" and new["verification_status"] == "pending"


def test_reupload_blank_cells_leave_fields_alone_and_filled_cells_update(env, tpo):
    sid = seed_placed_student(env, tpo)
    upload(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,,,offer_declined\n")
    ann = env.db.one("students", id=sid)
    assert ann["placement_status"] == "offer_declined"              # filled cell -> updated
    assert ann["employability_score"] == 80 and ann["verification_status"] == "verified"  # blank -> kept


def test_reupload_of_identical_file_is_reported_unchanged_and_writes_nothing(env, tpo):
    text = CSV_HEAD + "Ann,ann@x.com,CSE,2026,80,verified,placed\nBob,bob@x.com,IT,2026,50,pending,not_placed\n"
    upload(env, tpo, text)
    before = len([e for e in env.db.log if e == ("upsert", "students")])
    r = upload(env, tpo, text)
    body = r.json()
    assert (body["created"], body["updated"], body["unchanged"], body["addedStudents"]) == (0, 0, 2, 0)
    assert len([e for e in env.db.log if e == ("upsert", "students")]) == before


def test_upload_reports_unusable_values_instead_of_silently_defaulting(env, tpo):
    sid = seed_placed_student(env, tpo)
    r = upload(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,great,hired,maybe\n")
    assert r.status_code == 201
    assert [(w["line"], w["column"]) for w in r.json()["warnings"]] == [
        (2, "employabilityScore"), (2, "verificationStatus"), (2, "placementStatus")]
    ann = env.db.one("students", id=sid)
    assert (ann["employability_score"], ann["verification_status"], ann["placement_status"]) == (80, "verified", "placed")


def test_rows_with_different_columns_are_written_in_separate_groups(env, tpo):
    before = len([e for e in env.db.log if e == ("upsert", "students")])
    upload(env, tpo, CSV_HEAD + "A,a@x.com,CSE,2026,70,,\nB,b@x.com,CSE,2026,,,\n")
    # one group has employability_score, the other does not: a bulk write mixing them would NULL the column
    assert len([e for e in env.db.log if e == ("upsert", "students")]) - before == 2
    assert env.db.one("students", email="b@x.com")["employability_score"] == 0


def test_same_email_in_another_college_is_a_separate_student(env, tpo, tpo2):
    sid = seed_placed_student(env, tpo)
    upload(env, tpo2, "name,email,branch,graduationYear\nAnn,ann@x.com,CSE,2026\n")
    assert env.db.one("students", id=sid)["placement_status"] == "placed"
    assert len(env.db.rows("students")) == 2


def upload_dry(env, h, text, name="roster.csv"):
    return env.client.post("/api/students/upload?dryRun=true", headers=h,
                           files={"file": (name, io.BytesIO(text.encode()), "text/csv")})


def snapshot(env):
    return [dict(r) for r in env.db.rows("students")]


def test_dry_run_counts_match_the_real_import_and_write_nothing(env, tpo):
    seed_placed_student(env, tpo)
    upload(env, tpo, CSV_HEAD + "Bob,bob@x.com,IT,2026,50,pending,not_placed\n")
    text = CSV_HEAD + "Ann,ann@x.com,CSE,2026,80,verified,placed\nBob,bob@x.com,IT,2026,60,,\nCy,cy@x.com,ECE,2027,,,\n"

    before, writes_before = snapshot(env), [e for e in env.db.log if e[0] in ("insert", "upsert", "update", "delete")]
    dry = upload_dry(env, tpo, text)
    assert dry.status_code == 200, dry.text                          # nothing was created -> not 201
    d = dry.json()
    assert d["dryRun"] is True and d["students"] == []
    assert (d["created"], d["updated"], d["unchanged"], d["addedStudents"]) == (1, 1, 1, 2)
    assert snapshot(env) == before                                   # the roster is byte-for-byte unchanged
    assert [e for e in env.db.log if e[0] in ("insert", "upsert", "update", "delete")] == writes_before  # no write was even attempted

    real = upload(env, tpo, text)
    assert real.status_code == 201
    r = real.json()
    assert r["dryRun"] is False
    assert (r["created"], r["updated"], r["unchanged"]) == (d["created"], d["updated"], d["unchanged"])
    assert len(r["students"]) == 2


def test_dry_run_reports_warnings_and_preserves_blank_cells_in_its_counts(env, tpo):
    seed_placed_student(env, tpo)
    # Only blank / unusable optional cells -> nothing to change for Ann
    d = upload_dry(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,,hired,\n").json()
    assert (d["created"], d["updated"], d["unchanged"]) == (0, 0, 1)
    assert [(w["line"], w["column"], w["value"]) for w in d["warnings"]] == [(2, "verificationStatus", "hired")]


def test_dry_run_rejects_exactly_what_the_real_import_rejects(env, tpo):
    bad = CSV_HEAD + "Ann,,CSE,2026\n,b@x.com,CSE,2026\n"
    for send in (upload, upload_dry):
        r = send(env, tpo, bad)
        assert r.status_code == 400
        assert sorted(x["line"] for x in r.json()["detail"]["invalidRows"]) == [2, 3]
    assert upload_dry(env, tpo, CSV_HEAD).status_code == 400          # header only
    assert upload_dry(env, tpo, "", ).status_code == 400              # empty file
    assert upload_dry(env, tpo, CSV_HEAD, name="notes.txt").status_code == 400
    assert upload_dry(env, tpo, "x" * (5 * 1024 * 1024 + 1)).status_code == 413
    assert env.db.rows("students") == []


def test_malformed_binary_input_is_a_clean_400_not_a_crash(env, tpo):
    blob = bytes(range(256)) * 20
    for url in ("/api/students/upload", "/api/students/upload?dryRun=true"):
        r = env.client.post(url, headers=tpo, files={"file": ("roster.csv", io.BytesIO(blob), "text/csv")})
        assert r.status_code == 400, r.text
    assert env.db.rows("students") == []


def test_csv_college_id_cannot_override_the_authenticated_college_in_a_dry_run_or_real_import(env, tpo, tpo2):
    seed_placed_student(env, tpo)
    forged = "name,email,branch,graduationYear,college_id\nAnn,ann@x.com,CSE,2026,col-2\n"
    d = upload_dry(env, tpo2, forged).json()
    assert d["created"] == 1 and d["updated"] == 0                    # tpo2 does not see college 1's Ann
    upload(env, tpo2, forged)
    assert {s["college_id"] for s in env.db.rows("students")} == {"col-1", "col-2"}
    assert env.db.one("students", college_id="col-1", email="ann@x.com")["placement_status"] == "placed"


def test_csv_upload_rejections(env, tpo):
    assert upload(env, tpo, CSV_HEAD, name="notes.txt").status_code == 400
    assert upload(env, tpo, CSV_HEAD).status_code == 400                                    # no rows
    bad = upload(env, tpo, CSV_HEAD + "Ann,,CSE,2026\n")
    assert bad.status_code == 400 and bad.json()["detail"]["invalidRows"][0]["missing"] == ["email"]
    inf = upload(env, tpo, CSV_HEAD + "Ann,a@x.com,CSE,inf\n")
    assert inf.status_code == 400                                                           # used to be a 500
    big = upload(env, tpo, "x" * (5 * 1024 * 1024 + 1))
    assert big.status_code == 413
    assert env.db.rows("students") == []


def test_csv_upload_cannot_target_another_college(env, tpo):
    upload(env, tpo, CSV_HEAD + "Ann,a@x.com,CSE,2026\n")
    # a forged college_id column in the file is ignored; the TPO's own college is always applied
    upload(env, tpo, "name,email,branch,graduationYear,college_id\nEve,e@x.com,CSE,2026,col-2\n")
    assert {s["college_id"] for s in env.db.rows("students")} == {"col-1"}


def test_filters_list_export_and_shortlist(env, tpo):
    upload(env, tpo, CSV_HEAD + "A,a@x.com,CSE,2026,80,verified,placed\nB,b@x.com,Computer Science,2027,40,pending,\nC,c@x.com,ECE,2026,90,verified,\n")
    names = lambda r: sorted(s["name"] for s in r.json())
    assert names(env.client.get("/api/students/?branch=cse", headers=tpo)) == ["A", "B"]
    assert names(env.client.get("/api/students/?graduationYear=2026&minimumScore=85", headers=tpo)) == ["C"]
    sl = env.client.post("/api/shortlist/filter", headers=tpo, json={"branch": "CSE", "verificationStatus": "VERIFIED"})
    assert sl.json()["total"] == 1 and sl.json()["students"][0]["name"] == "A"
    exp = env.client.get("/api/students/export?placementStatus=placed", headers=tpo)
    assert exp.headers["content-type"].startswith("text/csv")
    lines = exp.text.strip().splitlines()
    assert lines[0].startswith("name,email,branch,graduationYear") and len(lines) == 2 and lines[1].startswith("A,a@x.com")
    sx = env.client.get("/api/shortlist/export?minimumScore=60", headers=tpo).text.strip().splitlines()
    assert len(sx) == 3


def test_exports_neutralise_spreadsheet_formulas(env, tpo):
    env.db.add("students", college_id="col-1", name="=HYPERLINK(\"http://evil\")", email="e@x.com", branch="@SUM(A1)",
               graduation_year=2026, employability_score=5, verification_status="verified")
    import csv as _csv
    for path in ("/api/students/export", "/api/shortlist/export"):
        rows = list(_csv.reader(io.StringIO(env.client.get(path, headers=tpo).text)))
        data = rows[1]
        assert data[0] == "'=HYPERLINK(\"http://evil\")", path
        assert data[2] == "'@SUM(A1)", path
        assert not any(c.startswith(("=", "+", "-", "@")) for c in data), path


def test_bulk_placement_and_validation(env, tpo):
    upload(env, tpo, CSV_HEAD + "A,a@x.com,CSE,2026\nB,b@x.com,CSE,2026\n")
    ids = [s["id"] for s in env.db.rows("students")]
    r = env.client.put("/api/students/bulk-placement-status", headers=tpo, json={"studentIds": ids, "placementStatus": "placed"})
    assert r.json()["updatedCount"] == 2
    assert env.client.put("/api/students/bulk-placement-status", headers=tpo, json={"studentIds": [], "placementStatus": "placed"}).status_code == 422
    assert env.client.put("/api/students/bulk-placement-status", headers=tpo, json={"studentIds": ids, "placementStatus": "x"}).status_code == 422
    stats = env.client.get("/api/dashboard/stats", headers=tpo).json()
    assert stats["totalStudents"] == 2 and stats["placedStudents"] == 2 and stats["placementPercentage"] == 100.0


def test_dashboard_stats_and_distribution(env, tpo, tpo2):
    assert env.client.get("/api/dashboard/stats", headers=tpo).json()["placementPercentage"] == 0.0     # no div-by-zero
    upload(env, tpo, CSV_HEAD + "A,a@x.com,CSE,2026,10,verified,placed\nB,b@x.com,CSE,2026,100,,\nC,c@x.com,CSE,2026,59.9,,\nD,d@x.com,CSE,2026,60,,\n")
    env.db.add("company_drives", college_id="col-1", status="Active")
    env.db.add("company_drives", college_id="col-1", status="Closed")
    env.db.add("company_drives", college_id="col-2", status="Active")
    s = env.client.get("/api/dashboard/stats", headers=tpo).json()
    assert s["totalStudents"] == 4 and s["verifiedStudents"] == 1 and s["averageEmployabilityScore"] == 57.48
    assert (s["activeCompanyDrives"], s["closedDrives"], s["totalDrives"]) == (1, 1, 2)
    assert env.client.get("/api/dashboard/score-distribution", headers=tpo).json() == {"0-20": 1, "20-40": 0, "40-60": 1, "60-80": 1, "80-100": 1}
    assert env.client.get("/api/dashboard/stats", headers=tpo2).json()["totalStudents"] == 0


def test_college_drive_crud_eligibility_and_isolation(env, tpo, tpo2):
    upload(env, tpo, CSV_HEAD + "A,a@x.com,CSE,2026,80\nB,b@x.com,ECE,2026,90\nC,c@x.com,CSE,2027,95\nD,d@x.com,CSE,2026,30\n")
    r = env.client.post("/api/drives/", headers=tpo, json={
        "companyName": "Initech", "role": "SDE", "date": "2030-01-01", "status": "Active",
        "eligibility": {"branch": "CSE", "graduationYear": 2026, "minimumScore": 60}})
    assert r.status_code == 201, r.text
    did = r.json()["drive"]["id"]
    assert r.json()["drive"]["eligibility"]["branch"] == ["CSE"]
    elig = env.client.get(f"/api/drives/{did}/eligible", headers=tpo).json()
    assert [s["name"] for s in elig["eligibleStudents"]] == ["A"]
    assert env.client.get(f"/api/drives/{did}/eligible", headers=tpo2).status_code == 404
    assert env.client.put(f"/api/drives/{did}", headers=tpo2, json={"role": "x"}).status_code == 404
    assert env.client.delete(f"/api/drives/{did}", headers=tpo2).status_code == 404
    up = env.client.put(f"/api/drives/{did}", headers=tpo, json={"date": "2031-05-05", "status": "Closed"})
    assert up.json()["drive"]["date"] == "2031-05-05" and up.json()["drive"]["status"] == "Closed"
    assert env.client.delete(f"/api/drives/{did}", headers=tpo).status_code == 200


@pytest.mark.parametrize("status", ["active", "ACTIVE", "Live", ""])
def test_college_drive_status_must_be_a_known_label(env, tpo, status):
    r = env.client.post("/api/drives/", headers=tpo, json={"companyName": "X", "role": "R", "date": "2030-01-01", "status": status})
    assert r.status_code == 422
    assert env.client.put("/api/drives/nope", headers=tpo, json={"status": status}).status_code == 422


def test_college_drive_rejects_bad_date(env, tpo):
    assert env.client.post("/api/drives/", headers=tpo, json={"companyName": "X", "role": "R", "date": "31/12/2030"}).status_code == 422


def test_departments_stats_match_students(env, tpo, tpo2):
    upload(env, tpo, CSV_HEAD + "A,a@x.com,CSE,2026,80,,placed\nB,b@x.com,Computer Science,2026,60,,\nC,c@x.com,ECE,2026,90,,\n")
    r = env.client.post("/api/departments/", headers=tpo, json={"name": "Computer Science", "code": "CSE", "hodName": "Dr. Rao"})
    assert r.status_code in (200, 201), r.text
    deps = env.client.get("/api/departments/", headers=tpo).json()
    stats = deps[0].get("stats") or deps[0]
    assert stats["studentCount"] == 2 and stats["placedStudents"] == 1 and stats["placementRate"] == 50.0
    assert env.client.get("/api/departments/", headers=tpo2).json() == []


# ── duplicates, plan ids, partial failures, audit ─────────────────────

def hook(env, fn):
    """Run `fn(op, table, query)` just before every DB call the college routes make."""
    orig = env.db.table

    def table(name):
        q = orig(name)
        real = q.execute

        def execute():
            fn(q.op, name, q)
            return real()
        q.execute = execute
        return q
    env.db.table = table


def unhook(env):
    env.db.table = type(env.db).table.__get__(env.db)


def counts(body):
    return {k: body[k] for k in ("created", "updated", "unchanged")}


@pytest.mark.parametrize("dry", [True, False])
def test_conflicting_duplicate_rows_refuse_the_file_and_name_every_line_and_column(env, tpo, dry):
    send = upload_dry if dry else upload
    r = send(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,70,,\nBob,bob@x.com,IT,2026,,,\nAnn K,ann@x.com,CSE,2026,80,,\n")
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "repeats an email with different values" in detail["message"]
    assert detail["duplicates"] == [{"email": "ann@x.com", "lines": [2, 4], "conflicts": ["name", "employabilityScore"]}]
    assert env.db.rows("students") == []


def test_agreeing_duplicate_rows_are_merged_counted_once_and_reported(env, tpo):
    body = upload_dry(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,70,,\nAnn,ANN@x.com,CSE,2026,,verified,\n").json()
    assert counts(body) == {"created": 1, "updated": 0, "unchanged": 0}
    assert body["warningsTotal"] == 1
    assert body["warnings"] == [{"line": 3, "column": "email", "value": "ann@x.com",
                                 "reason": "repeats line 2 with the same values — counted once"}]
    upload(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,70,,\nAnn,ANN@x.com,CSE,2026,,verified,\n")
    ann = env.db.one("students", email="ann@x.com")
    assert ann["employability_score"] == 70 and ann["verification_status"] == "verified"   # both rows' fields were kept


def test_invalid_email_and_nul_byte_are_refused_at_the_preview_exactly_as_at_the_import(env, tpo):
    text = "name,email,branch,graduationYear\nA,nope,CSE,2026\nB\x00,b@x.com,CSE,2026\nC,c@x.com,CSE,2026.5\n"
    for send in (upload_dry, upload):
        r = send(env, tpo, text)
        assert r.status_code == 400
        assert [(x["line"], x["missing"]) for x in r.json()["detail"]["invalidRows"]] == [
            (2, ["email"]), (3, ["name"]), (4, ["graduationYear"])]
    assert env.db.rows("students") == []


def test_scores_the_database_would_refuse_are_dropped_at_the_preview_so_the_import_cannot_fail_on_them(env, tpo):
    text = CSV_HEAD + "Ann,ann@x.com,CSE,2026,1000,,\nBob,bob@x.com,CSE,2026,1e308,,\n"
    d = upload_dry(env, tpo, text).json()
    assert [(w["column"], w["reason"]) for w in d["warnings"]] == [("employabilityScore", "outside 0-100")] * 2
    assert upload(env, tpo, text).status_code == 201
    assert {s["employability_score"] for s in env.db.rows("students")} == {0}     # the database default; nothing out of range was sent


def test_a_score_with_extra_decimals_is_unchanged_on_re_upload_because_it_is_rounded_like_the_database(env, tpo):
    upload(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,77.456,,\n")
    assert env.db.one("students", email="ann@x.com")["employability_score"] == 77.46
    # the numeric(5,2) column stores 77.46; an unrounded 77.456 would compare unequal forever
    again = upload(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,77.456,,\n").json()
    assert counts(again) == {"created": 0, "updated": 0, "unchanged": 1}


def test_plan_id_is_stable_for_the_same_file_and_roster_and_changes_with_either(env, tpo):
    text = CSV_HEAD + "Ann,ann@x.com,CSE,2026,70,,\n"
    a, b = upload_dry(env, tpo, text).json()["planId"], upload_dry(env, tpo, text).json()["planId"]
    assert a == b and len(a) == 32
    assert upload_dry(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,71,,\n").json()["planId"] != a      # different file
    upload(env, tpo, text)
    assert upload_dry(env, tpo, text).json()["planId"] != a                                              # different roster


def test_a_matching_expected_plan_imports_and_the_real_response_carries_the_same_plan(env, tpo):
    text = CSV_HEAD + "Ann,ann@x.com,CSE,2026,70,,\n"
    plan = upload_dry(env, tpo, text).json()["planId"]
    r = env.client.post(f"/api/students/upload?expectedPlan={plan}", headers=tpo,
                        files={"file": ("r.csv", io.BytesIO(text.encode()), "text/csv")})
    assert r.status_code == 201 and r.json()["planId"] == plan and r.json()["created"] == 1


def test_a_stale_preview_is_refused_with_nothing_written_when_the_roster_changed_after_it(env, tpo):
    sid = env.client.post("/api/students/", headers=tpo, json={"name": "Ann", "email": "ann@x.com", "branch": "CSE", "graduationYear": 2026}).json()["student"]["id"]
    text = CSV_HEAD + "Ann K,ann@x.com,CSE,2026,,,\n"
    plan = upload_dry(env, tpo, text).json()["planId"]
    env.client.put(f"/api/students/{sid}", headers=tpo, json={"name": "Ann K"})     # someone makes the same edit meanwhile
    before = [dict(r) for r in env.db.rows("students")]
    r = env.client.post(f"/api/students/upload?expectedPlan={plan}", headers=tpo,
                        files={"file": ("r.csv", io.BytesIO(text.encode()), "text/csv")})
    assert r.status_code == 409
    assert "changed since the preview" in r.json()["detail"]["message"]
    assert [dict(x) for x in env.db.rows("students")] == before


def test_a_different_file_than_the_one_previewed_is_refused(env, tpo):
    plan = upload_dry(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,70,,\n").json()["planId"]
    r = env.client.post(f"/api/students/upload?expectedPlan={plan}", headers=tpo,
                        files={"file": ("r.csv", io.BytesIO((CSV_HEAD + "Mallory,m@x.com,CSE,2026,99,,\n").encode()), "text/csv")})
    assert r.status_code == 409 and env.db.rows("students") == []


def test_only_the_fields_that_differ_are_written_so_an_old_export_cannot_revert_a_newer_edit(env, tpo):
    upload(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,80,verified,not_placed\n")

    def a_newer_edit_lands_first(op, name, q):
        if op == "upsert" and name == "students":
            env.db.tables["students"][0]["placement_status"] = "placed"            # a TPO action since the export
    hook(env, a_newer_edit_lands_first)
    # the file is an old export with one correction (the name); it still says not_placed
    upload(env, tpo, CSV_HEAD + "Ann K,ann@x.com,CSE,2026,80,verified,not_placed\n")
    ann = env.db.tables["students"][0]
    assert ann["name"] == "Ann K" and ann["placement_status"] == "placed"


def test_a_failure_part_way_says_exactly_how_much_was_saved_and_a_rerun_finishes_the_job(env, tpo):
    calls = {"n": 0}

    def second_batch_fails(op, name, q):
        if op == "upsert" and name == "students":
            calls["n"] += 1
            if calls["n"] == 2:
                raise APIError({"message": "numeric field overflow", "code": "22003", "hint": None, "details": None})
    hook(env, second_batch_fails)
    text = CSV_HEAD + "A,a@x.com,CSE,2026,70,,\nB,b@x.com,CSE,2026,,,\n"      # two column sets -> two batches
    r = upload(env, tpo, text)
    detail = r.json()["detail"]
    assert r.status_code == 400 and (detail["saved"], detail["notSaved"]) == (1, 1)
    assert "1 of 2 changed students were saved" in detail["message"] and "same file again" in detail["message"]
    assert [s["email"] for s in env.db.rows("students")] == ["a@x.com"]
    unhook(env)
    rerun = upload(env, tpo, text).json()
    assert counts(rerun) == {"created": 1, "updated": 0, "unchanged": 1}
    assert sorted(s["email"] for s in env.db.rows("students")) == ["a@x.com", "b@x.com"]


def test_a_failure_of_the_very_first_batch_says_nothing_was_saved(env, tpo):
    def refuse(op, name, q):
        if op == "upsert" and name == "students":
            raise APIError({"message": "row-level security", "code": "42501", "hint": None, "details": None})
    hook(env, refuse)
    r = upload(env, tpo, CSV_HEAD + "A,a@x.com,CSE,2026,70,,\n")
    assert r.status_code == 400
    assert r.json()["detail"]["message"].startswith("Nothing was saved") and r.json()["detail"]["saved"] == 0


def test_an_unconfirmed_write_is_reported_as_an_unknown_outcome_not_as_success_or_as_nothing_saved(env, tpo):
    calls = {"n": 0}

    def connection_drops(op, name, q):
        if op == "upsert" and name == "students":
            calls["n"] += 1
            if calls["n"] == 2:
                raise ConnectionError("read timed out")
    hook(env, connection_drops)
    r = upload(env, tpo, CSV_HEAD + "A,a@x.com,CSE,2026,70,,\nB,b@x.com,CSE,2026,,,\n")
    detail = r.json()["detail"]
    assert r.status_code == 502 and "unknown how much was saved" in detail["message"] and detail["saved"] == 1


def test_a_real_import_is_audited_once_without_student_data_and_a_preview_is_not_audited(env, tpo):
    text = CSV_HEAD + "Ann,ann@x.com,CSE,2026,70,,\nBob,bob@x.com,IT,2026,,,\n"
    upload_dry(env, tpo, text)
    assert env.db.rows("admin_events") == []
    upload(env, tpo, text)
    (event,) = env.db.rows("admin_events")
    assert event["event_type"] == "roster_imported" and event["actor_role"] == "college" and event["actor_user_id"] == "tpo-1"
    assert event["target_type"] == "roster" and event["target_id"] == "col-1" and event["result"] == "success"
    assert event["metadata"] == {"created": 2, "updated": 0, "unchanged": 0, "rows_in_file": 2}
    assert "ann@x.com" not in str(event)
