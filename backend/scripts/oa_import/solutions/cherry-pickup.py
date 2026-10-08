def cherry_pickup(grid):
    from functools import lru_cache
    n = len(grid)
    @lru_cache(None)
    def go(r1, c1, r2):
        c2 = r1 + c1 - r2
        if r1 >= n or c1 >= n or r2 >= n or c2 >= n or grid[r1][c1] == -1 or grid[r2][c2] == -1:
            return float('-inf')
        if r1 == n - 1 and c1 == n - 1: return grid[r1][c1]
        v = grid[r1][c1] + (grid[r2][c2] if (r1, c1) != (r2, c2) else 0)
        return v + max(go(r1+1, c1, r2+1), go(r1+1, c1, r2), go(r1, c1+1, r2+1), go(r1, c1+1, r2))
    return max(0, go(0, 0, 0))
