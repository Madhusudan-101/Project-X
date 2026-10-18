"""Java / C++ support in the OA judge: signature inference, starter code, and the
graders themselves (run for real with javac / g++ when they're installed)."""
import json
import os
import shutil
from pathlib import Path

import pytest

os.environ.setdefault("SUPABASE_URL", "http://unused")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "unused")

from app.services.candidate import oa_drivers, oa_judge as J, oa_signature as S  # noqa: E402

SEED = Path(__file__).resolve().parents[2] / "db" / "seed" / "oa_problems.json"
HAVE = {"java": bool(shutil.which("javac") and shutil.which("java")), "cpp": bool(shutil.which("g++"))}


def needs(lang):
    return pytest.mark.skipif(not HAVE[lang], reason=f"{lang} toolchain not installed")


@pytest.fixture(autouse=True)
def local_judge(monkeypatch):
    monkeypatch.setenv("OA_JUDGE_BACKEND", "local")
    monkeypatch.setenv("OA_ALLOW_LOCAL_JUDGE", "1")


# ── signature inference ─────────────────────────────────────────────

def case(*args, expected):
    return {"args": list(args), "expected": expected}


def test_infer_basic_shapes():
    sig = S.infer_signature(["nums", "target"], [case([2, 7], 9, expected=[0, 1]), case([3], 6, expected=[])])
    assert sig["params"] == ["int[]", "int"] and sig["returns"] == "int[]" and sig["guessed"] == []


def test_infer_widens_and_flags_guesses():
    sig = S.infer_signature(["x"], [case(1, expected=1), case(3_000_000_000, expected=2.5)])
    assert sig["params"] == ["long"] and sig["returns"] == "double"
    sig = S.infer_signature(["a"], [case([], expected=[[]])])
    assert sig["params"] == ["int[]"] and sig["returns"] == "int[][]" and sig["guessed"] == ["a", "<return>"]


def test_infer_bool_is_not_int_and_nesting_is_merged():
    sig = S.infer_signature(["flags", "rows"], [case([True], [[]], expected=True), case([], [["a"]], expected=False)])
    assert sig["params"] == ["bool[]", "string[][]"] and sig["returns"] == "bool"


@pytest.mark.parametrize("bad", [None, {"a": 1}, [1, [2]], [[[[1]]]], [1, "x"]])
def test_infer_rejects_untypeable_data(bad):
    with pytest.raises(ValueError):
        S.infer_signature(["x"], [case(bad, expected=1)])


def test_signature_for_prefers_stored_then_examples():
    stored = {"params": ["long"], "returns": "int"}
    assert S.signature_for({"params": ["x"], "signature": stored, "examples": []}) == stored
    inferred = S.signature_for({"params": ["x"], "examples": [{"args": [1], "expected": True}]})
    assert inferred["params"] == ["int"] and inferred["returns"] == "bool"
    assert S.signature_for({"params": ["x"], "signature": {"params": ["nope"], "returns": "int"}, "examples": []}) is None
    assert S.signature_for({"params": ["x"], "examples": []}) is None


def test_starter_code():
    sig = {"params": ["int[]", "int"], "returns": "int[]"}
    java = J.starter_for("java", "twoSum", ["nums", "target"], {}, sig)
    assert "public int[] twoSum(int[] nums, int target)" in java and "return null;" in java
    cpp = J.starter_for("cpp", "twoSum", ["nums", "target"], {}, sig)
    assert "vector<int> twoSum(vector<int>& nums, int target)" in cpp and "return {};" in cpp
    sig = {"params": ["string[][]", "long"], "returns": "bool"}
    assert "boolean f(String[][] a, long b)" in J.starter_for("java", "f", ["a", "b"], {}, sig)
    assert "bool f(vector<vector<string>>& a, long long b)" in J.starter_for("cpp", "f", ["a", "b"], {}, sig)
    assert J.function_name_for("java", "twoSum") == "twoSum" and J.function_name_for("cpp", "twoSum") == "twoSum"


