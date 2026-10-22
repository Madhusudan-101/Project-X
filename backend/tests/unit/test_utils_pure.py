"""Unit tests for pure helpers: email rules, HTML sanitiser, branch matching,
CSV roster parsing, profile-link extraction, practice ranking, resume diff."""
import pytest

from app.utils.email_rules import is_valid_email_format
from app.utils.html_sanitize import sanitize_html
from app.utils.college.branch import branch_matches, normalize_branch
from app.utils.college.csv_students import (
    CsvFormatError, merge_duplicate_rows, parse_students_csv, parse_students_csv_with_warnings,
)
from app.services.candidate.link_extraction import (
    detect_profile_links,
    extract_codeforces_handle,
    extract_github_username,
    extract_leetcode_username,
)
from app.services.candidate.practice_ranking import TOP_N_TOPICS, rank_weak_topics
from app.utils.resume_diff import assemble_final_text, build_hunks, word_diff


# ── email ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("email", ["a@b.co", "first.last+tag@sub.example.com", "x@y.z"])
def test_valid_emails(email):
    assert is_valid_email_format(email)


@pytest.mark.parametrize(
    "email", ["", None, "plain", "a@b", "@b.co", "a@.co", "a b@c.de", "a@b c.de", "a@@b.co"]
)
def test_invalid_emails(email):
    assert not is_valid_email_format(email)


# ── HTML sanitiser ──────────────────────────────────────────────────
def test_sanitize_keeps_allowed_tags_and_drops_attributes():
    out = sanitize_html('<p class="x" onclick="evil()">Hi <b style="color:red">you</b></p>')
    assert out == "<p>Hi <b>you</b></p>"


@pytest.mark.parametrize(
    "payload",
    [
        "<script>alert(1)</script>",
        "<style>body{display:none}</style>",
        "<iframe src=//evil></iframe>",
        "<svg onload=alert(1)><script>x</script></svg>",
        "<object data=x></object>",
        "<math><mi>x</mi></math>",
        "<template><p>hidden</p></template>",
    ],
)
def test_sanitize_discards_dangerous_content(payload):
    out = sanitize_html("<p>ok</p>" + payload)
    assert out == "<p>ok</p>"


def test_sanitize_unwraps_unknown_tags_but_keeps_text():
    assert sanitize_html("<a href='javascript:x'>click</a>") == "click"
    assert sanitize_html("<img src=x onerror=alert(1)>") == ""


def test_sanitize_escapes_text_and_closes_open_tags():
    assert sanitize_html("1 < 2 & 3") == "1 &lt; 2 &amp; 3"
    assert sanitize_html("<ul><li>a") == "<ul><li>a</li></ul>"


def test_sanitize_handles_none_and_empty():
    assert sanitize_html("") == ""
    assert sanitize_html(None) == ""


def test_sanitize_ignores_stray_end_tags():
    assert sanitize_html("a</p>b</script>c") == "abc"


def test_sanitize_unclosed_script_swallows_rest():
    assert sanitize_html("<p>a</p><script>alert(1)") == "<p>a</p>"


# ── branch matching ─────────────────────────────────────────────────
@pytest.mark.parametrize(
    "raw,canon",
    [("CSE", "computer science"), (" cs ", "computer science"), ("IT", "information technology"),
     ("E&C", "electronics and communication"), ("Mech", "mechanical"), (None, ""), ("Biotech", "biotech")],
)
def test_normalize_branch(raw, canon):
    assert normalize_branch(raw) == canon


def test_branch_matches_alias_and_substring():
    assert branch_matches("Computer Science and Engineering", ["CSE"])
    assert branch_matches("CSE", ["Computer Science"])
    assert branch_matches("ECE", ["Electronics and Communication", "IT"])


def test_branch_no_constraint_means_everyone_matches():
    assert branch_matches("Mechanical", [])
    assert branch_matches(None, [])


def test_branch_missing_student_branch_fails_when_constrained():
    assert not branch_matches(None, ["CSE"])
    assert not branch_matches("", ["CSE"])


