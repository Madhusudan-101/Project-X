"""Unit tests for pure helpers: email rules, HTML sanitiser, branch matching,
CSV roster parsing, profile-link extraction, practice ranking, resume diff."""
import pytest

from app.utils.email_rules import is_valid_email_format
from app.utils.html_sanitize import sanitize_html
from app.utils.college.branch import branch_matches, normalize_branch
from app.utils.college.csv_students import dedupe_by_email, parse_students_csv
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


def test_csv_happy_path_and_defaults():
    rows, bad = parse_students_csv((HEADER + "Ann,ANN@X.COM,CSE,2026,77.5,VERIFIED,placed\n").encode())
    assert bad == []
    r = rows[0]
    assert r["email"] == "ann@x.com"
    assert r["graduation_year"] == 2026
    assert r["employability_score"] == 77.5
    assert r["verification_status"] == "verified"
    assert r["placement_status"] == "placed"
    assert r["github_score"] == 0.0


def test_csv_invalid_enums_fall_back():
    rows, _ = parse_students_csv((HEADER + "A,a@x.com,CSE,2026,1,weird,nope\n").encode())
    assert rows[0]["verification_status"] == "pending"
    assert rows[0]["placement_status"] == "not_placed"


def test_csv_missing_required_reports_line_numbers():
    rows, bad = parse_students_csv((HEADER + "A,a@x.com,CSE,2026\n,b@x.com,CSE,2026\nC,,CSE,2026\n").encode())
    assert len(rows) == 1
    assert [b["line"] for b in bad] == [3, 4]
    assert bad[0]["missing"] == ["name"]
    assert bad[1]["missing"] == ["email"]


@pytest.mark.parametrize("year", ["soon", "0", "-5", "99999", "inf", "-inf", "nan", "1e999"])
def test_csv_bad_graduation_year_is_an_invalid_row_never_a_crash(year):
    rows, bad = parse_students_csv((HEADER + f"A,a@x.com,CSE,{year}\n").encode())
    assert rows == []
    assert bad[0]["missing"] == ["graduationYear"]


def test_csv_float_year_is_truncated():
    rows, _ = parse_students_csv((HEADER + "A,a@x.com,CSE,2026.0\n").encode())
    assert rows[0]["graduation_year"] == 2026


@pytest.mark.parametrize("val", ["inf", "nan", "-inf"])
def test_csv_non_finite_scores_are_neutralised(val):
    import math
    rows, _ = parse_students_csv((HEADER + f"A,a@x.com,CSE,2026,{val}\n").encode())
    assert math.isfinite(rows[0]["employability_score"])


def test_csv_bom_and_latin1():
    rows, _ = parse_students_csv("﻿".encode("utf-8") + (HEADER + "José,j@x.com,CSE,2026\n").encode())
    assert rows[0]["name"] == "José"
    rows, _ = parse_students_csv((HEADER + "Jos\xe9,j@x.com,CSE,2026\n").encode("latin-1"))
    assert rows[0]["name"] == "José"


def test_csv_extra_columns_and_short_rows_do_not_crash():
    rows, bad = parse_students_csv((HEADER + "A,a@x.com,CSE,2026,1,verified,placed,EXTRA,MORE\nB,b@x.com\n").encode())
    assert len(rows) == 1 and len(bad) == 1


def test_csv_empty_file():
    assert parse_students_csv(b"") == ([], [])


def test_dedupe_by_email_last_wins():
    out = dedupe_by_email([{"email": "a", "v": 1}, {"email": "b", "v": 1}, {"email": "a", "v": 2}])
    assert {r["email"]: r["v"] for r in out} == {"a": 2, "b": 1}


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
