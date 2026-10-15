def max_increase_keeping_skyline(grid):
    rows = [max(r) for r in grid]; cols = [max(c) for c in zip(*grid)]
    return sum(min(rows[i], cols[j]) - grid[i][j] for i in range(len(grid)) for j in range(len(grid[0])))
