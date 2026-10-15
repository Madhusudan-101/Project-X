def find_cheapest_price(n, flights, src, dst, k):
    dist = [float('inf')] * n; dist[src] = 0
    for _ in range(k + 1):
        nd = dist[:]
        for u, v, w in flights:
            if dist[u] + w < nd[v]: nd[v] = dist[u] + w
        dist = nd
    return -1 if dist[dst] == float('inf') else dist[dst]
