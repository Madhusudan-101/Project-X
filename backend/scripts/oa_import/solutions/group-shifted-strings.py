def group_strings(strings):
    g = {}
    for s in strings:
        key = tuple((ord(c) - ord(s[0])) % 26 for c in s)
        g.setdefault(key, []).append(s)
    return list(g.values())
