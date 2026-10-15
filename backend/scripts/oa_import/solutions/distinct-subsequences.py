def num_distinct(s, t):
    dp = [1] + [0] * len(t)
    for ch in s:
        for j in range(len(t), 0, -1):
            if t[j-1] == ch: dp[j] += dp[j-1]
    return dp[len(t)]
