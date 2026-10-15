def is_interleave(s1, s2, s3):
    if len(s1) + len(s2) != len(s3): return False
    dp = [[False] * (len(s2) + 1) for _ in range(len(s1) + 1)]
    dp[0][0] = True
    for i in range(len(s1) + 1):
        for j in range(len(s2) + 1):
            if i and dp[i-1][j] and s1[i-1] == s3[i+j-1]: dp[i][j] = True
            if j and dp[i][j-1] and s2[j-1] == s3[i+j-1]: dp[i][j] = True
    return dp[-1][-1]
