def is_isomorphic(s, t):
    if len(s) != len(t): return False
    a, b = {}, {}
    for x, y in zip(s, t):
        if a.setdefault(x, y) != y or b.setdefault(y, x) != x:
            return False
    return True
