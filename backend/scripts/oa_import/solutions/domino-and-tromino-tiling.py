def num_tilings(n):
    M = 10**9 + 7
    dp = [1, 1, 2] + [0] * max(0, n - 2)
    for i in range(3, n + 1):
        dp[i] = (2 * dp[i-1] + dp[i-3]) % M
    return dp[n] % M
