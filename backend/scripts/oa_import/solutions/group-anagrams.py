def group_anagrams(strs):
    g = {}
    for s in strs: g.setdefault(''.join(sorted(s)), []).append(s)
    return list(g.values())
