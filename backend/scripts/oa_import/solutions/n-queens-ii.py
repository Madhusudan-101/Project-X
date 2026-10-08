def total_n_queens(n):
    cols, d1, d2 = set(), set(), set()
    def go(r):
        if r == n: return 1
        c = 0
        for col in range(n):
            if col in cols or r - col in d1 or r + col in d2: continue
            cols.add(col); d1.add(r - col); d2.add(r + col)
            c += go(r + 1)
            cols.discard(col); d1.discard(r - col); d2.discard(r + col)
        return c
    return go(0)
