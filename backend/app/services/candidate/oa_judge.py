"""Code judge for the Online Assessment.

Runs a candidate's function against test cases inside an isolated sandbox and
reports a verdict per case. All grading happens HERE, on the server — tests
(especially hidden ones) never reach the browser.

Backends (env `OA_JUDGE_BACKEND`):
  piston  production. A self-hosted Piston instance (see the clone repo's
          deploy/piston/README.md) reached at `OA_PISTON_URL`. Piston provides
          the sandbox: namespaces/cgroups, no network, memory + time limits.
  local   DEVELOPMENT / TESTS ONLY. Runs a subprocess on this machine with
          rlimits but NO real isolation. Refuses to start unless
          `OA_ALLOW_LOCAL_JUDGE=1` is also set. Never use it for real candidates.
  off     (default) no execution. Coding submissions are stored but not graded.

One sandbox call runs ALL cases of a submission (the clone repo made one HTTP
call per case). The candidate's code and the grader driver share a process, so
the driver reads its input from stdin BEFORE candidate code runs and keeps the
result channel (a per-run random nonce) out of reach of normal code. A
determined candidate could still introspect their way to it — treat verdicts as
strong evidence, not as tamper-proof, and review code for flagged attempts.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import secrets
import subprocess
import tempfile
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

from . import oa_drivers, oa_signature

log = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = ("javascript", "python", "java", "cpp")
TYPED_LANGUAGES = ("java", "cpp")   # need a static signature (see oa_signature)

PER_CASE_SECONDS = 2
RUN_TIMEOUT_SECONDS = 10
COMPILE_TIMEOUT_SECONDS = 20   # javac / g++ only
MAX_SOURCE_CHARS = 50_000
MAX_CAPTURED_STDOUT = 4_000
MEMORY_LIMIT_BYTES = 512 * 1024 * 1024


class JudgeUnavailable(Exception):
    """No judge configured, or it couldn't be reached."""


class JudgeBusy(Exception):
    """All judge slots are taken and the wait timed out."""


@dataclass
class CaseOutcome:
    index: int
    status: str            # pass | fail | error | timeout | ran (no expected supplied)
    actual: Any = None
    error: Optional[str] = None


@dataclass
class JudgeRun:
    compile_error: Optional[str] = None
    outcomes: List[CaseOutcome] = field(default_factory=list)
    stdout: str = ""
    crash: Optional[str] = None     # the process died before reporting (timeout / OOM / bad output)
    crash_kind: Optional[str] = None  # time_limit | runtime_error


# ── Config ──────────────────────────────────────────────────────────

def backend() -> str:
    return (os.getenv("OA_JUDGE_BACKEND") or "off").strip().lower()


def judge_enabled() -> bool:
    b = backend()
    if b == "piston":
        return bool(os.getenv("OA_PISTON_URL"))
    if b == "local":
        return os.getenv("OA_ALLOW_LOCAL_JUDGE") == "1"
    return False


_slots: Optional[threading.BoundedSemaphore] = None
_slots_size = 0


def _get_slots() -> threading.BoundedSemaphore:
    global _slots, _slots_size
    size = max(1, int(os.getenv("OA_JUDGE_CONCURRENCY") or 4))
    if _slots is None or size != _slots_size:
        _slots, _slots_size = threading.BoundedSemaphore(size), size
    return _slots


# ── Language helpers ────────────────────────────────────────────────

def snake_case(name: str) -> str:
    s = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s).lower()


def function_name_for(language: str, js_name: str) -> str:
    return snake_case(js_name) if language == "python" else js_name


def python_starter(js_name: str, params: List[str]) -> str:
    args = ", ".join(snake_case(p) for p in params)
    return f"def {snake_case(js_name)}({args}):\n    # Write your code here\n    pass\n"


