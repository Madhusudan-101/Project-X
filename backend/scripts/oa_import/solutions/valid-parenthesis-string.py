def check_valid_string(s):
    lo = hi = 0
    for ch in s:
        lo += 1 if ch == '(' else -1
        hi += 1 if ch != ')' else -1
        if hi < 0: return False
        lo = max(lo, 0)
    return lo == 0
