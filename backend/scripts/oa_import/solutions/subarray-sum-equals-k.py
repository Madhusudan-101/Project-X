def subarray_sum(nums, k):
    seen, s, c = {0: 1}, 0, 0
    for n in nums:
        s += n
        c += seen.get(s - k, 0)
        seen[s] = seen.get(s, 0) + 1
    return c
