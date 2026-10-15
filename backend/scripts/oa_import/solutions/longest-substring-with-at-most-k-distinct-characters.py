def length_of_longest_substring_k_distinct(s, k):
    cnt, lo, best = {}, 0, 0
    for hi, ch in enumerate(s):
        cnt[ch] = cnt.get(ch, 0) + 1
        while len(cnt) > k:
            cnt[s[lo]] -= 1
            if not cnt[s[lo]]: del cnt[s[lo]]
            lo += 1
        best = max(best, hi - lo + 1)
    return best
