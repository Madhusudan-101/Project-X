def unique_paths_iii(grid):
    m, n = len(grid), len(grid[0]); empty = 0
    for i in range(m):
        for j in range(n):
            if grid[i][j] == 1: sr, sc = i, j
            if grid[i][j] != -1: empty += 1
    def go(r, c, left):
        if grid[r][c] == 2: return 1 if left == 0 else 0
        keep, grid[r][c] = grid[r][c], -1
        t = 0
        for a, b in ((r+1,c),(r-1,c),(r,c+1),(r,c-1)):
            if 0 <= a < m and 0 <= b < n and grid[a][b] != -1: t += go(a, b, left - 1)
        grid[r][c] = keep
        return t
    return go(sr, sc, empty - 1)
