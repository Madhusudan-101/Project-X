def is_bipartite(graph):
    color = {}
    for s in range(len(graph)):
        if s in color: continue
        color[s] = 0; st = [s]
        while st:
            u = st.pop()
            for v in graph[u]:
                if v not in color: color[v] = color[u] ^ 1; st.append(v)
                elif color[v] == color[u]: return False
    return True
