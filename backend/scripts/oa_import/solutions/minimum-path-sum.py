def min_path_sum(grid):
    m, n = len(grid), len(grid[0])
    dp = [[0] * n for _ in range(m)]
    for i in range(m):
        for j in range(n):
            if i == 0 and j == 0: dp[i][j] = grid[0][0]
            else: dp[i][j] = grid[i][j] + min(dp[i-1][j] if i else float('inf'), dp[i][j-1] if j else float('inf'))
    return dp[-1][-1]