def starter_for(language: str, js_name: str, params: List[str], stored: Dict[str, str],
                signature: Optional[Dict[str, Any]] = None) -> str:
    if language in stored:
        return stored[language]
    if language == "python":
        return python_starter(js_name, params)
    if language == "java" and signature:
        return oa_signature.java_starter(js_name, params, signature)
    if language == "cpp" and signature:
        return oa_signature.cpp_starter(js_name, params, signature)
    return f"function {js_name}({', '.join(params)}) {{\n  // Write your code here\n}}\n"


# ── Driver programs ─────────────────────────────────────────────────
# Both drivers: read stdin first -> run candidate code in an isolated namespace
# -> call the function per case -> print `<nonce><json>` as the LAST stdout line.

_PY_DRIVER = r'''
import sys, json, copy, signal, io, traceback
_payload = json.loads(sys.stdin.read())
sys.stdin = io.StringIO("")
_nonce, _cases, _per_case = _payload["nonce"], _payload["cases"], _payload["per_case"]
_real_out = sys.stdout
_cap = io.StringIO()
sys.stdout = _cap
_SOURCE = json.loads(%(source)s)
_FN = json.loads(%(fn)s)

def _emit(obj):
    obj["stdout"] = _cap.getvalue()[:%(cap)d]
    _real_out.write("\n" + _nonce + json.dumps(obj) + "\n")
    _real_out.flush()

def _main():
    ns = {"__name__": "__oa_solution__"}
    try:
        code = compile(_SOURCE, "solution.py", "exec")
    except SyntaxError as e:
        _emit({"compile_error": "SyntaxError: %%s (line %%s)" %% (e.msg, e.lineno)})
        return
    try:
        exec(code, ns)
    except BaseException as e:
        _emit({"compile_error": "%%s: %%s" %% (type(e).__name__, e)})
        return
    fn = ns.get(_FN)
    if not callable(fn):
        _emit({"compile_error": "Function '%%s' is not defined. Keep the function name from the starter code." %% _FN})
        return

    class _Timeout(Exception):
        pass
    def _on_alarm(signum, frame):
        raise _Timeout()
    if hasattr(signal, "SIGALRM"):
        signal.signal(signal.SIGALRM, _on_alarm)

    out = []
    for args in _cases:
        try:
            if hasattr(signal, "SIGALRM"):
                signal.alarm(_per_case)
            value = fn(*copy.deepcopy(args))
            if hasattr(signal, "SIGALRM"):
                signal.alarm(0)
            json.dumps(value)
            out.append({"ok": True, "value": value})
        except _Timeout:
            out.append({"ok": False, "timeout": True, "error": "Time limit exceeded"})
        except BaseException as e:
            if hasattr(signal, "SIGALRM"):
                signal.alarm(0)
            tb = traceback.extract_tb(e.__traceback__)
            line = next((f.lineno for f in reversed(tb) if f.filename == "solution.py"), None)
            msg = "%%s: %%s" %% (type(e).__name__, e)
            out.append({"ok": False, "error": msg + (" (line %%s)" %% line if line else "")})
    _emit({"results": out})

_main()
'''

