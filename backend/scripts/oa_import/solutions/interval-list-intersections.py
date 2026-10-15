def interval_intersection(first_list, second_list):
    i = j = 0; res = []
    while i < len(first_list) and j < len(second_list):
        lo = max(first_list[i][0], second_list[j][0]); hi = min(first_list[i][1], second_list[j][1])
        if lo <= hi: res.append([lo, hi])
        if first_list[i][1] < second_list[j][1]: i += 1
        else: j += 1
    return res
