def subsets_with_dup(nums):
    nums, res = sorted(nums), [[]]
    prev_start = 0
    for i, n in enumerate(nums):
        start = prev_start if i > 0 and nums[i-1] == n else 0
        prev_start = len(res)
        res += [r + [n] for r in res[start:]]
    return res