def test_branch_mismatch():
    assert not branch_matches("Civil", ["CSE", "IT"])
    assert not branch_matches("Mechanical", ["Electrical"])


# ── CSV roster ──────────────────────────────────────────────────────
HEADER = "name,email,branch,graduationYear,employabilityScore,verificationStatus,placementStatus\n"


def test_csv_happy_path_carries_only_supplied_fields():
    rows, bad = parse_students_csv((HEADER + "Ann,ANN@X.COM,CSE,2026,77.5,VERIFIED,placed\n").encode())
    assert bad == []
    r = rows[0]
    assert r["email"] == "ann@x.com"
    assert r["graduation_year"] == 2026
    assert r["employability_score"] == 77.5
    assert r["verification_status"] == "verified"
    assert r["placement_status"] == "placed"
    assert "github_score" not in r  # not in the file -> never written, so never reset


def test_csv_without_optional_columns_yields_only_required_fields():
    rows, bad = parse_students_csv(b"name,email,branch,graduationYear\nAnn,ann@x.com,CSE,2026\n")
    assert bad == []
    assert set(rows[0]) == {"name", "email", "branch", "graduation_year"}


def test_csv_blank_optional_cells_are_left_out():
    rows, _ = parse_students_csv((HEADER + "A,a@x.com,CSE,2026,,,\nB,b@x.com,CSE,2026,0,pending,not_placed\n").encode())
    assert set(rows[0]) == {"name", "email", "branch", "graduation_year"}
    assert rows[1]["employability_score"] == 0.0           # an explicit 0 is a value, not a blank
    assert rows[1]["verification_status"] == "pending" and rows[1]["placement_status"] == "not_placed"


def test_csv_unusable_optional_values_are_left_out_and_reported():
    rows, _, warnings = parse_students_csv_with_warnings(
        (HEADER + "A,a@x.com,CSE,2026,high,weird,nope\n").encode())
    assert set(rows[0]) == {"name", "email", "branch", "graduation_year"}
    assert [(w["line"], w["column"], w["value"]) for w in warnings] == [
        (2, "employabilityScore", "high"), (2, "verificationStatus", "weird"), (2, "placementStatus", "nope")]


def test_csv_missing_required_reports_line_numbers():
    rows, bad = parse_students_csv((HEADER + "A,a@x.com,CSE,2026\n,b@x.com,CSE,2026\nC,,CSE,2026\n").encode())
    assert len(rows) == 1
    assert [b["line"] for b in bad] == [3, 4]
    assert bad[0]["missing"] == ["name"]
    assert bad[1]["missing"] == ["email"]


@pytest.mark.parametrize("year", ["soon", "0", "-5", "99999", "inf", "-inf", "nan", "1e999", "2026.9", "1949", "2101", "+2026", "0x7EA"])
def test_csv_bad_graduation_year_is_an_invalid_row_never_a_crash(year):
    rows, bad = parse_students_csv((HEADER + f"A,a@x.com,CSE,{year}\n").encode())
    assert rows == []
    assert bad[0]["missing"] == ["graduationYear"]


def test_csv_whole_number_year_written_with_a_zero_fraction_is_accepted_but_a_real_fraction_is_not():
    rows, bad = parse_students_csv((HEADER + "A,a@x.com,CSE,2026.0\nB,b@x.com,CSE,2026.5\n").encode())
    assert [r["graduation_year"] for r in rows] == [2026]
    assert [b["line"] for b in bad] == [3]   # never silently truncated to 2026


@pytest.mark.parametrize("val", ["inf", "nan", "-inf"])
def test_csv_non_finite_scores_are_neutralised(val):
    rows, _, warnings = parse_students_csv_with_warnings((HEADER + f"A,a@x.com,CSE,2026,{val}\n").encode())
    assert "employability_score" not in rows[0]
    assert warnings[0]["column"] == "employabilityScore"


