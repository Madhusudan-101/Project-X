def spiral_order(matrix):
    res = []
    m = [r[:] for r in matrix]
    while m:
        res += m.pop(0)
        m = [list(r) for r in zip(*m)][::-1]
    return res
