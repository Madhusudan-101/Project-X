def max_frequency(nums, k):
    nums = sorted(nums); lo = total = best = 0
    for hi, n in enumerate(nums):
        total += n
        while n * (hi - lo + 1) - total > k:
            total -= nums[lo]; lo += 1
        best = max(best, hi - lo + 1)
    return best
