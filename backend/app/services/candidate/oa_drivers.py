"""Grader programs for the statically-typed languages (Java, C++).

Each `*_program()` wraps the candidate's source and a driver into ONE source file.
The driver reads {nonce, cases, per_case} as JSON from stdin BEFORE any candidate
code runs, calls `Solution.<fn>(...)` once per case with typed arguments built from
the JSON, and prints `<nonce><json>` as the last stdout line — the same protocol the
Python and JavaScript drivers use, so `oa_judge.judge` treats all four alike.

The wrappers know the signature (see oa_signature), so the argument conversion and
the call are generated code, e.g. `sol.twoSum(OAJ.c_int_1(a.get(0)), OAJ.c_int_0(a.get(1)))`.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from .oa_signature import BASES, JAVA_BASE, MAX_DEPTH, cpp_type, split_type

# ═════════════════════════════════════════════════════════════════════
# Java
# ═════════════════════════════════════════════════════════════════════

_JAVA_PRELUDE_LINES = 6   # candidate source starts on line 7 of Main.java

_JAVA_HEAD = (
    "import java.util.*;\n"
    "import java.util.function.*;\n"
    "import java.util.stream.*;\n"
    "import java.io.*;\n"
    "import java.math.*;\n"
    "@@HOISTED@@\n"
)

_JAVA_DRIVER = r'''
final class OAJ {
  static final int CAP = @@CAP@@;
  final String s; int i = 0;
  OAJ(String s) { this.s = s; }
  static Object parse(String s) { return new OAJ(s).val(); }
  void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
  String str() {
    i++; StringBuilder b = new StringBuilder();
    while (true) {
      char c = s.charAt(i++);
      if (c == '"') break;
      if (c == '\\') {
        char d = s.charAt(i++);
        switch (d) {
          case 'n': b.append('\n'); break;
          case 't': b.append('\t'); break;
          case 'r': b.append('\r'); break;
          case 'b': b.append('\b'); break;
          case 'f': b.append('\f'); break;
          case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
          default: b.append(d);
        }
      } else b.append(c);
    }
    return b.toString();
  }
  Object val() {
    ws(); char c = s.charAt(i);
    if (c == '{') {
      Map<String, Object> m = new LinkedHashMap<>(); i++; ws();
      if (s.charAt(i) == '}') { i++; return m; }
      while (true) { ws(); String k = str(); ws(); i++; m.put(k, val()); ws(); if (s.charAt(i++) == '}') break; }
      return m;
    }
    if (c == '[') {
      List<Object> l = new ArrayList<>(); i++; ws();
      if (s.charAt(i) == ']') { i++; return l; }
      while (true) { l.add(val()); ws(); if (s.charAt(i++) == ']') break; }
      return l;
    }
    if (c == '"') return str();
    if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
    if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
    if (s.startsWith("null", i)) { i += 4; return null; }
    int j = i; while (j < s.length() && "+-0123456789.eE".indexOf(s.charAt(j)) >= 0) j++;
    String t = s.substring(i, j); i = j;
    if (t.indexOf('.') < 0 && t.indexOf('e') < 0 && t.indexOf('E') < 0) {
      try { return Long.parseLong(t); } catch (NumberFormatException e) { return Double.parseDouble(t); }
    }
    return Double.parseDouble(t);
  }
  static int c_int_0(Object o) { return ((Number) o).intValue(); }
  static long c_long_0(Object o) { return ((Number) o).longValue(); }
  static double c_double_0(Object o) { return ((Number) o).doubleValue(); }
  static boolean c_bool_0(Object o) { return (Boolean) o; }
  static String c_string_0(Object o) { return (String) o; }
@@CONVERTERS@@
  static void q(StringBuilder b, String v) {
    b.append('"');
    for (int k = 0; k < v.length(); k++) {
      char c = v.charAt(k);
      switch (c) {
        case '"': b.append("\\\""); break;
        case '\\': b.append("\\\\"); break;
        case '\n': b.append("\\n"); break;
        case '\r': b.append("\\r"); break;
        case '\t': b.append("\\t"); break;
        default:
          if (c < 0x20 || c > 0x7e) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
      }
    }
    b.append('"');
  }
  static void w(StringBuilder b, Object v) {
    if (v == null) { b.append("null"); return; }
    if (v instanceof String) { q(b, (String) v); return; }
    if (v instanceof Boolean) { b.append(v); return; }
    if (v instanceof Double || v instanceof Float) {
      double d = ((Number) v).doubleValue();
      if (Double.isNaN(d) || Double.isInfinite(d)) b.append("null"); else b.append(d);
      return;
    }
    if (v instanceof Number) { b.append(v); return; }
    if (v.getClass().isArray()) {
      int n = java.lang.reflect.Array.getLength(v); b.append('[');
      for (int k = 0; k < n; k++) { if (k > 0) b.append(','); w(b, java.lang.reflect.Array.get(v, k)); }
      b.append(']'); return;
    }
    b.append("null");
  }
  static final class Cap extends OutputStream {
    final ByteArrayOutputStream bo = new ByteArrayOutputStream();
    public synchronized void write(int b) { if (bo.size() < CAP) bo.write(b); }
    public synchronized void write(byte[] x, int o, int l) { int room = CAP - bo.size(); if (room > 0) bo.write(x, o, Math.min(room, l)); }
  }
}

public class Main {
  public static void main(String[] argv) throws Exception {
    final PrintStream real = System.out;
    String in = new String(System.in.readAllBytes(), "UTF-8");
    Map<?, ?> payload = (Map<?, ?>) OAJ.parse(in);
    String nonce = (String) payload.get("nonce");
    List<?> cases = (List<?>) payload.get("cases");
    long perCaseMs = ((Number) payload.get("per_case")).longValue() * 1000L;
    OAJ.Cap cap = new OAJ.Cap();
    PrintStream sink = new PrintStream(cap, true, "UTF-8");
    System.setOut(sink); System.setErr(sink);
    StringBuilder out = new StringBuilder("{\"results\":[");
    for (int ci = 0; ci < cases.size(); ci++) {
      final List<?> a = (List<?>) cases.get(ci);
      final Object[] res = new Object[1];
      final Throwable[] err = new Throwable[1];
      Thread t = new Thread(null, () -> {
        try {
          Solution sol = new Solution();
          res[0] = sol.@@CALL@@;
        } catch (Throwable e) { err[0] = e; }
      }, "oa-case", 512L << 20);
      t.setDaemon(true); t.start(); t.join(perCaseMs);
      if (ci > 0) out.append(',');
      if (t.isAlive()) {
        out.append("{\"ok\":false,\"timeout\":true,\"error\":\"Time limit exceeded\"}");
      } else if (err[0] != null) {
        Throwable e = err[0];
        String msg = e.getClass().getSimpleName() + (e.getMessage() != null ? ": " + e.getMessage() : "");
        for (StackTraceElement el : e.getStackTrace()) {
          String cn = el.getClassName();
          if ("Main.java".equals(el.getFileName()) && !cn.equals("Main") && !cn.startsWith("Main$") && !cn.startsWith("OAJ")) {
            int ln = el.getLineNumber() - @@OFFSET@@;
            if (ln >= 1) msg += " (line " + ln + ")";
            break;
          }
        }
        out.append("{\"ok\":false,\"error\":"); OAJ.q(out, msg); out.append('}');
      } else {
        out.append("{\"ok\":true,\"value\":"); OAJ.w(out, res[0]); out.append('}');
      }
    }
    out.append("],\"stdout\":"); OAJ.q(out, new String(cap.bo.toByteArray(), "UTF-8")); out.append('}');
    real.print("\n" + nonce + out + "\n"); real.flush();
    Runtime.getRuntime().halt(0);
  }
}
'''


def _java_converters() -> str:
    lines: List[str] = []
    for base in BASES:
        jt = JAVA_BASE[base]
        for depth in range(1, MAX_DEPTH + 1):
            ty = jt + "[]" * depth
            inner = f"c_{base}_{depth - 1}"
            alloc = jt + f"[l.size()]" + "[]" * (depth - 1)
            lines.append(
                f"  static {ty} c_{base}_{depth}(Object o) {{ List<?> l = (List<?>) o; {ty} r = new {alloc}; "
                f"for (int k = 0; k < r.length; k++) r[k] = {inner}(l.get(k)); return r; }}"
            )
    return "\n".join(lines)


def split_java_imports(source: str) -> Tuple[str, List[str]]:
    """Pull `import ...;` lines out of the source (blanked in place, so line numbers hold)."""
    imports: List[str] = []
    kept: List[str] = []
    for line in source.split("\n"):
        stripped = line.strip()
        if re.match(r"^import\s+[\w.*\s]+;$", stripped):
            imports.append(stripped)
            kept.append("")
        elif re.match(r"^package\s+[\w.]+;$", stripped):
            kept.append("")
        else:
            kept.append(line)
    return "\n".join(kept), imports


def java_program(source: str, function_name: str, sig: Dict[str, Any], cap: int) -> Tuple[str, int, int]:
    """-> (Main.java text, line offset of the candidate code, candidate line count)."""
    body, imports = split_java_imports(source)
    # A top-level `public class Solution` can't live in Main.java.
    body = re.sub(r"\bpublic(\s+(?:final\s+|abstract\s+)?class\s+Solution\b)", r"\1", body)
    call = function_name + "(" + ", ".join(
        f"OAJ.c_{split_type(t)[0]}_{split_type(t)[1]}(a.get({i}))" for i, t in enumerate(sig["params"])
    ) + ")"
    head = _JAVA_HEAD.replace("@@HOISTED@@", " ".join(imports))
    driver = (_JAVA_DRIVER.replace("@@CAP@@", str(cap)).replace("@@CONVERTERS@@", _java_converters())
              .replace("@@CALL@@", call).replace("@@OFFSET@@", str(_JAVA_PRELUDE_LINES)))
    text = head + body + "\n" + driver
    return text, _JAVA_PRELUDE_LINES, body.count("\n") + 1


# ═════════════════════════════════════════════════════════════════════
# C++
# ═════════════════════════════════════════════════════════════════════

_CPP_HEAD = (
    "#include <bits/stdc++.h>\n"
    "#include <sys/wait.h>\n#include <sys/resource.h>\n#include <unistd.h>\n#include <poll.h>\n#include <signal.h>\n"
    "using namespace std;\n"
    "#define main oa_candidate_main_\n"
    '#line 1 "solution.cpp"\n'
)

_CPP_DRIVER = r'''
#undef main
#line 1 "oa_driver.cpp"
namespace oa_driver {
const size_t CAP = @@CAP@@;

struct J {
  char t = 'n';   // n null, b bool, i int, d double, s string, a array, o object
  long long i = 0; double d = 0; bool b = false; string s;
  vector<J> a; vector<pair<string, J>> o;
  const J& get(const string& k) const { for (auto& kv : o) if (kv.first == k) return kv.second; throw runtime_error("missing key " + k); }
};

static void utf8(string& b, unsigned cp) {
  if (cp < 0x80) b += (char)cp;
  else if (cp < 0x800) { b += (char)(0xC0 | (cp >> 6)); b += (char)(0x80 | (cp & 0x3F)); }
  else if (cp < 0x10000) { b += (char)(0xE0 | (cp >> 12)); b += (char)(0x80 | ((cp >> 6) & 0x3F)); b += (char)(0x80 | (cp & 0x3F)); }
  else { b += (char)(0xF0 | (cp >> 18)); b += (char)(0x80 | ((cp >> 12) & 0x3F)); b += (char)(0x80 | ((cp >> 6) & 0x3F)); b += (char)(0x80 | (cp & 0x3F)); }
}

struct Parser {
  const string& s; size_t i = 0;
  explicit Parser(const string& str) : s(str) {}
  void ws() { while (i < s.size() && isspace((unsigned char)s[i])) i++; }
  string str() {
    i++; string b;
    while (true) {
      char c = s[i++];
      if (c == '"') break;
      if (c == '\\') {
        char d = s[i++];
        switch (d) {
          case 'n': b += '\n'; break;
          case 't': b += '\t'; break;
          case 'r': b += '\r'; break;
          case 'b': b += '\b'; break;
          case 'f': b += '\f'; break;
          case 'u': {
            unsigned cp = (unsigned)stoul(s.substr(i, 4), nullptr, 16); i += 4;
            if (cp >= 0xD800 && cp < 0xDC00 && s[i] == '\\' && s[i + 1] == 'u') {
              unsigned lo = (unsigned)stoul(s.substr(i + 2, 4), nullptr, 16); i += 6;
              cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            }
            utf8(b, cp); break;
          }
          default: b += d;
        }
      } else b += c;
    }
    return b;
  }
  J val() {
    ws(); J v; char c = s[i];
    if (c == '{') {
      v.t = 'o'; i++; ws();
      if (s[i] == '}') { i++; return v; }
      while (true) { ws(); string k = str(); ws(); i++; J x = val(); v.o.emplace_back(k, std::move(x)); ws(); if (s[i++] == '}') break; }
      return v;
    }
    if (c == '[') {
      v.t = 'a'; i++; ws();
      if (s[i] == ']') { i++; return v; }
      while (true) { v.a.push_back(val()); ws(); if (s[i++] == ']') break; }
      return v;
    }
    if (c == '"') { v.t = 's'; v.s = str(); return v; }
    if (s.compare(i, 4, "true") == 0) { i += 4; v.t = 'b'; v.b = true; return v; }
    if (s.compare(i, 5, "false") == 0) { i += 5; v.t = 'b'; return v; }
    if (s.compare(i, 4, "null") == 0) { i += 4; return v; }
    size_t j = i; while (j < s.size() && strchr("+-0123456789.eE", s[j])) j++;
    string tok = s.substr(i, j - i); i = j;
    if (tok.find_first_of(".eE") == string::npos) {
      try { v.t = 'i'; v.i = stoll(tok); v.d = (double)v.i; return v; } catch (...) {}
    }
    v.t = 'd'; v.d = stod(tok); return v;
  }
};

static void conv(const J& j, int& o) { o = (int)(j.t == 'i' ? j.i : (long long)j.d); }
static void conv(const J& j, long long& o) { o = j.t == 'i' ? j.i : (long long)j.d; }
static void conv(const J& j, double& o) { o = j.t == 'i' ? (double)j.i : j.d; }
static void conv(const J& j, bool& o) { o = j.b; }
static void conv(const J& j, string& o) { o = j.s; }
static void conv(const J& j, vector<bool>& o) { o.assign(j.a.size(), false); for (size_t k = 0; k < j.a.size(); k++) o[k] = j.a[k].b; }
template <class T> static void conv(const J& j, vector<T>& o) {
  o.clear(); o.resize(j.a.size());
  for (size_t k = 0; k < j.a.size(); k++) conv(j.a[k], o[k]);
}

static void esc(string& o, const string& s, bool ascii) {
  o += '"';
  for (unsigned char c : s) {
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:
        if (c < 0x20 || (ascii && c >= 0x7f)) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
        else o += (char)c;
    }
  }
  o += '"';
}

static void ser(string& o, int v) { o += to_string(v); }
static void ser(string& o, long long v) { o += to_string(v); }
static void ser(string& o, double v) {
  if (!std::isfinite(v)) { o += "null"; return; }
  char b[40]; snprintf(b, sizeof b, "%.17g", v); o += b;
}
static void ser(string& o, bool v) { o += v ? "true" : "false"; }
static void ser(string& o, const string& v) { esc(o, v, false); }
static void ser(string& o, const vector<bool>& v) {
  o += '['; for (size_t k = 0; k < v.size(); k++) { if (k) o += ','; o += v[k] ? "true" : "false"; } o += ']';
}
template <class T> static void ser(string& o, const vector<T>& v) {
  o += '['; for (size_t k = 0; k < v.size(); k++) { if (k) o += ','; ser(o, v[k]); } o += ']';
}

static void write_all(int fd, const string& s) {
  size_t off = 0;
  while (off < s.size()) { ssize_t n = write(fd, s.data() + off, s.size() - off); if (n <= 0) return; off += (size_t)n; }
}

// Runs in the forked child: build the arguments, call the candidate, report one JSON object.
static void child_run(const J& args, int fd) {
  string res;
  try {
@@ARGS@@
    Solution sol;
    auto r = sol.@@CALL@@;
    string v; ser(v, r);
    res = "{\"ok\":true,\"value\":" + v + "}";
  } catch (const std::exception& e) {
    res = "{\"ok\":false,\"error\":"; esc(res, string("Runtime error: ") + e.what(), true); res += "}";
  } catch (...) {
    res = "{\"ok\":false,\"error\":\"Runtime error: unknown exception\"}";
  }
  fflush(stdout); cout.flush();
  write_all(fd, res);
}

static string describe_exit(int status) {
  if (WIFSIGNALED(status)) {
    int sg = WTERMSIG(status);
    if (sg == SIGSEGV) return "Segmentation fault (out-of-bounds access or too-deep recursion)";
    if (sg == SIGABRT) return "Aborted (uncaught exception, failed assertion or out of memory)";
    if (sg == SIGFPE) return "Arithmetic exception (division by zero)";
    if (sg == SIGKILL) return "Killed (out of memory?)";
    return "Crashed with signal " + to_string(sg);
  }
  return "Exited with code " + to_string(WEXITSTATUS(status));
}

static void run_case(const J& args, double per_case, string& result, string& captured) {
  int rp[2], op[2];
  if (pipe(rp) != 0 || pipe(op) != 0) { result = "{\"ok\":false,\"error\":\"Runtime error: could not start the run\"}"; return; }
  fflush(nullptr);
  pid_t pid = fork();
  if (pid == 0) {
    close(rp[0]); close(op[0]);
    dup2(op[1], 1); dup2(op[1], 2); close(op[1]);
    child_run(args, rp[1]);
    _exit(0);
  }
  close(rp[1]); close(op[1]);
  auto start = chrono::steady_clock::now();
  string rbuf; bool timed_out = false;
  struct pollfd fds[2] = {{rp[0], POLLIN, 0}, {op[0], POLLIN, 0}};
  char buf[65536];
  while (fds[0].fd >= 0 || fds[1].fd >= 0) {
    double elapsed = chrono::duration<double>(chrono::steady_clock::now() - start).count();
    int remaining = (int)((per_case - elapsed) * 1000);
    if (remaining <= 0) { timed_out = true; break; }
    int n = poll(fds, 2, remaining);
    if (n < 0) { if (errno == EINTR) continue; break; }
    for (int k = 0; k < 2; k++) {
      if (fds[k].fd < 0 || !(fds[k].revents & (POLLIN | POLLHUP | POLLERR))) continue;
      ssize_t m = read(fds[k].fd, buf, sizeof buf);
      if (m <= 0) { close(fds[k].fd); fds[k].fd = -1; continue; }
      if (k == 0) { if (rbuf.size() < ((size_t)64 << 20)) rbuf.append(buf, (size_t)m); }
      else if (captured.size() < CAP) captured.append(buf, min((size_t)m, CAP - captured.size()));
    }
  }
  if (timed_out) kill(pid, SIGKILL);
  int status = 0; waitpid(pid, &status, 0);
  for (int k = 0; k < 2; k++) if (fds[k].fd >= 0) close(fds[k].fd);
  if (timed_out) result = "{\"ok\":false,\"timeout\":true,\"error\":\"Time limit exceeded\"}";
  else if (!rbuf.empty()) result = rbuf;
  else { result = "{\"ok\":false,\"error\":"; esc(result, "Runtime error: " + describe_exit(status), true); result += "}"; }
}
}  // namespace oa_driver

int main() {
  using namespace oa_driver;
  struct rlimit rl;
  if (getrlimit(RLIMIT_STACK, &rl) == 0) {
    rlim_t want = (rlim_t)512 << 20;
    if (rl.rlim_max != RLIM_INFINITY && want > rl.rlim_max) want = rl.rlim_max;
    if (rl.rlim_cur != RLIM_INFINITY && rl.rlim_cur < want) { rl.rlim_cur = want; setrlimit(RLIMIT_STACK, &rl); }
  }
  string in((istreambuf_iterator<char>(cin)), istreambuf_iterator<char>());
  Parser p(in); J payload = p.val();
  string nonce = payload.get("nonce").s;
  const J& cases = payload.get("cases");
  double per_case = (double)payload.get("per_case").i;
  string out = "{\"results\":[", captured;
  for (size_t k = 0; k < cases.a.size(); k++) {
    string res; run_case(cases.a[k], per_case, res, captured);
    if (k) out += ',';
    out += res;
  }
  out += "],\"stdout\":"; esc(out, captured, true); out += '}';
  string line = "\n" + nonce + out + "\n";
  write_all(1, line);
  return 0;
}
'''


def cpp_program(source: str, function_name: str, sig: Dict[str, Any], cap: int) -> Tuple[str, int, int]:
    """-> (solution.cpp text, 0 offset (the #line directive resets numbering), candidate line count)."""
    args = "\n".join(
        f"    {cpp_type(t)} a{i}; conv(args.a[{i}], a{i});" for i, t in enumerate(sig["params"])
    )
    call = function_name + "(" + ", ".join(f"a{i}" for i in range(len(sig["params"]))) + ")"
    driver = _CPP_DRIVER.replace("@@CAP@@", str(cap)).replace("@@ARGS@@", args).replace("@@CALL@@", call)
    return _CPP_HEAD + source + "\n" + driver, 0, source.count("\n") + 1


# ═════════════════════════════════════════════════════════════════════
# Compiler output -> something a candidate can act on
# ═════════════════════════════════════════════════════════════════════

_DRIVER_HINT = ("Couldn't call your function with the expected signature. Keep the class name, method "
                "name, parameter types and return type from the starter code.")


def clean_compile_error(language: str, text: str, offset: int, cand_lines: int, source: str = "",
                        limit: int = 12) -> str:
    text = (text or "").replace("\r", "")
    out: List[str] = []
    if language == "java":
        pat = re.compile(r"^\S*Main\.java:(\d+):\s*(.*)$")
        for line in text.split("\n"):
            m = pat.match(line)
            if m:
                n = int(m.group(1)) - offset
                if n < 1 or n > cand_lines:
                    return _DRIVER_HINT + "\n" + "\n".join(out[:limit]) if out else _DRIVER_HINT
                out.append(f"Line {n}: {m.group(2)}")
            elif out and line.strip() and not line.startswith(("Note:", "1 error", "2 errors")) \
                    and not re.match(r"^\d+ errors?$", line.strip()):
                out.append(line.rstrip())
    else:
        for line in text.split("\n"):
            if "oa_driver.cpp" in line and "error" in line:
                return _DRIVER_HINT
        pat = re.compile(r"^\S*solution\.cpp:(\d+):(?:\d+:)?\s*(.*)$")
        src_lines = source.split("\n")
        for line in text.split("\n"):
            m = pat.match(line)
            if m:
                out.append(f"Line {m.group(1)}: {m.group(2)}")
                n = int(m.group(1))
                if m.group(2).startswith("error") and 1 <= n <= len(src_lines):
                    out.append("    " + src_lines[n - 1].strip()[:160])   # g++'s own context follows the #line map badly
            elif out and re.match(r"^\s+(note|required from|In instantiation)", line):
                out.append(line.rstrip())
    msg = "\n".join(out[:limit]) if out else (text.strip()[:600] or "Compilation failed.")
    return msg
