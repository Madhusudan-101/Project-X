def is_subsequence(s, t):
    it = iter(t)
    return all(ch in it for ch in s)
