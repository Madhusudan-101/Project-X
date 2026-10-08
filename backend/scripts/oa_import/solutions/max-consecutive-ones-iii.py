def longest_ones(nums, k):
    lo = zeros = best = 0
    for hi, n in enumerate(nums):
        zeros += n == 0
        while zeros > k:
            zeros -= nums[lo] == 0; lo += 1
        best = max(best, hi - lo + 1)
    return best
