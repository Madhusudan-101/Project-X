def check_inclusion(s1, s2):
    from collections import Counter
    need, win = Counter(s1), Counter()
    for i, ch in enumerate(s2):
        win[ch] += 1
        if i >= len(s1):
            o = s2[i - len(s1)]; win[o] -= 1
            if not win[o]: del win[o]
        if win == need: return True
    return False
