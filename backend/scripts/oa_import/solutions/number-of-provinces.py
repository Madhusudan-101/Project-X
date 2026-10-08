def find_circle_num(is_connected):
    n, seen, c = len(is_connected), set(), 0
    for i in range(n):
        if i in seen: continue
        c += 1; st = [i]
        while st:
            u = st.pop()
            if u in seen: continue
            seen.add(u)
            st += [v for v in range(n) if is_connected[u][v] and v not in seen]
    return c
