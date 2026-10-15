def combination_sum(candidates, target):
    res = []
    def go(start, rem, cur):
        if rem == 0: res.append(cur[:]); return
        for i in range(start, len(candidates)):
            if candidates[i] <= rem:
                cur.append(candidates[i]); go(i, rem - candidates[i], cur); cur.pop()
    go(0, target, [])
    return res
