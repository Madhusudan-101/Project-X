# reporting.py
# Delivers a finished interview report to the Mirracle backend. The worker has
# no database access on purpose: it only holds a shared secret that is good for
# this one endpoint, and the backend decides which student the report belongs to
# (from the session it created when the interview started).
import os
import time

import httpx

MAX_ATTEMPTS = 4


def submit_report(payload: dict) -> bool:
    """POST the report; retries with backoff. Returns True on success.

    Blocking by design: call it from sync code (the graph runs in a worker
    thread) or via asyncio.to_thread. The backend upserts by room_id, so a retry
    after a timeout cannot create a duplicate.
    """
    base = (os.getenv("MIRRACLE_WEBHOOK_URL") or "").rstrip("/")
    secret = os.getenv("AI_INTERVIEW_SHARED_SECRET")
    if not base or not secret or not payload.get("room_id"):
        print("Report not submitted: MIRRACLE_WEBHOOK_URL / AI_INTERVIEW_SHARED_SECRET / room_id missing")
        return False

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            res = httpx.post(
                f"{base}/internal/ai-interview-reports",
                json=payload,
                headers={"Authorization": f"Bearer {secret}"},
                timeout=15.0,
            )
            if res.status_code < 300:
                print(f"Report submitted for {payload['room_id']}")
                return True
            # 4xx other than 429 will not get better by retrying.
            if res.status_code < 500 and res.status_code != 429:
                print(f"Report rejected ({res.status_code}): {res.text[:200]}")
                return False
            print(f"Report submit attempt {attempt}/{MAX_ATTEMPTS} failed: HTTP {res.status_code}")
        except httpx.HTTPError as exc:
            print(f"Report submit attempt {attempt}/{MAX_ATTEMPTS} failed: {exc}")
        if attempt < MAX_ATTEMPTS:
            time.sleep(2 ** attempt)
    return False
