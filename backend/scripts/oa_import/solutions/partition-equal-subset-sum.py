def can_partition(nums):
    t = sum(nums)
    if t % 2: return False
    reach = {0}
    for n in nums:
        reach |= {r + n for r in reach}
    return t // 2 in reach
