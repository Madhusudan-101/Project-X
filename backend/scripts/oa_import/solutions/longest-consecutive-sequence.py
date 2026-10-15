def longest_consecutive(nums):
    s, best = set(nums), 0
    for n in s:
        if n - 1 not in s:
            m = n
            while m + 1 in s: m += 1
            best = max(best, m - n + 1)
    return best
