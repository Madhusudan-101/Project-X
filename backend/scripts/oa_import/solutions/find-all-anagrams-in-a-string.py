def find_anagrams(s, p):
    from collections import Counter
    need, win, res = Counter(p), Counter(), []
    for i, ch in enumerate(s):
        win[ch] += 1
        if i >= len(p):
            old = s[i - len(p)]
            win[old] -= 1
            if win[old] == 0: del win[old]
        if win == need: res.append(i - len(p) + 1)
    return res