def test_typed_language_without_signature_is_unavailable():
    with pytest.raises(J.JudgeUnavailable):
        J.build_program("java", "class Solution {}", "f", None)


def test_every_seeded_problem_is_typed_and_offers_both_languages():
    for p in json.load(open(SEED)):
        sig = p["signature"]
        assert sig and all(S.is_valid_type(t) for t in sig["params"] + [sig["returns"]]), p["id"]
        assert len(sig["params"]) == len(p["params"]), p["id"]
        assert "java" in p["languages"] and "cpp" in p["languages"], p["id"]


def test_compile_error_cleaning():
    java = "Main.java:9: error: ';' expected\n    return 1\n            ^\n1 error\n"
    assert oa_drivers.clean_compile_error("java", java, 6, 10).startswith("Line 3: error: ';' expected")
    # an error in generated driver code (line past the candidate's) -> signature hint, not driver internals
    assert "signature" in oa_drivers.clean_compile_error("java", "Main.java:40: error: incompatible types", 6, 10)
    cpp = "/tmp/x/solution.cpp:2:5: error: 'foo' was not declared\n    2 | foo();\n      | ^\n"
    out = oa_drivers.clean_compile_error("cpp", cpp, 0, 3, "int x;\nfoo();\n")
    assert out.splitlines()[0] == "Line 2: error: 'foo' was not declared" and out.splitlines()[1].strip() == "foo();"
    assert "signature" in oa_drivers.clean_compile_error("cpp", "oa_driver.cpp:12:3: error: no match", 0, 3)


# ── the graders, for real ───────────────────────────────────────────

TWO_SUM = [case([2, 7, 11, 15], 9, expected=[0, 1]), case([3, 2, 4], 6, expected=[1, 2])]
TWO_SUM_SIG = {"params": ["int[]", "int"], "returns": "int[]"}

JAVA = {
    "good": "import java.util.*;\npublic class Solution {\n  public int[] twoSum(int[] nums, int target) {\n"
            "    Map<Integer,Integer> m = new HashMap<>();\n    for (int i = 0; i < nums.length; i++) {\n"
            "      if (m.containsKey(target - nums[i])) return new int[]{m.get(target - nums[i]), i};\n"
            "      m.put(nums[i], i);\n    }\n    return null;\n  }\n}\n",
    "wrong": "class Solution { public int[] twoSum(int[] n, int t) { return new int[]{0, 0}; } }",
    "syntax": "class Solution { public int[] twoSum(int[] n, int t) { return new int[]{0, 0} } }",
    "loop": "class Solution { public int[] twoSum(int[] n, int t) { while (true) {} } }",
    "throw": "class Solution { public int[] twoSum(int[] n, int t) { return new int[]{n[99]}; } }",
    "badsig": "class Solution { public int[] twoSum(String n, int t) { return null; } }",
    "deep": "class Solution { int f(int x) { return x == 0 ? 0 : 1 + f(x - 1); }"
            " public int[] twoSum(int[] n, int t) { return new int[]{f(300000)}; } }",
    "print": "class Solution { public int[] twoSum(int[] n, int t) { System.out.println(\"dbg \" + n.length);"
             " return new int[]{0, 0}; } }",
}
CPP = {
    "good": "class Solution {\npublic:\n  vector<int> twoSum(vector<int>& nums, int target) {\n"
            "    unordered_map<int,int> m;\n    for (int i = 0; i < (int)nums.size(); i++) {\n"
            "      if (m.count(target - nums[i])) return {m[target - nums[i]], i};\n      m[nums[i]] = i;\n    }\n"
            "    return {};\n  }\n};\nint main() { return 0; }\n",   # a stray main() must not collide with the driver's
    "wrong": "class Solution { public: vector<int> twoSum(vector<int>& n, int t) { return {0, 0}; } };",
    "syntax": "class Solution { public: vector<int> twoSum(vector<int>& n, int t) { return {0, 0} } };",
    "loop": "class Solution { public: vector<int> twoSum(vector<int>& n, int t) { while (true) {} return {}; } };",
    "throw": "class Solution { public: vector<int> twoSum(vector<int>& n, int t) { return {n.at(99)}; } };",
    "segv": "class Solution { public: vector<int> twoSum(vector<int>& n, int t) { int* p = nullptr; return {*p}; } };",
    "badsig": "class Solution { public: vector<int> twoSum(string n, int t) { return {}; } };",
    "deep": "class Solution { public: int f(int x) { return x == 0 ? 0 : 1 + f(x - 1); }"
            " vector<int> twoSum(vector<int>& n, int t) { return {f(300000)}; } };",
    "print": 'class Solution { public: vector<int> twoSum(vector<int>& n, int t) { cout << "dbg " << n.size() << endl;'
             ' printf("c-style\\n"); return {0, 0}; } };',
}
VERDICTS = {"good": "accepted", "wrong": "wrong_answer", "syntax": "compile_error", "loop": "time_limit",
            "throw": "runtime_error", "badsig": "compile_error", "segv": "runtime_error", "deep": "wrong_answer",
            "print": "wrong_answer"}


