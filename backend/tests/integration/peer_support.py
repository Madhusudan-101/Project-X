"""Shared test helpers for the PeerMeet backend tests."""
from datetime import datetime, timedelta, timezone


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


def now():
    return datetime.now(timezone.utc)


def install_matcher(env):
    """Mirrors claim_peer_matchmaking_ticket in peer_safety_migration.sql (the latest version of it)."""
    def claim(params):
        rows = env.db.tables.setdefault("peer_matchmaking_tickets", [])
        blocks = env.db.tables.get("peer_blocks", [])
        sanctions = env.db.tables.get("peer_sanctions", [])
        n = now()
        for r in rows:
            if r["status"] == "waiting":
                exp = r.get("expires_at")
                seen = datetime.fromisoformat(r["last_seen_at"]) if r.get("last_seen_at") else n
                if (exp and datetime.fromisoformat(exp) < n) or seen < n - timedelta(seconds=30):
                    r["status"] = "expired"
            if r["status"] == "matched":
                at = datetime.fromisoformat(r.get("matched_at") or r["created_at"])
                if at < n - timedelta(minutes=30):
                    r["status"] = "expired"

        me = params["p_student_id"]

        def blocked(other):
            return any((b["blocker_id"], b["blocked_id"]) in ((me, other), (other, me)) for b in blocks)

        def suspended(other):
            for s in sanctions:
                if s["student_id"] == other and s["kind"] == "suspension" and not s.get("lifted_at"):
                    ends = s.get("ends_at")
                    if ends is None or datetime.fromisoformat(ends) > n:
                        return True
            return False

        topic = params.get("p_topic")

        def met_recently(other):
            cutoff = n - timedelta(hours=24)
            for r in rows:
                at = r.get("matched_at")
                if not at or datetime.fromisoformat(at) <= cutoff:
                    continue
                if (r["student_id"] == me and r.get("matched_with") == other) or (r["student_id"] == other and r.get("matched_with") == me):
                    return True
            return False

        waiting = sorted(
            (r for r in rows if r["status"] == "waiting" and r["student_id"] != me
             and not blocked(r["student_id"]) and not suspended(r["student_id"])),
            key=lambda r: (
                met_recently(r["student_id"]),
                0 if (topic is None or r.get("topic") is None or r.get("topic") == topic) else 1,
                r["created_at"],
            ),
        )
        if not waiting:
            return []
        t = waiting[0]
        t.update(status="matched", room_id=params["p_room_id"], matched_with=me, matched_at=iso(n))
        return [{"ticket_id": t["id"], "peer_id": t["student_id"], "peer_private": bool(t.get("keep_private"))}]

    env.db.rpc_handlers["claim_peer_matchmaking_ticket"] = claim


def consent(env, *user_ids):
    """Record that these people accepted the CURRENT peer guidelines (the API refuses everything until then)."""
    from app.services.peer_safety import GUIDELINES_VERSION
    for uid in user_ids:
        env.db.add("peer_consents", id=uid, student_id=uid, version=GUIDELINES_VERSION,
                   accepted_rules=True, accepted_media=True, accepted_ai=True)