def test_csv_scores_are_rounded_half_up_to_two_decimals_like_the_numeric_column():
    rows, _, warnings = parse_students_csv_with_warnings(
        (HEADER + "A,a@x.com,CSE,2026,77.456\nB,b@x.com,CSE,2026,77.455\nC,c@x.com,CSE,2026,0.004\nD,d@x.com,CSE,2026,99.999\n").encode())
    assert [r["employability_score"] for r in rows] == [77.46, 77.46, 0.0, 100.0]   # 77.455 -> 77.46 (float rounding would give 77.45)
    assert warnings == []                                                          # 99.999 rounds to the allowed maximum

@pytest.mark.parametrize("val,reason", [
    ("1000", "outside 0-100"), ("100.005", "outside 0-100"), ("-0.006", "outside 0-100"), ("-5", "outside 0-100"),
    ("1e308", "outside 0-100"), ("1e999999999999", "outside 0-100"),
    ("0x10", "not a number"), ("1_000", "not a number"), ("12abc", "not a number"), ("1,5", "not a number"),
])
def test_csv_scores_that_the_database_would_refuse_are_ignored_and_reported_at_preview(val, reason):
    rows, _, warnings = parse_students_csv_with_warnings((HEADER + f'A,a@x.com,CSE,2026,"{val}"\n').encode())
    assert "employability_score" not in rows[0]
    assert [(w["column"], w["value"], w["reason"]) for w in warnings] == [("employabilityScore", val, reason)]


def test_csv_score_boundaries_are_accepted():
    rows, bad = parse_students_csv((HEADER + "A,a@x.com,CSE,2026,0\nB,b@x.com,CSE,2026,100\nC,c@x.com,CSE,2026,-0.004\nD,d@x.com,CSE,2026,.5\n").encode())
    assert bad == [] and [r["employability_score"] for r in rows] == [0.0, 100.0, 0.0, 0.5]


def test_csv_a_nul_byte_in_a_text_column_makes_the_row_invalid_because_postgres_cannot_store_it():
    rows, bad = parse_students_csv(("name,email,branch,graduationYear\nA\x00,a@x.com,CSE\x00,2026\nB,b@x.com,CSE,2026\n").encode())
    assert [r["email"] for r in rows] == ["b@x.com"]
    assert bad[0]["line"] == 2 and bad[0]["missing"] == ["name", "branch"]


@pytest.mark.parametrize("email", ["nope", "a@b", "a b@x.com", "@x.com", "a@@x.com"])
def test_csv_an_email_that_is_not_an_email_makes_the_row_invalid(email):
    rows, bad = parse_students_csv(f'name,email,branch,graduationYear\nA,"{email}",CSE,2026\n'.encode())
    assert rows == [] and bad[0]["missing"] == ["email"]


def test_csv_rows_with_nothing_in_them_are_skipped_not_fatal():
    rows, bad = parse_students_csv((HEADER + "A,a@x.com,CSE,2026,,,\n,,,,,,\n   ,  ,,,,,\n").encode())
    assert [r["email"] for r in rows] == ["a@x.com"] and bad == []


def test_csv_a_header_that_repeats_a_column_is_refused_rather_than_guessing_which_one_counts():
    with pytest.raises(CsvFormatError, match="email"):
        parse_students_csv(b"name,email,email,branch,graduationYear\nA,a@x.com,z@x.com,CSE,2026\n")


def test_csv_rows_remember_their_line_number():
    rows, _ = parse_students_csv((HEADER + "A,a@x.com,CSE,2026\n,x@x.com,CSE,2026\nC,c@x.com,CSE,2026\n").encode())
    assert [(r["email"], r.line) for r in rows] == [("a@x.com", 2), ("c@x.com", 4)]


