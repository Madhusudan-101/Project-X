import sys
def critical_connections(n, connections):
    sys.setrecursionlimit(10000)
    adj = [[] for _ in range(n)]
    for a, b in connections:
        adj[a].append(b); adj[b].append(a)
    disc, low, t, res = [-1] * n, [0] * n, [0], []
    def dfs(u, parent):
        disc[u] = low[u] = t[0]; t[0] += 1
        for v in adj[u]:
            if v == parent: continue
            if disc[v] == -1:
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]: res.append([u, v])
            else: low[u] = min(low[u], disc[v])
    for i in range(n):
        if disc[i] == -1: dfs(i, -1)
    return res
