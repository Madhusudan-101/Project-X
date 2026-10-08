def total_fruit(fruits):
    cnt, lo, best = {}, 0, 0
    for hi, f in enumerate(fruits):
        cnt[f] = cnt.get(f, 0) + 1
        while len(cnt) > 2:
            cnt[fruits[lo]] -= 1
            if not cnt[fruits[lo]]: del cnt[fruits[lo]]
            lo += 1
        best = max(best, hi - lo + 1)
    return best
