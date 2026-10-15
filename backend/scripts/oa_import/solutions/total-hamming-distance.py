def total_hamming_distance(nums):
    t = 0
    for b in range(32):
        ones = sum((n >> b) & 1 for n in nums)
        t += ones * (len(nums) - ones)
    return t
