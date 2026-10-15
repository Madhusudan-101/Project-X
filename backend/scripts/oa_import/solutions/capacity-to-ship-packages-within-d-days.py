def ship_within_days(weights, days):
    def ok(cap):
        d, cur = 1, 0
        for w in weights:
            if cur + w > cap: d += 1; cur = 0
            cur += w
        return d <= days
    lo, hi = max(weights), sum(weights)
    while lo < hi:
        mid = (lo + hi) // 2
        if ok(mid): hi = mid
        else: lo = mid + 1
    return lo
