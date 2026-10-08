def erase_overlap_intervals(intervals):
    removed, end = 0, float('-inf')
    for s, e in sorted(intervals, key=lambda p: p[1]):
        if s >= end: end = e
        else: removed += 1
    return removed
