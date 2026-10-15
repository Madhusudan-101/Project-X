import bisect
def search_insert(nums, target):
    return bisect.bisect_left(nums, target)
