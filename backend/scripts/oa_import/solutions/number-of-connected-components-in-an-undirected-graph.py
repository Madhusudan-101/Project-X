def count_components(n, edges):
    p = list(range(n))
    def find(x):
        while p[x] != x: p[x] = p[p[x]]; x = p[x]
        return x
    c = n
    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra != rb: p[ra] = rb; c -= 1
    return c
