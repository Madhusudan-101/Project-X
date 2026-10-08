def find_target_sum_ways(nums, target):
    ways = {0: 1}
    for n in nums:
        nxt = {}
        for s, c in ways.items():
            nxt[s + n] = nxt.get(s + n, 0) + c
            nxt[s - n] = nxt.get(s - n, 0) + c
        ways = nxt
    return ways.get(target, 0)