# The validation contract below is the same table as in frontend/src/lib/demo/college/engine.test.ts
# ("scores follow the live contract" / "graduation years and emails follow the live contract").
# Keep the two in step: it is what makes a file behave identically in the College Portal demo and live.
CONTRACT_SCORES = [
    ("77.456", 77.46), ("77.455", 77.46), ("0.004", 0.0), ("99.999", 100.0), ("100", 100.0), ("0", 0.0),
    (".5", 0.5), ("-0.004", 0.0),
    ("1000", "outside 0-100"), ("100.005", "outside 0-100"), ("-0.006", "outside 0-100"),
    ("-5", "outside 0-100"), ("1e308", "outside 0-100"),
    ("0x10", "not a number"), ("1_000", "not a number"), ("12abc", "not a number"), ("1,5", "not a number"),
]
CONTRACT_YEARS = {
    True: ["2026", "2026.0", "1950", "2100"],
    False: ["2026.5", "1949", "2101", "+2026", "soon", "0x7EA", "99999", "-5", "1e3"],
}
CONTRACT_EMAILS = {True: ["a@b.co", "a.b+c@x.com"], False: ["nope", "a@b", "a b@x.com", "@x.com", "a@@x.com"]}


@pytest.mark.parametrize("cell,expected", CONTRACT_SCORES)
def test_contract_scores(cell, expected):
    rows, _, warnings = parse_students_csv_with_warnings(
        f'name,email,branch,graduationYear,employabilityScore\nA,a@x.com,CSE,2027,"{cell}"\n'.encode())
    if isinstance(expected, float):
        assert rows[0]["employability_score"] == expected and warnings == []
    else:
        assert "employability_score" not in rows[0] and warnings[0]["reason"] == expected


@pytest.mark.parametrize("valid,cells", CONTRACT_YEARS.items())
def test_contract_years(valid, cells):
    for cell in cells:
        rows, bad = parse_students_csv(f'name,email,branch,graduationYear\nA,a@x.com,CSE,"{cell}"\n'.encode())
        assert bool(rows) is valid and bool(bad) is not valid, cell


@pytest.mark.parametrize("valid,cells", CONTRACT_EMAILS.items())
def test_contract_emails(valid, cells):
    for cell in cells:
        rows, bad = parse_students_csv(f'name,email,branch,graduationYear\nA,"{cell}",CSE,2027\n'.encode())
        assert bool(rows) is valid and bool(bad) is not valid, cell


def test_csv_bom_and_latin1():
    rows, _ = parse_students_csv("﻿".encode("utf-8") + (HEADER + "José,j@x.com,CSE,2026\n").encode())
    assert rows[0]["name"] == "José"
    rows, _ = parse_students_csv((HEADER + "Jos\xe9,j@x.com,CSE,2026\n").encode("latin-1"))
    assert rows[0]["name"] == "José"


def test_csv_extra_columns_and_short_rows_do_not_crash():
    rows, bad = parse_students_csv((HEADER + "A,a@x.com,CSE,2026,1,verified,placed,EXTRA,MORE\nB,b@x.com\n").encode())
    assert len(rows) == 1 and len(bad) == 1


def test_csv_unreadable_bytes_raise_a_format_error_not_a_raw_csv_error():
    with pytest.raises(CsvFormatError):
        parse_students_csv(bytes(range(256)) * 20)


def test_csv_empty_file():
    assert parse_students_csv(b"") == ([], [])


def _rows(text):
    return parse_students_csv((HEADER + text).encode())[0]


def test_duplicates_that_agree_or_only_fill_blanks_merge_and_are_reported():
    merged, dups = merge_duplicate_rows(_rows(
        "Ann,a@x.com,CSE,2026,70,,\nBob,b@x.com,IT,2027,,,\nAnn,A@x.com,CSE,2026,,verified,\n"))
    assert [m["email"] for m in merged] == ["a@x.com", "b@x.com"]       # first-seen order
    assert merged[0]["employability_score"] == 70 and merged[0]["verification_status"] == "verified"  # a blank never erases
    assert dups == [{"email": "a@x.com", "lines": [2, 4], "conflicts": []}]


