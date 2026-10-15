def max_product(nums):
    best = hi = lo = nums[0]
    for n in nums[1:]:
        cand = (n, hi * n, lo * n)
        hi, lo = max(cand), min(cand)
        best = max(best, hi)
    return best
