def insert(intervals, new_interval):
    res, s, e = [], new_interval[0], new_interval[1]
    placed = False
    for a, b in intervals:
        if b < s: res.append([a, b])
        elif a > e:
            if not placed: res.append([s, e]); placed = True
            res.append([a, b])
        else: s, e = min(s, a), max(e, b)
    if not placed: res.append([s, e])
    return res
