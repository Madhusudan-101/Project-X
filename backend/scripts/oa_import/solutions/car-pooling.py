def car_pooling(trips, capacity):
    ev = {}
    for n, a, b in trips:
        ev[a] = ev.get(a, 0) + n
        ev[b] = ev.get(b, 0) - n
    cur = 0
    for k in sorted(ev):
        cur += ev[k]
        if cur > capacity: return False
    return True
