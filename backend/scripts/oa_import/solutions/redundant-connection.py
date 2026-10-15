def find_redundant_connection(edges):
    p = list(range(len(edges) + 1))
    def find(x):
        while p[x] != x: p[x] = p[p[x]]; x = p[x]
        return x
    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra == rb: return [a, b]
        p[ra] = rb
