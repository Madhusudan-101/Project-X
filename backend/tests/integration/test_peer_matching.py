"""PeerMeet Phase 5: matching prefers a shared topic and people you have not just met, but never makes anyone wait."""
import pytest

from peer_support import consent, install_matcher, iso, now

U = ["ann", "ben", "cat", "dev"]


@pytest.fixture
def peer(env):
    install_matcher(env)
    env.h = {u: env.user(u, "candidate", profile={"name": u.title()}) for u in U}
    consent(env, *U)
    return env


def ask(env, who, **body):
    r = env.client.post("/candidate/peer-matchmaking/request", json=body, headers=env.h[who])
    assert r.status_code == 200, r.text
    return r.json()


def done(env, who):
    env.client.post("/candidate/peer-matchmaking/end", headers=env.h[who])


def partner_of(env, who):
    return env.db.one("peer_matchmaking_tickets", student_id=who, status="matched")["matched_with"]


def _waiting(peer, who, topic, created):
    peer.db.tables.setdefault("peer_matchmaking_tickets", []).append(
        {"id": f"t-{who}", "student_id": who, "status": "waiting", "keep_private": False, "topic": topic,
         "created_at": created, "last_seen_at": iso(now())}
    )


def test_a_shared_topic_is_preferred_over_who_waited_longest(peer):
    _waiting(peer, "ann", "design", "2000-01-01T00:00:00+00:00")     # waited longest, different topic
    _waiting(peer, "ben", "software", "2000-01-02T00:00:00+00:00")   # same topic as dev
    assert ask(peer, "dev", topic="software")["status"] == "matched"
    assert partner_of(peer, "dev") == "ben"
    # ann is still waiting, not stranded
    assert peer.db.one("peer_matchmaking_tickets", id="t-ann")["status"] == "waiting"


def test_without_a_shared_topic_the_longest_waiter_is_matched(peer):
    _waiting(peer, "ann", "design", "2000-01-01T00:00:00+00:00")
    _waiting(peer, "ben", "data", "2000-01-02T00:00:00+00:00")
    assert ask(peer, "dev", topic="software")["status"] == "matched"
    assert partner_of(peer, "dev") == "ann"


def test_a_different_topic_is_still_a_match_when_nobody_else_is_waiting(peer):
    ask(peer, "ann", topic="design")
    r = ask(peer, "ben", topic="software")
    assert r["status"] == "matched" and partner_of(peer, "ben") == "ann"


def test_someone_with_no_topic_matches_anyone_and_anyone_matches_them(peer):
    ask(peer, "ann")  # no topic
    assert ask(peer, "ben", topic="data")["status"] == "matched"
    done(peer, "ann"); done(peer, "ben")
    ask(peer, "cat", topic="product")
    assert ask(peer, "dev")["status"] == "matched"


def test_the_topic_is_validated_and_stored(peer):
    r = peer.client.post("/candidate/peer-matchmaking/request", json={"topic": "astrology"}, headers=peer.h["ann"])
    assert r.status_code == 422
    assert peer.db.rows("peer_matchmaking_tickets") == []
    ask(peer, "ann", topic="data")
    assert peer.db.one("peer_matchmaking_tickets", student_id="ann")["topic"] == "data"
    done(peer, "ann")
    ask(peer, "ann", topic="any")
    assert peer.db.rows("peer_matchmaking_tickets", student_id="ann", status="waiting")[0]["topic"] is None


def test_repeat_partners_are_avoided_when_someone_else_is_waiting(peer):
    # ann and ben met a minute ago
    ask(peer, "ben")
    ask(peer, "ann")
    done(peer, "ann"); done(peer, "ben")
    # now ben (older) and cat both wait; ann asks and should be paired with cat, not ben
    peer.db.tables["peer_matchmaking_tickets"].append(
        {"id": "t-ben", "student_id": "ben", "status": "waiting", "keep_private": False, "topic": None,
         "created_at": "2000-01-01T00:00:00+00:00", "last_seen_at": iso(now())}
    )
    peer.db.tables["peer_matchmaking_tickets"].append(
        {"id": "t-cat", "student_id": "cat", "status": "waiting", "keep_private": False, "topic": None,
         "created_at": "2000-01-02T00:00:00+00:00", "last_seen_at": iso(now())}
    )
    assert ask(peer, "ann")["status"] == "matched"
    assert peer.db.one("peer_matchmaking_tickets", id="t-cat")["status"] == "matched"
    assert peer.db.one("peer_matchmaking_tickets", id="t-ben")["status"] == "waiting"


def test_a_repeat_partner_is_still_matched_when_they_are_the_only_one_waiting(peer):
    ask(peer, "ben")
    ask(peer, "ann")
    done(peer, "ann"); done(peer, "ben")
    ask(peer, "ben")
    assert ask(peer, "ann")["status"] == "matched"
