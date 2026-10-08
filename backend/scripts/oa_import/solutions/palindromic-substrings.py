def count_substrings(s):
    c = 0
    for ctr in range(2 * len(s) - 1):
        l, r = ctr // 2, ctr // 2 + ctr % 2
        while l >= 0 and r < len(s) and s[l] == s[r]: c += 1; l -= 1; r += 1
    return c
