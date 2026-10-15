def can_reach(arr, start):
    seen, st = set(), [start]
    while st:
        i = st.pop()
        if i < 0 or i >= len(arr) or i in seen: continue
        if arr[i] == 0: return True
        seen.add(i)
        st += [i + arr[i], i - arr[i]]
    return False
