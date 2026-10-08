def combination_sum4(nums, target):
    dp = [1] + [0] * target
    for t in range(1, target + 1):
        dp[t] = sum(dp[t - n] for n in nums if n <= t)
    return dp[target]