_JS_DRIVER = r'''
const fs = require("fs");
const vm = require("vm");
const payload = JSON.parse(fs.readFileSync(0, "utf8"));
const nonce = payload.nonce, cases = payload.cases, perCase = payload.per_case * 1000;
const SOURCE = JSON.parse(%(source)s);
const FN = JSON.parse(%(fn)s);
const realWrite = process.stdout.write.bind(process.stdout);
let captured = "";
const sandbox = {
  console: { log: (...a) => { if (captured.length < %(cap)d) captured += a.map(String).join(" ") + "\n"; } },
};
sandbox.console.error = sandbox.console.warn = sandbox.console.info = sandbox.console.log;
function emit(obj) {
  obj.stdout = captured.slice(0, %(cap)d);
  realWrite("\n" + nonce + JSON.stringify(obj) + "\n");
}
const ctx = vm.createContext(sandbox);
try {
  new vm.Script(SOURCE, { filename: "solution.js" });
} catch (e) {
  emit({ compile_error: "SyntaxError: " + e.message });
  process.exit(0);
}
try {
  vm.runInContext(SOURCE, ctx, { timeout: perCase, filename: "solution.js" });
} catch (e) {
  emit({ compile_error: (e && e.name ? e.name : "Error") + ": " + (e && e.message) });
  process.exit(0);
}
let fn;
try { fn = vm.runInContext("typeof " + FN + " === 'function' ? " + FN + " : undefined", ctx); } catch (e) { fn = undefined; }
if (typeof fn !== "function") {
  emit({ compile_error: "Function '" + FN + "' is not defined. Keep the function name from the starter code." });
  process.exit(0);
}
const out = [];
for (const args of cases) {
  try {
    ctx.__args = JSON.parse(JSON.stringify(args));
    const value = vm.runInContext(FN + "(...__args)", ctx, { timeout: perCase, filename: "solution.js" });
    const text = JSON.stringify(value === undefined ? null : value);
    out.push({ ok: true, value: JSON.parse(text) });
  } catch (e) {
    const msg = e && e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? null : (e && e.name ? e.name + ": " + e.message : String(e));
    out.push(msg === null ? { ok: false, timeout: true, error: "Time limit exceeded" } : { ok: false, error: msg });
  }
}
emit({ results: out });
'''


@dataclass
class Program:
    text: str
    filename: str
    line_offset: int = 0      # candidate line N appears at line N + line_offset in `text`
    cand_lines: int = 0


def build_program(language: str, source: str, function_name: str,
                  signature: Optional[Dict[str, Any]] = None) -> Program:
    if language in TYPED_LANGUAGES:
        if not signature:
            raise JudgeUnavailable(f"{language} isn't available for this problem (its argument types are unknown).")
        if language == "java":
            text, off, n = oa_drivers.java_program(source, function_name, signature, MAX_CAPTURED_STDOUT)
            return Program(text, "Main.java", off, n)
        text, off, n = oa_drivers.cpp_program(source, function_name, signature, MAX_CAPTURED_STDOUT)
        return Program(text, "solution.cpp", off, n)
    fmt = {"source": json.dumps(json.dumps(source)), "fn": json.dumps(json.dumps(function_name)),
           "cap": MAX_CAPTURED_STDOUT}
    if language == "python":
        return Program(_PY_DRIVER % fmt, "main.py")
    if language == "javascript":
        return Program(_JS_DRIVER % fmt, "main.js")
    raise ValueError(f"unsupported language {language}")


# ── Comparison ──────────────────────────────────────────────────────