def run(lang, src, cases=TWO_SUM, sig=TWO_SUM_SIG, fn="twoSum", compare="exact"):
    return J.judge(lang, src, fn, cases, compare, sig)


@pytest.mark.parametrize("name", [n for n in JAVA])
@needs("java")
def test_java_verdicts(name):
    r = run("java", JAVA[name])
    assert J.overall_verdict(r) == VERDICTS[name], (r.compile_error, r.crash, [o.error for o in r.outcomes])
    if name == "good":
        assert [o.status for o in r.outcomes] == ["pass", "pass"]
    if name == "print":
        assert "dbg 4" in r.stdout
    if name == "syntax":
        assert r.compile_error.startswith("Line 1:")
    if name == "throw":
        assert "ArrayIndexOutOfBounds" in r.outcomes[0].error and "line 1" in r.outcomes[0].error


@pytest.mark.parametrize("name", [n for n in CPP])
@needs("cpp")
def test_cpp_verdicts(name):
    r = run("cpp", CPP[name])
    assert J.overall_verdict(r) == VERDICTS[name], (r.compile_error, r.crash, [o.error for o in r.outcomes])
    if name == "good":
        assert [o.status for o in r.outcomes] == ["pass", "pass"]
    if name == "print":
        assert "dbg 4" in r.stdout and "c-style" in r.stdout
    if name == "syntax":
        assert r.compile_error.startswith("Line 1:")
    if name == "segv":
        assert "Segmentation fault" in r.outcomes[0].error


@pytest.mark.parametrize("lang", ["java", "cpp"])
def test_custom_input_runs_without_expected(lang):
    if not HAVE[lang]:
        pytest.skip("no toolchain")
    r = run(lang, (JAVA if lang == "java" else CPP)["good"], cases=[{"args": [[1, 5, 9], 14]}])
    assert r.outcomes[0].status == "ran" and r.outcomes[0].actual == [1, 2]


# Every type the problem bank uses (plus a few more), round-tripped through each driver.
ROUNDTRIP = {
    "int": [0, -7, 2147483647, -2147483648],
    "long": [0, 3000000000, -9007199254740991],
    "double": [0.0, 1.5, -2.25, 1e-9, 123456789.125],
    "bool": [True, False],
    "string": ["", "abc", 'quote " back \\ slash', "tab\t nl\n", "héllo ✓ 日本", "emoji 😀"],
    "int[]": [[], [1], [3, -1, 2]],
    "bool[]": [[], [True, False]],
    "string[]": [[], ["a", "", "ccc"]],
    "int[][]": [[], [[]], [[1, 2], [], [3]]],
    "string[][]": [[["a", "b"], []], []],
    "double[]": [[0.5, -1.0, 2.0]],
    "long[]": [[3000000000, 1]],
    "int[][][]": [[], [[[1, 2], [3]], [[]]]],
}


