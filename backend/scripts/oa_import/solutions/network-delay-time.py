import heapq
def network_delay_time(times, n, k):
    adj = {}
    for u, v, w in times: adj.setdefault(u, []).append((v, w))
    dist, h = {}, [(0, k)]
    while h:
        d, u = heapq.heappop(h)
        if u in dist: continue
        dist[u] = d
        for v, w in adj.get(u, []):
            if v not in dist: heapq.heappush(h, (d + w, v))
    return max(dist.values()) if len(dist) == n else -1
