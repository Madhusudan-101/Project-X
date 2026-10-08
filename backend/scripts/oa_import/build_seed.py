#!/usr/bin/env python3
"""Turn extractor output into the committed seed + validate it.

    python build_seed.py <extracted.json> <out seed.json> [--solutions DIR]

For every extracted problem:
  * sanitise the HTML statement / constraints,
  * add Python starter code,
  * mark visible tests (the examples) and hidden tests (everything else),
  * VALIDATE: if solutions/<id>.py exists (written independently of the clone's
    own reference code), run it through the judge against every example and
    hidden test. Only problems whose solution passes everything get
    validated=true — companies can only pick validated problems.

Needs OA_JUDGE_BACKEND=local OA_ALLOW_LOCAL_JUDGE=1 (it executes the solutions).
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
os.environ.setdefault("SUPABASE_URL", "http://unused")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "unused")
os.environ.setdefault("OA_JUDGE_BACKEND", "local")
os.environ.setdefault("OA_ALLOW_LOCAL_JUDGE", "1")

from app.services.candidate import oa_judge  # noqa: E402
from app.utils.html_sanitize import sanitize_html  # noqa: E402


def key(args):
    return json.dumps(args, sort_keys=True, separators=(",", ":"))


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    sol_dir = Path(sys.argv[sys.argv.index("--solutions") + 1]) if "--solutions" in sys.argv else HERE / "solutions"
    problems = json.load(open(src))
    overrides = json.load(open(HERE / "problem_overrides.json")) if (HERE / "problem_overrides.json").exists() else {}
    result, report = [], {"validated": [], "unvalidated": [], "failed": {}}
    for p in problems:
        fixes = overrides.get(p["id"], {}).get("example_expected", {})
        visible = [{"args": e["args"], "expected": fixes.get(str(i), e["expected"])}
                   for i, e in enumerate(p["examples"])]
        if fixes:
            report.setdefault("example_fixes", []).append(p["id"])
        handler_by_args = {key(t["args"]): t["expected"] for t in p["tests"]}
        for e in visible:
            h = handler_by_args.get(key(e["args"]))
            if h is not None and not oa_judge.outputs_match(e["expected"], h, "unordered"):
                report.setdefault("example_vs_handler_disagree", {})[p["id"]] = {
                    "args": e["args"], "example_says": e["expected"], "handler_says": h}
        seen = {key(t["args"]) for t in visible}
        hidden = [t for t in p["tests"] if key(t["args"]) not in seen]
        tests = [{**t, "is_visible": True} for t in visible] + [{**t, "is_visible": False} for t in hidden]

        starter = dict(p["starter_code"])
        starter["python"] = oa_judge.python_starter(p["function_name"], p["params"])

        compare = overrides.get(p["id"], {}).get("compare", "exact")
        validated = False
        sol = sol_dir / f"{p['id']}.py"
        if p.get("transformed") and compare == "exact":
            # The clone's handler normalised results (sorted / reordered) before comparing,
            # so an exact comparison would fail correct answers. Needs an explicit
            # `compare: unordered` override after a human has read the statement.
            report["unvalidated"].append(p["id"] + " (normalised in the clone; needs compare override)")
        elif sol.exists():
            run = oa_judge.judge("python", sol.read_text(), p["function_name"],
                                 [{"args": t["args"], "expected": t["expected"]} for t in tests], compare)
            verdict = oa_judge.overall_verdict(run)
            if verdict == "accepted":
                extras = overrides.get(p["id"], {}).get("extra_tests", [])
                if extras:
                    # Expected values for the extra hidden tests come from the solution that
                    # just passed every clone-derived test.
                    ran = oa_judge.judge("python", sol.read_text(), p["function_name"], [{"args": a} for a in extras])
                    if oa_judge.overall_verdict(ran) != "accepted" or any(o.status != "ran" for o in ran.outcomes):
                        report["failed"][p["id"]] = {"verdict": "extra_tests_failed", "detail": ran.compile_error or ran.crash}
                        extras = None
                    else:
                        tests += [{"args": a, "expected": o.actual, "is_visible": False} for a, o in zip(extras, ran.outcomes)]
                        report.setdefault("extra_tests_added", {})[p["id"]] = len(extras)
                if extras is not None:
                    if not any(not t["is_visible"] for t in tests):
                        report["failed"][p["id"]] = {"verdict": "no_hidden_tests"}
                    else:
                        validated = True
                        report["validated"].append(p["id"])
            else:
                bad = [i for i, o in enumerate(run.outcomes) if o.status != "pass"]
                report["failed"][p["id"]] = {"verdict": verdict, "failing_cases": bad[:5],
                                             "detail": run.compile_error or run.crash}
        else:
            report["unvalidated"].append(p["id"])

        result.append({
            "id": p["id"], "title": p["title"], "difficulty": p["difficulty"], "topics": p["topics"],
            "statement_html": sanitize_html(p["statement_html"]),
            "constraints_html": sanitize_html(p["constraints_html"]),
            "function_name": p["function_name"], "params": p["params"],
            "starter_code": starter, "languages": ["javascript", "python"],
            "compare": compare, "validated": validated, "tests": tests,
        })
    json.dump(result, open(out, "w"), indent=1)
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in report.items()}, indent=1))
    if report["failed"]:
        print("FAILED VALIDATION:", json.dumps(report["failed"], indent=1))


if __name__ == "__main__":
    main()
