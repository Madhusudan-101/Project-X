def subsets(nums):
    res = [[]]
    for n in nums: res += [r + [n] for r in res]
    return res
