def valid_tree(n, edges):
    if len(edges) != n - 1: return False
    p = list(range(n))
    def find(x):
        while p[x] != x: p[x] = p[p[x]]; x = p[x]
        return x
    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra == rb: return False
        p[ra] = rb
    return True
