#!/usr/bin/env python3
"""Smoke-test the configured code judge (OA_JUDGE_BACKEND).

    cd backend && python scripts/check_judge.py

Runs a correct solution, a wrong one, a syntax error and an infinite loop in each
language and checks the verdicts. Exit code 0 only if everything behaves.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("SUPABASE_URL", "http://unused")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "unused")

from app.services.candidate import oa_judge as j  # noqa: E402

CASES = [{"args": [[2, 7, 11, 15], 9], "expected": [0, 1]}, {"args": [[3, 2, 4], 6], "expected": [1, 2]}]
PY = {
    "good": "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen: return [seen[target - n], i]\n        seen[n] = i\n",
    "wrong": "def two_sum(nums, target):\n    return [0, 0]\n",
    "syntax": "def two_sum(:\n",
    "loop": "def two_sum(nums, target):\n    while True: pass\n",
}
JS = {
    "good": "function twoSum(nums, target) { const m = new Map(); for (let i = 0; i < nums.length; i++) { if (m.has(target - nums[i])) return [m.get(target - nums[i]), i]; m.set(nums[i], i); } }",
    "wrong": "function twoSum(nums, target) { return [0, 0]; }",
    "syntax": "function twoSum( {",
    "loop": "function twoSum(nums, target) { while (true) {} }",
}
EXPECT = {"good": "accepted", "wrong": "wrong_answer", "syntax": "compile_error", "loop": "time_limit"}


def main() -> int:
    print(f"backend={j.backend()} enabled={j.judge_enabled()}")
    if not j.judge_enabled():
        print("Judge is not enabled. Set OA_JUDGE_BACKEND=piston and OA_PISTON_URL (see deploy/piston/README.md).")
        return 2
    ok = True
    for lang, progs in (("python", PY), ("javascript", JS)):
        for name, src in progs.items():
            try:
                verdict = j.overall_verdict(j.judge(lang, src, "twoSum", CASES))
            except Exception as e:  # noqa: BLE001
                verdict = f"ERROR {e.__class__.__name__}: {e}"
            good = verdict == EXPECT[name]
            ok &= good
            print(f"{'PASS' if good else 'FAIL'}  {lang:<10} {name:<7} -> {verdict}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
