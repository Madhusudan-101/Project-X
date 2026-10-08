import bisect
def search_range(nums, target):
    lo = bisect.bisect_left(nums, target)
    if lo == len(nums) or nums[lo] != target: return [-1, -1]
    return [lo, bisect.bisect_right(nums, target) - 1]
