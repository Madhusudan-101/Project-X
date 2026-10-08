def daily_temperatures(temperatures):
    res, st = [0] * len(temperatures), []
    for i, t in enumerate(temperatures):
        while st and temperatures[st[-1]] < t:
            j = st.pop(); res[j] = i - j
        st.append(i)
    return res
