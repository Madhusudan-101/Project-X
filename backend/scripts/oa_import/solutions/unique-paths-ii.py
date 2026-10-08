def unique_paths_with_obstacles(obstacle_grid):
    n = len(obstacle_grid[0])
    dp = [0] * n; dp[0] = 1
    for row in obstacle_grid:
        for j in range(n):
            if row[j] == 1: dp[j] = 0
            elif j: dp[j] += dp[j-1]
    return dp[-1]
