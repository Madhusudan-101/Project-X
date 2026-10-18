"""Code-similarity engine: tokenizer, winnowing, rarity-weighted scoring, clustering."""
import pytest

from app.services.candidate import oa_similarity as S

STARTER_PY = "def merge_sorted(a, b):\n    # Write your code here\n    pass\n"

# A: two-pointer merge
A = """
def merge_sorted(a, b):
    # merge two sorted lists
    result = []
    i = j = 0
    while i < len(a) and j < len(b):
        if a[i] <= b[j]:
            result.append(a[i])
            i += 1
        else:
            result.append(b[j])
            j += 1
    while i < len(a):
        result.append(a[i])
        i += 1
    while j < len(b):
        result.append(b[j])
        j += 1
    return result
"""
# A with every identifier renamed, comments changed, blank lines added
A_RENAMED = """
def merge_sorted(left, right):

    out = []   # output
    x = y = 0
    while x < len(left) and y < len(right):
        if left[x] <= right[y]:
            out.append(left[x])
            x += 1
        else:
            out.append(right[y])
            y += 1

    while x < len(left):
        out.append(left[x])
        x += 1
    while y < len(right):
        out.append(right[y])
        y += 1
    return out
"""
# a genuinely different approach
B = """
def merge_sorted(a, b):
    import heapq
    merged = list(heapq.merge(a, b))
    total = 0
    for value in merged:
        total += value
    if total < 0:
        merged.reverse()
        merged.reverse()
    return sorted(merged, key=lambda v: (v, v))
"""


def prep(key, src, lang="python", starter=STARTER_PY):
    return S.prepare(key, lang, src, starter)


def test_tokenizer_drops_comments_and_collapses_literals():
    toks = S.tokenize('x = 1  # note\ns = "a # not a comment"\n"""doc\nstring"""\nz = 2', "python")
    assert [t.norm for t in toks] == ["ID", "=", "NUM", "ID", "=", "STR", "STR", "ID", "=", "NUM"]
    assert [t.line for t in toks][-1] == 5   # multi-line string advanced the line counter
    js = S.tokenize("let a = 1; // c\n/* multi\nline */ const b = `t ${a}`;", "javascript")
    assert [t.norm for t in js] == ["let", "ID", "=", "NUM", ";", "const", "ID", "=", "STR", ";"]
    cpp = S.tokenize("#include <vector>\nint f(){ return 1; } // x", "cpp")
    assert [t.norm for t in cpp][:3] == ["int", "ID", "("] and "include" not in [t.raw for t in cpp]


def test_renaming_variables_does_not_hide_a_copy():
    a, b = prep("a", A), prep("b", A_RENAMED)
    (m,) = S.compare_all([a, b])
    assert m.similarity >= 0.95 and m.level == "high"
    assert m.raw_overlap < m.similarity   # names differ, so the name-level evidence is weaker


def test_identical_code_is_a_perfect_match_with_matching_raw_names():
    (m,) = S.compare_all([prep("a", A), prep("b", A)])
    assert m.similarity == 1.0 and m.raw_overlap == 1.0


def test_different_approaches_are_not_flagged():
    assert S.compare_all([prep("a", A), prep("b", B)]) == []


def test_starter_code_and_tiny_solutions_are_ignored():
    only_starter = prep("s", STARTER_PY + "\n" + STARTER_PY)
    assert not only_starter.usable and only_starter.skipped
    tiny = prep("t", "def f(a):\n    return a\n")
    assert not tiny.usable and tiny.skipped == "too short to compare"
    assert S.compare_all([only_starter, tiny, prep("a", A)]) == []


def test_languages_are_compared_separately():
    js = "function m(a,b){const r=[];let i=0,j=0;while(i<a.length&&j<b.length){if(a[i]<=b[j]){r.push(a[i]);i++;}else{r.push(b[j]);j++;}}while(i<a.length){r.push(a[i]);i++;}while(j<b.length){r.push(b[j]);j++;}return r;}"
    assert S.compare_all([prep("a", A), prep("b", js, "javascript", "")]) == []
    twin = js.replace("r.push", "out.push").replace("const r", "const out").replace("return r", "return out")
    (m,) = S.compare_all([prep("a", js, "javascript", ""), prep("b", twin, "javascript", "")])
    assert m.language == "javascript" and m.similarity > 0.9


def test_common_solutions_across_a_large_cohort_are_discounted():
    # 12 candidates all wrote the textbook merge (renamed a bit) + 2 who share something unusual
    cohort = [prep(f"c{i}", A.replace("result", f"res{i}")) for i in range(12)]
    plain = S.compare_all(cohort[:4])                 # small cohort: no weighting, a copy-looking cluster
    assert plain and min(m.similarity for m in plain) > 0.9
    weighted = S.compare_all(cohort)                  # large cohort: everyone shares the same fingerprints
    assert weighted == []
    odd = "def merge_sorted(a, b):\n" + "\n".join(f"    v{i} = (a[{i}] if len(a) > {i} else None, b[{i}] if len(b) > {i} else None)" for i in range(10)) + "\n    return sorted(a + b)\n"
    pair = [prep("odd1", odd), prep("odd2", odd.replace("v", "w"))]
    found = S.compare_all(cohort + pair)
    assert [(m.a, m.b) for m in found] == [("odd1", "odd2")] and found[0].level == "high"


def test_clusters_group_linked_candidates():
    ms = [S.Match("a", "b", "python", 0.9, 0.9, 0.9, 10, "high"), S.Match("b", "c", "python", 0.8, 0.8, 0.8, 9, "medium"),
          S.Match("x", "y", "python", 0.95, 0.9, 0.9, 11, "high")]
    assert S.clusters(ms) == [["a", "b", "c"], ["x", "y"]]


def test_matched_lines_point_at_the_shared_code():
    a, b = prep("a", A), prep("b", B + "\n" + A)
    la, lb = S.matched_lines(a, b)
    assert la and lb and max(la) <= A.count("\n") + 1 and min(lb) > B.count("\n")   # B's copy sits after its own code


def test_winnow_guarantee_every_shared_run_is_caught():
    shared = [f"t{i}" for i in range(S.K_GRAM + S.WINDOW)]
    for pad in range(6):
        x = [f"x{i}" for i in range(pad)] + shared + ["end1", "end2", "end3"]
        y = ["y0", "y1", "y2", "y3"] + shared + [f"z{i}" for i in range(9)]
        assert set(S.winnow(x)) & set(S.winnow(y)), pad
