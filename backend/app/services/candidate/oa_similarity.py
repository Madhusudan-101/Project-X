"""Code-similarity detection for the Online Assessment.

Compares the solutions candidates submitted to the SAME coding question within one
drive and surfaces pairs that look copied. Method (the idea behind MOSS):

  1. Tokenize each solution, dropping comments / whitespace and collapsing string and
     number literals. Two streams are kept: `norm` (every non-keyword identifier becomes
     `ID`, so renaming variables does nothing) and `raw` (identifiers kept).
  2. Take every run of K tokens, hash it, and keep the minimum hash in each sliding
     window of W hashes ("winnowing") -> a small set of position-tagged fingerprints that
     is guaranteed to catch any shared run of at least K + W - 1 tokens.
  3. Remove fingerprints that come from the problem's starter code (everyone has them).
  4. Score a pair by how much of the SMALLER solution is shared with the other, with each
     shared fingerprint weighted by how rare it is across the drive. A textbook solution
     that half the cohort wrote the same way therefore scores low; an unusual structure
     that only two candidates share scores high.

This is evidence for a human to review, not a verdict: short, canonical solutions
converge honestly, and a copied solution can be disguised. The API says so.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Set, Tuple

K_GRAM = 5          # tokens per fingerprint
WINDOW = 4          # winnowing window (guarantee: shared runs >= K_GRAM + WINDOW - 1 tokens)
MIN_TOKENS = 30     # shorter solutions are too generic to say anything about
MIN_FINGERPRINTS = 8
MIN_POPULATION_FOR_WEIGHTING = 10   # below this, "how common is it" is meaningless
MIN_WEIGHT = 0.05
LEVEL_HIGH = 0.85
LEVEL_MEDIUM = 0.70
LANGUAGES = ("python", "javascript", "java", "cpp")

_KEYWORDS: Dict[str, Set[str]] = {
    "python": set(
        "and as assert async await break class continue def del elif else except finally for from global "
        "if import in is lambda nonlocal not or pass raise return try while with yield True False None "
        "self len range enumerate sorted sum min max abs list dict set tuple str int float bool print "
        "append pop add get items keys values zip map filter reversed any all heapq collections".split()
    ),
    "javascript": set(
        "break case catch class const continue debugger default delete do else export extends finally for "
        "function if import in instanceof let new return super switch this throw try typeof var void while "
        "with yield async await of true false null undefined Math Map Set Array Object push pop length "
        "console".split()
    ),
    "java": set(
        "abstract assert boolean break byte case catch char class const continue default do double else enum "
        "extends final finally float for if implements import instanceof int interface long new package "
        "private protected public return short static super switch this throw throws try void volatile "
        "while true false null String List Map Set Arrays HashMap HashSet ArrayList length size".split()
    ),
    "cpp": set(
        "auto bool break case catch char class const continue default delete do double else enum explicit "
        "float for if inline int long namespace new operator private protected public return short signed "
        "sizeof static struct switch template this throw try typedef typename unsigned using virtual void "
        "while true false nullptr string vector map set size push_back".split()
    ),
}

_OPS = r"(?:>>>=|<<=|>>=|\*\*=|//=|===|!==|>>>|\.\.\.|->|\+\+|--|&&|\|\||==|!=|<=|>=|<<|>>|\+=|-=|\*=|/=|%=|&=|\|=|\^=|\*\*|//|::|[-+*/%<>=!&|^~?:.,;(){}\[\]@])"


@dataclass
class Token:
    norm: str
    raw: str
    line: int


def _master_regex(language: str) -> re.Pattern:
    if language == "python":
        comment = r"#[^\n]*"
        strings = r"(?:[rRbBuUfF]{0,2}(?:\"\"\"[\s\S]*?\"\"\"|'''[\s\S]*?'''|\"(?:\\.|[^\"\\\n])*\"|'(?:\\.|[^'\\\n])*'))"
    else:
        comment = r"//[^\n]*|/\*[\s\S]*?\*/" + (r"|^[ \t]*#[^\n]*" if language == "cpp" else "")
        strings = r"(?:\"(?:\\.|[^\"\\\n])*\"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)"
    return re.compile(
        rf"(?P<comment>{comment})|(?P<string>{strings})|(?P<number>\d[\d_]*(?:\.\d+)?(?:[eE][-+]?\d+)?[a-zA-Z]*)"
        rf"|(?P<ident>[A-Za-z_$][A-Za-z0-9_$]*)|(?P<op>{_OPS})|(?P<nl>\n)",
        re.MULTILINE,
    )


_REGEX_CACHE: Dict[str, re.Pattern] = {}


def tokenize(source: str, language: str) -> List[Token]:
    """Comment-free token stream. Unknown characters are skipped, never an error."""
    language = language if language in LANGUAGES else "python"
    rx = _REGEX_CACHE.setdefault(language, _master_regex(language))
    keywords = _KEYWORDS[language]
    out: List[Token] = []
    line = 1
    for m in rx.finditer(source):
        kind, text = m.lastgroup, m.group()
        if kind == "nl":
            line += 1
            continue
        start_line = line
        line += text.count("\n")        # multi-line comments / strings
        if kind == "comment":
            continue
        if kind == "string":
            out.append(Token("STR", "STR", start_line))
        elif kind == "number":
            out.append(Token("NUM", text, start_line))
        elif kind == "ident":
            out.append(Token(text if text in keywords else "ID", text, start_line))
        else:
            out.append(Token(text, text, start_line))
    return out


# ── Fingerprinting ──────────────────────────────────────────────────

def _h(parts: Iterable[str]) -> int:
    return int.from_bytes(hashlib.blake2b("\x1f".join(parts).encode(), digest_size=8).digest(), "big")


def winnow(tokens: List[str], k: int = K_GRAM, w: int = WINDOW) -> Dict[int, int]:
    """{fingerprint: index of the first token of one k-gram that produced it}."""
    if len(tokens) < k:
        return {}
    hashes = [_h(tokens[i:i + k]) for i in range(len(tokens) - k + 1)]
    if len(hashes) <= w:
        i = min(range(len(hashes)), key=lambda j: (hashes[j], -j))
        return {hashes[i]: i}
    picked: Dict[int, int] = {}
    last = -1
    for start in range(len(hashes) - w + 1):
        window = hashes[start:start + w]
        m = min(window)
        pos = start + max(i for i, hv in enumerate(window) if hv == m)   # rightmost minimum
        if pos != last:
            picked.setdefault(window[pos - start], pos)
            last = pos
    return picked


@dataclass
class Solution:
    """One candidate's solution to one question, ready to compare."""
    key: str                          # who (application id)
    language: str
    source: str
    tokens: List[Token] = field(default_factory=list)
    norm_fp: Dict[int, int] = field(default_factory=dict)
    raw_fp: Dict[int, int] = field(default_factory=dict)
    usable: bool = False
    skipped: Optional[str] = None
    draft: bool = False               # never submitted: this is the saved editor draft


