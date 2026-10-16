#!/usr/bin/env python3
"""Add Java / C++ support to an existing seed file without rebuilding it.

    python scripts/oa_import/add_signatures.py [seed.json]

For every problem: infer the static signature from ALL its test cases, store it as
`signature`, and add "java" / "cpp" to `languages`. Problems whose data can't be typed
(null, objects, ragged arrays) are listed and left Python/JavaScript-only.
Idempotent. build_seed.py does the same thing when rebuilding from scratch.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
os.environ.setdefault("SUPABASE_URL", "http://unused")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "unused")

from app.services.candidate import oa_signature  # noqa: E402


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parents[1] / "db" / "seed" / "oa_problems.json"
    problems = json.load(open(path))
    skipped = {}
    for p in problems:
        try:
            sig = oa_signature.infer_signature(
                p["params"], [{"args": t["args"], "expected": t["expected"]} for t in p["tests"]])
        except ValueError as e:
            skipped[p["id"]] = str(e)
            sig = None
        p["signature"] = sig
        langs = [l for l in p["languages"] if l not in ("java", "cpp")]
        p["languages"] = langs + (["java", "cpp"] if sig else [])
    json.dump(problems, open(path, "w"), indent=1)
    print(f"{len(problems) - len(skipped)} problems typed, {len(skipped)} left without Java/C++")
    for k, v in skipped.items():
        print("  ·", k, "-", v)


if __name__ == "__main__":
    main()
