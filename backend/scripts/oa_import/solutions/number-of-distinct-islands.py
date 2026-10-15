def num_distinct_islands(grid):
    m, n = len(grid), len(grid[0]); seen = set(); shapes = set()
    for i in range(m):
        for j in range(n):
            if grid[i][j] == 1 and (i, j) not in seen:
                st, cells = [(i, j)], []
                seen.add((i, j))
                while st:
                    r, c = st.pop(); cells.append((r - i, c - j))
                    for a, b in ((r+1,c),(r-1,c),(r,c+1),(r,c-1)):
                        if 0 <= a < m and 0 <= b < n and grid[a][b] == 1 and (a, b) not in seen:
                            seen.add((a, b)); st.append((a, b))
                shapes.add(tuple(sorted(cells)))
    return len(shapes)