@pytest.mark.parametrize("lang", ["java", "cpp"])
@pytest.mark.parametrize("type_", sorted(ROUNDTRIP))
def test_marshalling_roundtrip(lang, type_):
    if not HAVE[lang]:
        pytest.skip("no toolchain")
    sig = {"params": [type_], "returns": type_}
    if lang == "java":
        src = f"class Solution {{ public {S.java_type(type_)} f({S.java_type(type_)} x) {{ return x; }} }}"
    else:
        ty = S.cpp_type(type_)
        src = f"class Solution {{ public: {ty} f({ty}& x) {{ return x; }} }};" if "[]" in type_ else \
              f"class Solution {{ public: {ty} f({ty} x) {{ return x; }} }};"
    cases = [{"args": [v], "expected": v} for v in ROUNDTRIP[type_]]
    r = run(lang, src, cases=cases, sig=sig, fn="f")
    assert r.compile_error is None and r.crash is None, (r.compile_error, r.crash)
    assert [o.status for o in r.outcomes] == ["pass"] * len(cases), [(o.status, o.actual, o.error) for o in r.outcomes]


# Real solutions to real seeded problems, graded against every seeded test.
SOLUTIONS = {
    "java": {
        "valid-parentheses": "class Solution { public boolean validParentheses(String s) { Deque<Character> st = new ArrayDeque<>();"
            " for (char c : s.toCharArray()) { if (c=='('||c=='['||c=='{') st.push(c); else { if (st.isEmpty()) return false;"
            " char o = st.pop(); if ((c==')'&&o!='(')||(c==']'&&o!='[')||(c=='}'&&o!='{')) return false; } } return st.isEmpty(); } }",
        "merge-intervals": "class Solution { public int[][] merge(int[][] a) { int[][] b = a.clone(); Arrays.sort(b, (x, y) -> x[0] - y[0]);"
            " List<int[]> r = new ArrayList<>(); for (int[] i : b) { if (r.isEmpty() || r.get(r.size()-1)[1] < i[0]) r.add(new int[]{i[0], i[1]});"
            " else r.get(r.size()-1)[1] = Math.max(r.get(r.size()-1)[1], i[1]); } return r.toArray(new int[0][]); } }",
        "group-anagrams": "class Solution { public String[][] groupAnagrams(String[] strs) { Map<String, List<String>> m = new LinkedHashMap<>();"
            " for (String s : strs) { char[] c = s.toCharArray(); Arrays.sort(c); m.computeIfAbsent(new String(c), k -> new ArrayList<>()).add(s); }"
            " String[][] out = new String[m.size()][]; int i = 0; for (List<String> g : m.values()) out[i++] = g.toArray(new String[0]); return out; } }",
        "median-of-two-sorted-arrays": "class Solution { public double findMedianSortedArrays(int[] a, int[] b) { int[] c = new int[a.length + b.length];"
            " System.arraycopy(a, 0, c, 0, a.length); System.arraycopy(b, 0, c, a.length, b.length); Arrays.sort(c); int n = c.length;"
            " return n % 2 == 1 ? c[n/2] : (c[n/2-1] + c[n/2]) / 2.0; } }",
        "climbing-stairs": "class Solution { public int climbStairs(int n) { int a = 1, b = 1; for (int i = 0; i < n; i++) { int t = a + b; a = b; b = t; } return a; } }",
        "reverse-bits": "class Solution { public long reverseBits(long n) { long r = 0; for (int i = 0; i < 32; i++) { r = (r << 1) | (n & 1); n >>= 1; } return r; } }",
        "longest-common-prefix": "class Solution { public String longestCommonPrefix(String[] s) { if (s.length == 0) return \"\"; String p = s[0];"
            " for (String x : s) while (!x.startsWith(p)) p = p.substring(0, p.length() - 1); return p; } }",
    },
    "cpp": {
        "valid-parentheses": "class Solution { public: bool validParentheses(string s) { string st; for (char c : s) { if (c=='('||c=='['||c=='{') st += c;"
            " else { if (st.empty()) return false; char o = st.back(); st.pop_back(); if ((c==')'&&o!='(')||(c==']'&&o!='[')||(c=='}'&&o!='{')) return false; } } return st.empty(); } };",
        "merge-intervals": "class Solution { public: vector<vector<int>> merge(vector<vector<int>>& a) { vector<vector<int>> b = a; sort(b.begin(), b.end());"
            " vector<vector<int>> r; for (auto& i : b) { if (r.empty() || r.back()[1] < i[0]) r.push_back(i); else r.back()[1] = max(r.back()[1], i[1]); } return r; } };",
        "group-anagrams": "class Solution { public: vector<vector<string>> groupAnagrams(vector<string>& strs) { map<string, vector<string>> m;"
            " for (auto& s : strs) { string k = s; sort(k.begin(), k.end()); m[k].push_back(s); } vector<vector<string>> out; for (auto& kv : m) out.push_back(kv.second); return out; } };",
        "median-of-two-sorted-arrays": "class Solution { public: double findMedianSortedArrays(vector<int>& a, vector<int>& b) { vector<int> c = a; c.insert(c.end(), b.begin(), b.end());"
            " sort(c.begin(), c.end()); size_t n = c.size(); return n % 2 ? c[n/2] : (c[n/2-1] + c[n/2]) / 2.0; } };",
        "climbing-stairs": "class Solution { public: int climbStairs(int n) { int a = 1, b = 1; for (int i = 0; i < n; i++) { int t = a + b; a = b; b = t; } return a; } };",
        "reverse-bits": "class Solution { public: long long reverseBits(long long n) { long long r = 0; for (int i = 0; i < 32; i++) { r = (r << 1) | (n & 1); n >>= 1; } return r; } };",
        "longest-common-prefix": "class Solution { public: string longestCommonPrefix(vector<string>& s) { if (s.empty()) return \"\"; string p = s[0];"
            " for (auto& x : s) while (x.compare(0, p.size(), p) != 0) p.pop_back(); return p; } };",
    },
}