def prepare(key: str, language: str, source: str, starter: str = "") -> Solution:
    sol = Solution(key=key, language=language, source=source)
    sol.tokens = tokenize(source, language)
    if len(sol.tokens) < MIN_TOKENS:
        sol.skipped = "too short to compare"
        return sol
    boiler_norm: Set[int] = set()
    boiler_raw: Set[int] = set()
    if starter.strip():
        st = tokenize(starter, language)
        boiler_norm = set(winnow([t.norm for t in st]))
        boiler_raw = set(winnow([t.raw for t in st]))
    sol.norm_fp = {f: p for f, p in winnow([t.norm for t in sol.tokens]).items() if f not in boiler_norm}
    sol.raw_fp = {f: p for f, p in winnow([t.raw for t in sol.tokens]).items() if f not in boiler_raw}
    if len(sol.norm_fp) < MIN_FINGERPRINTS:
        sol.skipped = "too little beyond the starter code"
        return sol
    sol.usable = True
    return sol


# ── Comparison ──────────────────────────────────────────────────────

@dataclass
class Match:
    a: str
    b: str
    language: str
    similarity: float          # rarity-weighted share of the smaller solution found in the other
    overlap: float             # the same, unweighted
    raw_overlap: float         # unweighted, with variable names kept (shared names = stronger evidence)
    shared: int
    level: str


