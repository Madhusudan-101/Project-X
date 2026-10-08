def rob(nums):
    a = b = 0
    for n in nums: a, b = b, max(b, a + n)
    return b
