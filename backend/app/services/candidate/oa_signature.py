"""Static types for the OA's function-style problems.

Problems are stored language-neutrally: parameter NAMES plus JSON test cases.
Python and JavaScript are dynamically typed so that is enough; Java and C++ need
real types in the starter code and in the grader's driver. We infer them from the
test data (`infer_signature`), store the result on the problem (`signature`) and
fall back to inferring from whatever cases are at hand when it isn't stored.

A type is a string: a base (`int`, `long`, `double`, `bool`, `string`) plus up to
three `[]` suffixes, e.g. `int[][]`.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

BASES = ("int", "long", "double", "bool", "string")
MAX_DEPTH = 3
INT_MIN, INT_MAX = -(2**31), 2**31 - 1

JAVA_BASE = {"int": "int", "long": "long", "double": "double", "bool": "boolean", "string": "String"}
CPP_BASE = {"int": "int", "long": "long long", "double": "double", "bool": "bool", "string": "string"}
JAVA_DEFAULT = {"int": "0", "long": "0L", "double": "0.0", "bool": "false", "string": "null"}
CPP_DEFAULT = {"int": "0", "long": "0", "double": "0.0", "bool": "false", "string": '""'}


def split_type(t: str) -> Tuple[str, int]:
    depth = 0
    while t.endswith("[]"):
        t, depth = t[:-2], depth + 1
    return t, depth


def join_type(base: str, depth: int) -> str:
    return base + "[]" * depth


def is_valid_type(t: Any) -> bool:
    if not isinstance(t, str):
        return False
    base, depth = split_type(t)
    return base in BASES and depth <= MAX_DEPTH


# ── Inference ───────────────────────────────────────────────────────

def _widen(a: Optional[str], b: Optional[str]) -> Optional[str]:
    """Merge two base types seen for the same slot (None = nothing seen yet)."""
    if a is None or a == b:
        return b if a is None else a
    if b is None:
        return a
    numeric = {"int": 0, "long": 1, "double": 2}
    if a in numeric and b in numeric:
        return a if numeric[a] >= numeric[b] else b
    raise ValueError(f"mixed types {a}/{b}")


def _scan(v: Any, depth: int, seen: Dict[str, Any]) -> None:
    """Record (base, depth) of one JSON value into `seen`."""
    if isinstance(v, list):
        if depth + 1 > MAX_DEPTH:
            raise ValueError("arrays nested deeper than 3")
        seen["depth"] = max(seen.get("depth", 0), depth + 1)
        for x in v:
            _scan(x, depth + 1, seen)
        return
    if v is None:
        raise ValueError("null")
    if isinstance(v, bool):
        base = "bool"
    elif isinstance(v, int):
        base = "int" if INT_MIN <= v <= INT_MAX else "long"
    elif isinstance(v, float):
        base = "double"
    elif isinstance(v, str):
        base = "string"
    else:
        raise ValueError(f"unsupported {type(v).__name__}")
    seen["base"] = _widen(seen.get("base"), base)
    seen["depth"] = max(seen.get("depth", 0), depth)
    seen.setdefault("leaf_depths", set()).add(depth)


def infer_type(values: List[Any]) -> Tuple[str, bool]:
    """Type of one slot across many values -> (type, certain).

    `certain` is False when nothing but empty arrays was seen, so the element type
    is a guess (defaults to int).
    """
    seen: Dict[str, Any] = {}
    for v in values:
        _scan(v, 0, seen)
    depth = seen.get("depth", 0)
    if len(seen.get("leaf_depths", {depth})) > 1:
        raise ValueError("ragged / mixed array depth")
    base = seen.get("base")
    return join_type(base or "int", depth), base is not None or not values


def infer_signature(params: List[str], cases: List[Dict[str, Any]]) -> Dict[str, Any]:
    """{"params": [...types], "returns": type, "guessed": [slot names with no evidence]}

    `cases` are {"args": [...], "expected": ...}; `expected` may be absent.
    Raises ValueError when the data can't be typed (null, dicts, mixed shapes).
    """
    types: List[str] = []
    guessed: List[str] = []
    for i, name in enumerate(params):
        t, certain = infer_type([c["args"][i] for c in cases])
        types.append(t)
        if not certain:
            guessed.append(name)
    expected = [c["expected"] for c in cases if "expected" in c]
    ret, certain = infer_type(expected)
    if not certain:
        guessed.append("<return>")
    return {"params": types, "returns": ret, "guessed": guessed}


def signature_for(problem: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The signature to use for a problem row as loaded by the API, or None.

    Prefers the stored one; otherwise infers from the problem's loaded example
    cases. The same function feeds the starter code AND the judge, so a candidate
    always compiles against the signature they were shown.
    """
    stored = problem.get("signature")
    params = problem.get("params") or []
    if isinstance(stored, dict) and is_valid_type(stored.get("returns")) \
            and len(stored.get("params") or []) == len(params) \
            and all(is_valid_type(t) for t in stored["params"]):
        return stored
    cases = [{"args": e["args"], "expected": e["expected"]} for e in (problem.get("examples") or [])]
    if not cases:
        return None
    try:
        return infer_signature(params, cases)
    except (ValueError, IndexError, TypeError):
        return None


# ── Starter code ────────────────────────────────────────────────────

def java_type(t: str) -> str:
    base, depth = split_type(t)
    return JAVA_BASE[base] + "[]" * depth


def cpp_type(t: str) -> str:
    base, depth = split_type(t)
    out = CPP_BASE[base]
    for _ in range(depth):
        out = f"vector<{out}>"
    return out


def java_default(t: str) -> str:
    base, depth = split_type(t)
    return "null" if depth else JAVA_DEFAULT[base]


def cpp_default(t: str) -> str:
    base, depth = split_type(t)
    return "{}" if depth else CPP_DEFAULT[base]


def java_starter(fn: str, params: List[str], sig: Dict[str, Any]) -> str:
    args = ", ".join(f"{java_type(t)} {p}" for p, t in zip(params, sig["params"]))
    ret = java_type(sig["returns"])
    return (
        "class Solution {\n"
        f"    public {ret} {fn}({args}) {{\n"
        "        // Write your code here\n"
        f"        return {java_default(sig['returns'])};\n"
        "    }\n"
        "}\n"
    )


def cpp_starter(fn: str, params: List[str], sig: Dict[str, Any]) -> str:
    def decl(p: str, t: str) -> str:
        ty = cpp_type(t)
        return f"{ty}& {p}" if split_type(t)[1] else f"{ty} {p}"

    args = ", ".join(decl(p, t) for p, t in zip(params, sig["params"]))
    return (
        "#include <bits/stdc++.h>\n"
        "using namespace std;\n"
        "\n"
        "class Solution {\n"
        "public:\n"
        f"    {cpp_type(sig['returns'])} {fn}({args}) {{\n"
        "        // Write your code here\n"
        f"        return {cpp_default(sig['returns'])};\n"
        "    }\n"
        "};\n"
    )
