"""Unit tests: profile-metric formatting (GitHub / LeetCode / Codeforces activity maths) and the
mock-interview confidence signal used by job scoring."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services.candidate import formatter as F
from app.services.candidate import interview_signal_service as S

TODAY = datetime.now(timezone.utc).date()


def d(n): return TODAY - timedelta(days=n)


# ── activity maths ──────────────────────────────────────────────────
def test_activity_empty():
    a = F._compute_activity_metrics({})
    assert a.total_events == 0 and a.longest_streak_days == 0 and a.current_streak_days == 0


def test_activity_single_day():
    a = F._compute_activity_metrics({d(0): 3})
    assert (a.total_events, a.unique_active_days, a.longest_streak_days, a.current_streak_days) == (3, 1, 1, 1)
    assert a.busiest_single_day == {"date": d(0).isoformat(), "count": 3}


def test_activity_streaks_gaps_and_spikes():
    counts = {d(10): 1, d(9): 2, d(8): 12, d(3): 1, d(1): 4, d(0): 1}
    a = F._compute_activity_metrics(counts)
    assert a.longest_streak_days == 3            # d10..d8
    assert a.current_streak_days == 2            # d1, d0
    assert a.largest_gap_days == 5               # d8 -> d3
    assert a.days_with_10plus == 1
    assert a.busiest_single_day["count"] == 12
    assert a.avg_per_active_day == round(21 / 6, 2)
    assert sum(a.day_of_week_distribution.values()) == 21


def test_current_streak_counts_from_yesterday_when_nothing_today():
    a = F._compute_activity_metrics({d(2): 1, d(1): 1})
    assert a.current_streak_days == 2
    a = F._compute_activity_metrics({d(3): 1, d(2): 1})
    assert a.current_streak_days == 0


@pytest.mark.parametrize("bad", ["", None, "not-a-date", [], {}, True, 1e300])
def test_iso_to_date_never_raises(bad):
    assert F._iso_to_date(bad) is None


def test_iso_to_date_accepts_epoch_seconds():
    assert F._iso_to_date(1767225600) == date(2026, 1, 1)


def test_iso_to_date_parses_z_and_offsets():
    assert F._iso_to_date("2026-01-02T03:04:05Z") == date(2026, 1, 2)
    assert F._iso_to_date("2026-01-02T23:30:00-05:00") == date(2026, 1, 2)


# ── LeetCode ────────────────────────────────────────────────────────
def test_leetcode_difficulty_ratio_and_calendar():
    ts = int(datetime(2026, 1, 5, 12, tzinfo=timezone.utc).timestamp())
    m = F.format_for_analysis(leetcode_raw={
        "ac_stats": [{"difficulty": "All", "count": 100}, {"difficulty": "Easy", "count": 50},
                     {"difficulty": "Medium", "count": 40}, {"difficulty": "Hard", "count": 10}],
        "submission_calendar": {str(ts): 3, str(ts + 86400): 0, "garbage": 2},
    }).leetcode
    assert (m.total_solved, m.easy, m.medium, m.hard) == (100, 50, 40, 10)
    assert m.easy_medium_hard_ratio == "50:40:10"
    assert m.submission_activity.total_events == 3 and m.submission_activity.unique_active_days == 1


def test_leetcode_zero_solved_does_not_divide_by_zero():
    m = F.format_for_analysis(leetcode_raw={"ac_stats": [], "submission_calendar": {}}).leetcode
    assert m.total_solved == 0 and m.easy_medium_hard_ratio == "0:0:0"


def test_leetcode_topic_tags_carried_through():
    m = F.format_for_analysis(leetcode_raw={"ac_stats": [], "topic_tags": {
        "fundamental": [{"tagName": "Array", "problemsSolved": 5}], "intermediate": [], "advanced": []}}).leetcode
    assert m.topic_tags.fundamental[0].tagName == "Array"


# ── GitHub ──────────────────────────────────────────────────────────
def test_github_repo_classification_and_push_events():
    now = datetime.now(timezone.utc)
    m = F.format_for_analysis(github_raw={
        "profile": {"created_at": (now - timedelta(days=400)).isoformat()},
        "repos": [
            {"name": "a", "fork": False, "stargazers_count": 5, "language": "Python", "pushed_at": now.isoformat()},
            {"name": "b", "fork": True, "stargazers_count": 1, "language": "Python"},
            {"name": "c", "fork": False, "stargazers_count": 0, "language": "Go"},
        ],
        "events": [
            {"type": "PushEvent", "created_at": now.isoformat(), "repo": {"name": "u/a"}, "payload": {"size": 3}},
            {"type": "WatchEvent", "created_at": now.isoformat()},
        ],
    }).github
    dumped = m.model_dump()
    assert 399 <= dumped["account_age_days"] <= 401
    assert dumped["fork_ratio"] == 0.33
    assert dumped["total_stars_received"] == 6
    assert dumped["top_languages"][0] == "Python"


def test_github_empty_payload_is_safe():
    m = F.format_for_analysis(github_raw={"profile": {}, "repos": [], "events": []}).github
    assert m.model_dump()["fork_ratio"] == 0.0


def test_format_for_analysis_skips_missing_sources():
    m = F.format_for_analysis()
    assert m.github is None and m.leetcode is None and m.codeforces is None


# ── Codeforces ──────────────────────────────────────────────────────
def test_codeforces_tags_ratings_and_history():
    m = F.format_for_analysis(codeforces_raw={
        "handle": "tourist",
        "info": {"handle": "tourist", "rating": 3800, "maxRating": 4000, "rank": "legendary grandmaster"},
        "solved_problems": [{"name": "A", "rating": 800, "tags": ["math"], "solved_at": "2026-01-01"},
                            {"name": "B", "rating": 1200, "tags": ["math", "dp"], "solved_at": "2026-01-02"},
                            {"name": "C", "tags": ["dp"]}],
        "submission_dates": ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "bad"],
        "rating_history": [{"contestName": "Round 1", "ratingUpdateTimeSeconds": "2026-01-03T00:00:00Z",
                            "oldRating": 1500, "newRating": 1600, "rank": 12}],
    }).codeforces
    assert m.total_solved == 3 and m.avg_problem_rating == 1000
    assert set(m.top_tags) == {"math", "dp"}
    assert m.rating_history[0].date == "2026-01-03"
    assert m.solved_problems[0].name == "B"       # most recent first
    assert m.submission_activity.unique_active_days == 2


def test_codeforces_raw_epoch_seconds_do_not_crash():
    m = F.format_for_analysis(codeforces_raw={"rating_history": [{"contestName": "R", "ratingUpdateTimeSeconds": 1767225600}]}).codeforces
    assert m.rating_history[0].contest_name == "R"


# ── mock-interview signal ───────────────────────────────────────────
class _Q:
    def __init__(self, rows): self.rows = rows
    def __getattr__(self, _): return lambda *a, **k: self
    def execute(self): return SimpleNamespace(data=self.rows)


def _with(monkeypatch, rows):
    monkeypatch.setattr(S, "db_client", SimpleNamespace(table=lambda n: _Q(rows)))


def _s(score, completed=True, i=0):
    return {"completed": completed, "overall_score": score, "created_at": f"2026-01-{30 - i:02d}T00:00:00Z"}


def test_signal_none_without_completed_scored_sessions(monkeypatch):
    _with(monkeypatch, [])
    assert S.get_mock_interview_signal("x") is None
    _with(monkeypatch, [_s(80, completed=False), _s(None)])
    assert S.get_mock_interview_signal("x") is None


def test_single_session_is_low_confidence(monkeypatch):
    _with(monkeypatch, [_s(90)])
    out = S.get_mock_interview_signal("x")
    assert out == {"score": 90, "confidence": "low", "attempts_counted": 1, "most_recent_at": "2026-01-30T00:00:00Z"}


def test_tight_cluster_is_high_and_wide_spread_is_low(monkeypatch):
    _with(monkeypatch, [_s(80, i=0), _s(82, i=1), _s(79, i=2)])
    assert S.get_mock_interview_signal("x")["confidence"] == "high"
    _with(monkeypatch, [_s(95, i=0), _s(30, i=1), _s(70, i=2)])
    assert S.get_mock_interview_signal("x")["confidence"] == "low"


def test_recent_sessions_weigh_more(monkeypatch):
    _with(monkeypatch, [_s(100, i=0), _s(0, i=1)])          # newest first
    assert S.get_mock_interview_signal("x")["score"] > 50


def test_abandoning_most_sessions_downgrades_confidence(monkeypatch):
    rows = [_s(80, i=0), _s(81, i=1)] + [_s(None, completed=False, i=k) for k in range(2, 7)]
    _with(monkeypatch, rows)
    assert S.get_mock_interview_signal("x")["confidence"] == "medium"     # high -> medium


def test_db_error_returns_none(monkeypatch):
    from postgrest.exceptions import APIError

    class Boom(_Q):
        def execute(self): raise APIError({"message": "down", "code": "XX"})
    monkeypatch.setattr(S, "db_client", SimpleNamespace(table=lambda n: Boom([])))
    assert S.get_mock_interview_signal("x") is None
