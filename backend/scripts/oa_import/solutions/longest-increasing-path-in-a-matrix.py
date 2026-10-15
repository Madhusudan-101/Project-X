def longest_increasing_path(matrix):
    from functools import lru_cache
    m, n = len(matrix), len(matrix[0])
    @lru_cache(None)
    def go(i, j):
        best = 1
        for a, b in ((i+1,j),(i-1,j),(i,j+1),(i,j-1)):
            if 0 <= a < m and 0 <= b < n and matrix[a][b] > matrix[i][j]:
                best = max(best, 1 + go(a, b))
        return best
    return max(go(i, j) for i in range(m) for j in range(n))
