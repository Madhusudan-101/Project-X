def split_array(nums, m):
    def ok(cap):
        parts, cur = 1, 0
        for n in nums:
            if cur + n > cap: parts += 1; cur = 0
            cur += n
        return parts <= m
    lo, hi = max(nums), sum(nums)
    while lo < hi:
        mid = (lo + hi) // 2
        if ok(mid): hi = mid
        else: lo = mid + 1
    return lo
