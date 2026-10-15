def is_one_edit_distance(s, t):
    if abs(len(s) - len(t)) > 1 or s == t: return False
    if len(s) > len(t): s, t = t, s
    for i in range(len(s)):
        if s[i] != t[i]:
            return s[i:] == t[i+1:] if len(s) != len(t) else s[i+1:] == t[i+1:]
    return True
