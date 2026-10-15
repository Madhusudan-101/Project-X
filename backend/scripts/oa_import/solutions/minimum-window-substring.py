def min_window(s, t):
    from collections import Counter
    need, missing = Counter(t), len(t)
    best, lo = (float('inf'), 0, 0), 0
    for hi, ch in enumerate(s):
        if need[ch] > 0: missing -= 1
        need[ch] -= 1
        if missing == 0:
            while need[s[lo]] < 0:
                need[s[lo]] += 1; lo += 1
            if hi - lo + 1 < best[0]: best = (hi - lo + 1, lo, hi)
            need[s[lo]] += 1; missing += 1; lo += 1
    return "" if best[0] == float('inf') else s[best[1]:best[2] + 1]