def values_equal(a: Any, b: Any) -> bool:
    """Strict JSON equality: bool != number, ints/floats compared with a tiny tolerance."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(values_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(values_equal(a[k], b[k]) for k in a)
    return type(a) == type(b) and a == b


def canonical(v: Any) -> Any:
    """Order-insensitive form: every list sorted (recursively) by its JSON text."""
    if isinstance(v, list):
        return sorted((canonical(x) for x in v), key=lambda x: json.dumps(x, sort_keys=True, separators=(",", ":")))
    if isinstance(v, dict):
        return {k: canonical(x) for k, x in v.items()}
    return v


def outputs_match(actual: Any, expected: Any, compare: str = "exact") -> bool:
    if compare == "unordered":
        return values_equal(canonical(actual), canonical(expected))
    return values_equal(actual, expected)


# ── Backends ────────────────────────────────────────────────────────

_PISTON_LANG = {"python": "python", "javascript": "javascript", "java": "java", "cpp": "c++"}


def _run_piston(language: str, prog: Program, stdin: str) -> Dict[str, Any]:
    url = os.getenv("OA_PISTON_URL", "").rstrip("/")
    headers = {"Content-Type": "application/json"}
    if os.getenv("OA_PISTON_TOKEN"):
        headers["Authorization"] = os.environ["OA_PISTON_TOKEN"]
    typed = language in TYPED_LANGUAGES
    body = {
        "language": _PISTON_LANG[language],
        "version": "*",
        "files": [{"name": prog.filename, "content": prog.text}],
        "stdin": stdin,
        "compile_timeout": COMPILE_TIMEOUT_SECONDS * 1000,
        "run_timeout": RUN_TIMEOUT_SECONDS * 1000,
        "run_memory_limit": MEMORY_LIMIT_BYTES,
    }
    try:
        res = httpx.post(f"{url}/api/v2/execute", json=body, headers=headers,
                         timeout=RUN_TIMEOUT_SECONDS + (COMPILE_TIMEOUT_SECONDS if typed else 0) + 10)
    except httpx.HTTPError as e:
        raise JudgeUnavailable(f"Couldn't reach the code execution service: {e.__class__.__name__}") from e
    if res.status_code >= 500 or res.status_code in (401, 403, 429):
        raise JudgeUnavailable(f"Code execution service returned {res.status_code}")
    if res.status_code >= 400:
        raise JudgeUnavailable("Code execution service rejected the request (is the language installed?)")
    payload = res.json() or {}
    comp = payload.get("compile") or {}
    if typed and comp.get("code") not in (None, 0):
        return {"stdout": "", "stderr": "", "code": None, "timed_out": False,
                "compile_failed": (comp.get("stderr") or comp.get("output") or comp.get("stdout") or "Compilation failed.")}
    run = payload.get("run") or {}
    return {
        "stdout": run.get("stdout") or "",
        "stderr": run.get("stderr") or "",
        "code": run.get("code"),
        "timed_out": run.get("status") == "TO" or (run.get("signal") == "SIGKILL" and not run.get("stdout")),
    }


def _run_local(language: str, prog: Program, stdin: str) -> Dict[str, Any]:
    if os.getenv("OA_ALLOW_LOCAL_JUDGE") != "1":
        raise JudgeUnavailable("Local judge is disabled.")
    import resource  # POSIX only; local judge is a dev tool

    def limits(address_space: bool = True) -> Any:
        def apply() -> None:
            if address_space:
                resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT_BYTES * 2, MEMORY_LIMIT_BYTES * 2))
            resource.setrlimit(resource.RLIMIT_CPU, (RUN_TIMEOUT_SECONDS * 2, RUN_TIMEOUT_SECONDS * 2 + 1))
            resource.setrlimit(resource.RLIMIT_FSIZE, (64 << 20, 64 << 20))
        return apply

    with tempfile.TemporaryDirectory(prefix="oa_judge_") as tmp:
        env = {"PATH": os.environ.get("PATH", ""), "HOME": tmp, "LANG": "C.UTF-8"}
        path = os.path.join(tmp, prog.filename)
        with open(path, "w", encoding="utf-8") as f:
            f.write(prog.text)
        if language == "python":
            cmd, address_space = ["python3", "-I", path], True
        elif language == "javascript":
            cmd, address_space = ["node", path], True
        else:
            if language == "java":
                build = ["javac", "-nowarn", "-d", tmp, path]
                cmd, address_space = ["java", "-Xss16m", "-Xmx512m", "-cp", tmp, "Main"], False
            else:
                exe = os.path.join(tmp, "solution")
                build = ["g++", "-std=c++17", "-O2", "-o", exe, path]
                cmd, address_space = [exe], True
            try:
                c = subprocess.run(build, capture_output=True, text=True, cwd=tmp, env=env,
                                   timeout=COMPILE_TIMEOUT_SECONDS * 2)
            except subprocess.TimeoutExpired:
                return {"stdout": "", "stderr": "", "code": None, "timed_out": False,
                        "compile_failed": "Compilation timed out."}
            if c.returncode != 0:
                return {"stdout": "", "stderr": "", "code": None, "timed_out": False,
                        "compile_failed": c.stderr or c.stdout or "Compilation failed."}
        try:
            p = subprocess.run(
                cmd, input=stdin, capture_output=True, text=True, cwd=tmp,
                timeout=RUN_TIMEOUT_SECONDS, preexec_fn=limits(address_space), env=env,
            )
        except subprocess.TimeoutExpired:
            return {"stdout": "", "stderr": "", "code": None, "timed_out": True}
    return {"stdout": p.stdout, "stderr": p.stderr, "code": p.returncode, "timed_out": False}


# ── Public entry point ──────────────────────────────────────────────

def judge(language: str, source: str, function_name: str, cases: List[Dict[str, Any]],
          compare: str = "exact", signature: Optional[Dict[str, Any]] = None) -> JudgeRun:
    """Run `source` against `cases` (each {"args": [...], "expected": <json>?}).

    Raises JudgeUnavailable / JudgeBusy; never raises for bad candidate code —
    that comes back as compile_error / per-case error outcomes.
    """
    if language not in SUPPORTED_LANGUAGES:
        raise JudgeUnavailable(f"{language} isn't supported yet.")
    if not judge_enabled():
        raise JudgeUnavailable("Code execution isn't configured on this server.")
    if len(source) > MAX_SOURCE_CHARS:
        return JudgeRun(compile_error=f"Source is too large (limit {MAX_SOURCE_CHARS} characters).")

    nonce = "@@OA" + secrets.token_hex(12) + "@@"
    stdin = json.dumps({"nonce": nonce, "cases": [c["args"] for c in cases], "per_case": PER_CASE_SECONDS})
    if language in TYPED_LANGUAGES and signature is None:
        try:   # callers should pass the signature the candidate was shown; this is the fallback
            signature = oa_signature.infer_signature(
                [f"p{i}" for i in range(len(cases[0]["args"]))] if cases else [], cases)
        except (ValueError, IndexError, TypeError):
            signature = None
    program = build_program(language, source, function_name_for(language, function_name), signature)

    slots = _get_slots()
    if not slots.acquire(timeout=float(os.getenv("OA_JUDGE_QUEUE_WAIT") or 20)):
        raise JudgeBusy()
    try:
        raw = _run_piston(language, program, stdin) if backend() == "piston" else _run_local(language, program, stdin)
    finally:
        slots.release()

    run = JudgeRun()
    if raw.get("compile_failed") is not None:
        run.compile_error = oa_drivers.clean_compile_error(
            language, raw["compile_failed"], program.line_offset, program.cand_lines, source)
        return run
    line = next((ln for ln in reversed(raw["stdout"].splitlines()) if ln.startswith(nonce)), None)
    if line is None:
        run.crash_kind = "time_limit" if raw["timed_out"] else "runtime_error"
        tail = (raw["stderr"] or "").strip().splitlines()[-3:]
        run.crash = "Time limit exceeded" if raw["timed_out"] else (
            "Your program stopped before finishing" + (": " + " | ".join(tail) if tail else "."))
        return run
    try:
        payload = json.loads(line[len(nonce):])
    except json.JSONDecodeError:
        run.crash_kind, run.crash = "runtime_error", "The program produced unreadable output."
        return run

    run.stdout = payload.get("stdout", "")
    if payload.get("compile_error"):
        run.compile_error = payload["compile_error"]
        return run
    for i, (case, res) in enumerate(zip(cases, payload.get("results", []))):
        if not res.get("ok"):
            run.outcomes.append(CaseOutcome(i, "timeout" if res.get("timeout") else "error", error=res.get("error")))
        elif "expected" not in case:
            run.outcomes.append(CaseOutcome(i, "ran", actual=res.get("value")))
        else:
            ok = outputs_match(res.get("value"), case["expected"], compare)
            run.outcomes.append(CaseOutcome(i, "pass" if ok else "fail", actual=res.get("value")))
    return run


def overall_verdict(run: JudgeRun) -> str:
    if run.compile_error:
        return "compile_error"
    if run.crash_kind:
        return run.crash_kind
    for o in run.outcomes:
        if o.status == "timeout":
            return "time_limit"
        if o.status == "error":
            return "runtime_error"
        if o.status == "fail":
            return "wrong_answer"
    return "accepted"