def test_duplicates_that_disagree_are_reported_as_conflicts_with_every_line_and_column():
    merged, dups = merge_duplicate_rows(_rows(
        "Ann,a@x.com,CSE,2026,70,,\nAnn K,a@x.com,CSE,2027,80,,\nAnn,a@x.com,CSE,2026,70,,\n"))
    assert len(merged) == 1
    assert dups == [{"email": "a@x.com", "lines": [2, 3, 4], "conflicts": ["name", "graduationYear", "employabilityScore"]}]


def test_a_file_without_repeated_emails_reports_no_duplicates():
    assert merge_duplicate_rows(_rows("A,a@x.com,CSE,2026,,,\nB,b@x.com,CSE,2026,,,\n"))[1] == []


# ── profile links ───────────────────────────────────────────────────
def test_github_profile_vs_repo_links():
    assert extract_github_username("https://github.com/veedhee2304") == "veedhee2304"
    assert extract_github_username("https://github.com/veedhee2304/") == "veedhee2304"
    assert extract_github_username("https://github.com/owner/repo") is None
    assert extract_github_username("https://github.com/orgs") is None
    assert extract_github_username("https://gist.github.com/me") == "me"
    assert extract_github_username("https://notgithub.com/me") is None
    assert extract_github_username("https://evil.com/github.com/me") is None


def test_leetcode_and_codeforces_links():
    assert extract_leetcode_username("https://leetcode.com/u/alice/") == "alice"
    assert extract_leetcode_username("https://leetcode.com/alice") == "alice"
    assert extract_leetcode_username("https://leetcode.com/") is None
    assert extract_leetcode_username("https://example.com/u/alice") is None
    assert extract_codeforces_handle("https://codeforces.com/profile/tourist") == "tourist"
    assert extract_codeforces_handle("https://codeforces.com/contest/1") is None


def test_links_with_garbage_do_not_raise():
    for bad in ["", "not a url", "http://[::1", "ftp://", "   "]:
        assert extract_github_username(bad) is None
        assert extract_leetcode_username(bad) is None
        assert extract_codeforces_handle(bad) is None


def test_detect_profile_links_first_match_per_platform():
    found = detect_profile_links([
        "https://github.com/a/repo", "https://github.com/first", "https://github.com/second",
        "https://leetcode.com/u/lc", "https://codeforces.com/profile/cf",
    ])
    assert found == {"github": "first", "leetcode": "lc", "codeforces": "cf"}


def test_detect_profile_links_partial():
    assert detect_profile_links(["https://github.com/x"]) == {"github": "x"}
    assert detect_profile_links([]) == {}


# ── practice ranking ────────────────────────────────────────────────
def _t(n, s): return {"tagName": n, "tagSlug": n, "problemsSolved": s}


def test_ranking_tier_first_then_weakest():
    ranked = rank_weak_topics({
        "advanced": [_t("dp", 0)],
        "fundamental": [_t("array", 50), _t("string", 5)],
        "intermediate": [_t("tree", 1)],
    })
    assert [r["tagName"] for r in ranked] == ["string", "array", "tree", "dp"]
    assert [r["tier"] for r in ranked] == ["fundamental", "fundamental", "intermediate", "advanced"]


def test_ranking_limits_to_top_n_and_handles_missing():
    many = {"fundamental": [_t(f"t{i}", i) for i in range(20)]}
    assert len(rank_weak_topics(many)) == TOP_N_TOPICS
    assert rank_weak_topics({}) == []
    assert rank_weak_topics({"fundamental": None}) == []


def test_ranking_does_not_mutate_input():
    src = {"fundamental": [_t("b", 2), _t("a", 1)]}
    rank_weak_topics(src)
    assert [t["tagName"] for t in src["fundamental"]] == ["b", "a"]
    assert "tier" not in src["fundamental"][0]


# ── resume diff ─────────────────────────────────────────────────────
ORIG = "SUMMARY\nBuilt things.\n\nEXPERIENCE\n- Did A\n- Did B\n- Did C\n"
NEW = "SUMMARY\nBuilt scalable things.\n\nEXPERIENCE\n- Did A well\n- Did B\n- Did C\n- Did D\n"


