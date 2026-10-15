def least_interval(tasks, n):
    from collections import Counter
    c = Counter(tasks)
    mx = max(c.values())
    return max(len(tasks), (mx - 1) * (n + 1) + sum(1 for v in c.values() if v == mx))
