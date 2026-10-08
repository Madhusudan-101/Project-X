def max_area_of_island(grid):
    g = [r[:] for r in grid]
    best = 0
    for i in range(len(g)):
        for j in range(len(g[0])):
            if g[i][j] == 1:
                st, area = [(i, j)], 0
                g[i][j] = 0
                while st:
                    r, c = st.pop(); area += 1
                    for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):
                        a, b = r + dr, c + dc
                        if 0 <= a < len(g) and 0 <= b < len(g[0]) and g[a][b] == 1:
                            g[a][b] = 0; st.append((a, b))
                best = max(best, area)
    return best
