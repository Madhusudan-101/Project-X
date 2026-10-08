def min_cost_connect_points(points):
    n = len(points)
    dist = [float('inf')] * n; used = [False] * n; dist[0] = 0; total = 0
    for _ in range(n):
        u = min((i for i in range(n) if not used[i]), key=lambda i: dist[i])
        used[u] = True; total += dist[u]
        for v in range(n):
            if not used[v]:
                dist[v] = min(dist[v], abs(points[u][0]-points[v][0]) + abs(points[u][1]-points[v][1]))
    return total
