from collections import deque
def shortest_path_binary_matrix(grid):
    n = len(grid)
    if grid[0][0] or grid[-1][-1]: return -1
    q, seen = deque([(0, 0, 1)]), {(0, 0)}
    while q:
        r, c, d = q.popleft()
        if (r, c) == (n - 1, n - 1): return d
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                a, b = r + dr, c + dc
                if 0 <= a < n and 0 <= b < n and not grid[a][b] and (a, b) not in seen:
                    seen.add((a, b)); q.append((a, b, d + 1))
    return -1
