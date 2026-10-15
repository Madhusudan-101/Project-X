def is_match(s, p):
    i = j = 0; star = -1; mark = 0
    while i < len(s):
        if j < len(p) and (p[j] == '?' or p[j] == s[i]): i += 1; j += 1
        elif j < len(p) and p[j] == '*': star, mark = j, i; j += 1
        elif star != -1: j = star + 1; mark += 1; i = mark
        else: return False
    while j < len(p) and p[j] == '*': j += 1
    return j == len(p)
