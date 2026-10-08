def count_and_say(n):
    s = "1"
    for _ in range(n - 1):
        out, i = [], 0
        while i < len(s):
            j = i
            while j < len(s) and s[j] == s[i]: j += 1
            out.append(str(j - i) + s[i])
            i = j
        s = ''.join(out)
    return s
