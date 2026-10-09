"""Integration: TPO roster management, CSV upload/export, shortlist, drives, departments, dashboard, tenant isolation."""
import io

import pytest

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
    r = upload(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,70,verified,placed\nBob,bob@x.com,IT,2026,50,,\nAnn Again,ANN@x.com,CSE,2026,90,,\n")
    assert r.status_code == 201, r.text
    assert r.json()["addedStudents"] == 2                     # in-file duplicate collapsed, last wins
    ann = env.db.one("students", email="ann@x.com")
    assert ann["name"] == "Ann Again" and ann["employability_score"] == 90 and ann["college_id"] == "col-1"
    # re-upload updates instead of duplicating
    upload(env, tpo, CSV_HEAD + "Ann,ann@x.com,CSE,2026,10,,\n")
    assert len(env.db.rows("students")) == 2 and env.db.one("students", email="ann@x.com")["employability_score"] == 10


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
