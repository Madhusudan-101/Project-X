from collections import deque
def oranges_rotting(grid):
    g = [r[:] for r in grid]; q = deque(); fresh = 0
    for i, r in enumerate(g):
        for j, v in enumerate(r):
            if v == 2: q.append((i, j, 0))
            elif v == 1: fresh += 1
    t = 0
    while q:
        i, j, t = q.popleft()
        for a, b in ((i+1,j),(i-1,j),(i,j+1),(i,j-1)):
            if 0 <= a < len(g) and 0 <= b < len(g[0]) and g[a][b] == 1:
                g[a][b] = 2; fresh -= 1; q.append((a, b, t + 1))
    return t if fresh == 0 else -1
