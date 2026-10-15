def num_islands(grid):
    m, n = len(grid), len(grid[0]); seen = set(); c = 0
    for i in range(m):
        for j in range(n):
            if grid[i][j] == '1' and (i, j) not in seen:
                c += 1; st = [(i, j)]; seen.add((i, j))
                while st:
                    r, cc = st.pop()
                    for a, b in ((r+1,cc),(r-1,cc),(r,cc+1),(r,cc-1)):
                        if 0 <= a < m and 0 <= b < n and grid[a][b] == '1' and (a, b) not in seen:
                            seen.add((a, b)); st.append((a, b))
    return c
