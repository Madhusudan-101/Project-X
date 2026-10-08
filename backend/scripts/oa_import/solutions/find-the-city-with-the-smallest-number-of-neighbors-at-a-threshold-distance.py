def find_the_city(n, edges, distance_threshold):
    INF = float('inf')
    d = [[INF] * n for _ in range(n)]
    for i in range(n): d[i][i] = 0
    for a, b, w in edges: d[a][b] = d[b][a] = min(d[a][b], w)
    for k in range(n):
        for i in range(n):
            for j in range(n):
                if d[i][k] + d[k][j] < d[i][j]: d[i][j] = d[i][k] + d[k][j]
    best, ans = INF, -1
    for i in range(n):
        c = sum(1 for j in range(n) if j != i and d[i][j] <= distance_threshold)
        if c <= best: best, ans = c, i
    return ans
