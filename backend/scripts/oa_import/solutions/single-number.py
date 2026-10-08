def single_number(nums):
    x = 0
    for n in nums: x ^= n
    return x
