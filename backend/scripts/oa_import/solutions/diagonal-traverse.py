def find_diagonal_order(matrix):
    if not matrix: return []
    m, n = len(matrix), len(matrix[0])
    res = []
    for d in range(m + n - 1):
        cells = [(i, d - i) for i in range(m) if 0 <= d - i < n]
        if d % 2 == 0: cells.reverse()
        res += [matrix[i][j] for i, j in cells]
    return res
