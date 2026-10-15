def employee_free_time(schedule):
    iv = sorted(x for emp in schedule for x in emp)
    res, end = [], iv[0][1]
    for s, e in iv[1:]:
        if s > end: res.append([end, s])
        end = max(end, e)
    return res