def _decide(hunks, decision):
    return {i: {**h, "id": f"h{i}", "decision": decision} for i, h in enumerate(hunks)}


def test_word_diff_reconstructs_both_sides():
    toks = word_diff("the quick brown fox", "the slow brown cat")
    assert "".join(t["text"] for t in toks if t["op"] != "insert") == "the quick brown fox"
    assert "".join(t["text"] for t in toks if t["op"] != "delete") == "the slow brown cat"


def test_hunks_label_sections_and_cover_changes():
    hunks, segments = build_hunks(ORIG, NEW)
    assert len(hunks) == 3
    assert hunks[0]["section"] == "SUMMARY"
    assert {h["section"] for h in hunks[1:]} == {"EXPERIENCE"}
    assert any(h["original_bullet"] == "" and h["rewritten_bullet"] == "- Did D" for h in hunks)
    assert sum(1 for s in segments if s["kind"] == "hunk") == len(hunks)


def test_accept_all_yields_rewritten_and_reject_all_yields_original():
    hunks, segments = build_hunks(ORIG, NEW)
    by = _decide(hunks, "accepted")
    assert assemble_final_text(segments, by, {}).strip() == NEW.strip()
    by = _decide(hunks, "rejected")
    assert assemble_final_text(segments, by, {}).strip() == ORIG.strip()


def test_pending_counts_as_original_and_explicit_decisions_override():
    hunks, segments = build_hunks(ORIG, NEW)
    by = _decide(hunks, "pending")
    assert assemble_final_text(segments, by, {}).strip() == ORIG.strip()
    out = assemble_final_text(segments, by, {"h0": "accepted"})
    assert "Built scalable things." in out and "Did A well" not in out


def test_deleted_bullet_accepted_removes_it():
    hunks, segments = build_hunks("A\n- x\n- y\n", "A\n- x\n")
    out = assemble_final_text(segments, _decide(hunks, "accepted"), {})
    assert "- y" not in out and "- x" in out


def test_identical_texts_have_no_hunks():
    hunks, segments = build_hunks(ORIG, ORIG)
    assert hunks == []
    assert assemble_final_text(segments, {}, {}).strip() == ORIG.strip()


def test_no_runaway_blank_lines_after_drops():
    hunks, segments = build_hunks("A\n\n- x\n\nB\n", "A\n\nB\n")
    out = assemble_final_text(segments, _decide(hunks, "accepted"), {})
    assert "\n\n\n" not in out


def test_database_errors_become_json_with_cors_and_name_a_missing_migration():
    """An unhandled PostgREST error must not look like a network failure to the browser."""
    import os
    os.environ.setdefault("SUPABASE_URL", "http://unused")
    os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "unused")
    from fastapi.testclient import TestClient
    from postgrest.exceptions import APIError
    from app.main import app

    @app.get("/__test/db-schema")
    def _schema():
        raise APIError({"message": "Could not find the 'webcam_mode' column of 'oa_assessments' in the schema cache", "code": "PGRST204"})

    @app.get("/__test/db-other")
    def _other():
        raise APIError({"message": "duplicate key", "code": "23505"})

    client = TestClient(app, raise_server_exceptions=False)
    r = client.get("/__test/db-schema", headers={"Origin": "http://localhost:8080"})
    assert r.status_code == 503
    assert r.headers["access-control-allow-origin"] == "http://localhost:8080"
    assert "migration" in r.json()["detail"] and "webcam_mode" in r.json()["detail"] and "reload schema" in r.json()["detail"]
    r = client.get("/__test/db-other", headers={"Origin": "http://localhost:8080"})
    assert r.status_code == 500 and r.headers["access-control-allow-origin"] == "http://localhost:8080"
    assert "duplicate key" not in r.json()["detail"]   # no internals leaked for other errors
