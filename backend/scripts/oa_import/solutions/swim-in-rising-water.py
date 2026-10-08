import heapq
def swim_in_water(grid):
    n = len(grid); h = [(grid[0][0], 0, 0)]; seen = {(0, 0)}
    while h:
        t, r, c = heapq.heappop(h)
        if (r, c) == (n - 1, n - 1): return t
        for a, b in ((r+1,c),(r-1,c),(r,c+1),(r,c-1)):
            if 0 <= a < n and 0 <= b < n and (a, b) not in seen:
                seen.add((a, b)); heapq.heappush(h, (max(t, grid[a][b]), a, b))
