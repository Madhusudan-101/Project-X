def my_atoi(s):
    s = s.lstrip(' ')
    if not s: return 0
    sign, i = 1, 0
    if s[0] in '+-': sign = -1 if s[0] == '-' else 1; i = 1
    n = 0
    while i < len(s) and s[i].isdigit(): n = n * 10 + int(s[i]); i += 1
    n *= sign
    return max(-2**31, min(2**31 - 1, n))
