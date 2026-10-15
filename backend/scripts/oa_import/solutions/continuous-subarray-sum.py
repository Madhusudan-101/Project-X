def check_subarray_sum(nums, k):
    seen, s = {0: -1}, 0
    for i, n in enumerate(nums):
        s += n
        r = s % k if k else s
        if r in seen:
            if i - seen[r] >= 2: return True
        else: seen[r] = i
    return False
