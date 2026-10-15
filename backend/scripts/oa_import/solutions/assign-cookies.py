def find_content_children(g, s):
    g, s = sorted(g), sorted(s)
    i = 0
    for cookie in s:
        if i < len(g) and cookie >= g[i]:
            i += 1
    return i
