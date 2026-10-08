def nth_ugly_number(n):
    u = [1]; i2 = i3 = i5 = 0
    while len(u) < n:
        nxt = min(u[i2] * 2, u[i3] * 3, u[i5] * 5)
        u.append(nxt)
        if nxt == u[i2] * 2: i2 += 1
        if nxt == u[i3] * 3: i3 += 1
        if nxt == u[i5] * 5: i5 += 1
    return u[n - 1]
