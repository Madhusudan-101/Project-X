def combination_sum2(candidates, target):
    c, res = sorted(candidates), []
    def go(start, rem, cur):
        if rem == 0: res.append(cur[:]); return
        for i in range(start, len(c)):
            if i > start and c[i] == c[i-1]: continue
            if c[i] > rem: break
            cur.append(c[i]); go(i + 1, rem - c[i], cur); cur.pop()
    go(0, target, [])
    return res
