def remove_covered_intervals(intervals):
    c, end = 0, 0
    for s, e in sorted(intervals, key=lambda x: (x[0], -x[1])):
        if e > end: c += 1; end = e
    return c
