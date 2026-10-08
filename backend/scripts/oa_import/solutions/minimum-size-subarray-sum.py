def min_sub_array_len(target, nums):
    lo = s = 0; best = float('inf')
    for hi, n in enumerate(nums):
        s += n
        while s >= target:
            best = min(best, hi - lo + 1); s -= nums[lo]; lo += 1
    return 0 if best == float('inf') else best