@pytest.mark.parametrize("pid", sorted(SOLUTIONS["java"]))
@pytest.mark.parametrize("lang", ["java", "cpp"])
def test_real_problem_solutions(lang, pid):
    if not HAVE[lang]:
        pytest.skip("no toolchain")
    p = next(x for x in json.load(open(SEED)) if x["id"] == pid)
    src = SOLUTIONS[lang][pid]
    if lang == "java":
        src = "import java.util.*;\n" + src
    cases = [{"args": t["args"], "expected": t["expected"]} for t in p["tests"]]
    r = J.judge(lang, src, p["function_name"], cases, p["compare"], p["signature"])
    assert J.overall_verdict(r) == "accepted", (r.compile_error, r.crash, [(o.status, o.actual, o.error) for o in r.outcomes])


@pytest.mark.skipif(os.environ.get("OA_FULL_SWEEP") != "1", reason="slow: set OA_FULL_SWEEP=1")
@pytest.mark.parametrize("lang", ["java", "cpp"])
def test_every_seeded_problem_compiles_and_runs_its_starter(lang):
    """The generated starter code must compile and every test's arguments must reach it intact."""
    from concurrent.futures import ThreadPoolExecutor
    if not HAVE[lang]:
        pytest.skip("no toolchain")
    problems = json.load(open(SEED))

    def one(p):
        src = J.starter_for(lang, p["function_name"], p["params"], {}, p["signature"])
        r = J.judge(lang, src, p["function_name"],
                    [{"args": t["args"], "expected": t["expected"]} for t in p["tests"]], p["compare"], p["signature"])
        return p["id"], J.overall_verdict(r), r.compile_error or r.crash
    with ThreadPoolExecutor(4) as ex:
        bad = [x for x in ex.map(one, problems) if x[1] not in ("wrong_answer", "accepted")]
    assert not bad, bad
