def two_city_sched_cost(costs):
    s = sorted(costs, key=lambda c: c[0] - c[1])
    h = len(s) // 2
    return sum(c[0] for c in s[:h]) + sum(c[1] for c in s[h:])