def level_for(similarity: float) -> Optional[str]:
    if similarity >= LEVEL_HIGH:
        return "high"
    if similarity >= LEVEL_MEDIUM:
        return "medium"
    return None


def _weights(solutions: List[Solution]) -> Dict[int, float]:
    n = len(solutions)
    df: Dict[int, int] = {}
    for s in solutions:
        for f in s.norm_fp:
            df[f] = df.get(f, 0) + 1
    if n < MIN_POPULATION_FOR_WEIGHTING:
        return {f: 1.0 for f in df}
    return {f: max(MIN_WEIGHT, min(1.0, 1.0 - (c - 2) / (n - 2))) if c >= 2 else 1.0 for f, c in df.items()}


def compare_all(solutions: List[Solution], min_similarity: float = LEVEL_MEDIUM) -> List[Match]:
    """All pairs (same language) at or above `min_similarity`, most similar first."""
    pool = [s for s in solutions if s.usable]
    out: List[Match] = []
    for lang in {s.language for s in pool}:
        group = [s for s in pool if s.language == lang]
        if len(group) < 2:
            continue
        weight = _weights(group)
        index: Dict[int, List[int]] = {}
        for i, s in enumerate(group):
            for f in s.norm_fp:
                index.setdefault(f, []).append(i)
        shared_counts: Dict[Tuple[int, int], int] = {}
        for owners in index.values():
            for x in range(len(owners)):
                for y in range(x + 1, len(owners)):
                    pair = (owners[x], owners[y])
                    shared_counts[pair] = shared_counts.get(pair, 0) + 1
        for (i, j), count in shared_counts.items():
            a, b = group[i], group[j]
            small, big = (a, b) if len(a.norm_fp) <= len(b.norm_fp) else (b, a)
            common = small.norm_fp.keys() & big.norm_fp.keys()
            # Divide by the plain size: a solution made only of fingerprints everyone has scores ~0.
            sim = sum(weight[f] for f in common) / len(small.norm_fp)
            if sim < min_similarity:
                continue
            raw_small, raw_big = (a, b) if len(a.raw_fp) <= len(b.raw_fp) else (b, a)
            raw = len(raw_small.raw_fp.keys() & raw_big.raw_fp.keys()) / max(1, len(raw_small.raw_fp))
            out.append(Match(
                a=a.key, b=b.key, language=lang, similarity=round(sim, 3),
                overlap=round(count / len(small.norm_fp), 3), raw_overlap=round(raw, 3),
                shared=count, level=level_for(sim) or "medium",
            ))
    out.sort(key=lambda m: (-m.similarity, -m.raw_overlap, m.a, m.b))
    return out


def clusters(matches: List[Match]) -> List[List[str]]:
    """Connected groups of candidates linked by flagged pairs (largest first)."""
    parent: Dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for m in matches:
        parent[find(m.a)] = find(m.b)
    groups: Dict[str, List[str]] = {}
    for x in list(parent):
        groups.setdefault(find(x), []).append(x)
    return sorted((sorted(g) for g in groups.values()), key=lambda g: (-len(g), g))


def matched_lines(a: Solution, b: Solution) -> Tuple[List[int], List[int]]:
    """Source lines of each solution covered by a k-gram the other also contains."""
    common = a.norm_fp.keys() & b.norm_fp.keys()

    def lines(sol: Solution) -> List[int]:
        covered: Set[int] = set()
        for f in common:
            start = sol.norm_fp[f]
            for t in sol.tokens[start:start + K_GRAM]:
                covered.add(t.line)
        return sorted(covered)

    return lines(a), lines(b)
