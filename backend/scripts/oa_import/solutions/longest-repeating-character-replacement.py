def character_replacement(s, k):
    cnt, best, lo, mx = {}, 0, 0, 0
    for hi, ch in enumerate(s):
        cnt[ch] = cnt.get(ch, 0) + 1
        mx = max(mx, cnt[ch])
        while hi - lo + 1 - mx > k:
            cnt[s[lo]] -= 1; lo += 1
        best = max(best, hi - lo + 1)
    return best
