def largest_rectangle_area(heights):
    st, best = [], 0
    for i, h in enumerate(heights + [0]):
        start = i
        while st and st[-1][1] > h:
            idx, hh = st.pop(); best = max(best, hh * (i - idx)); start = idx
        st.append((start, h))
    return best
