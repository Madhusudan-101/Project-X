def unique_paths(m, n):
    from math import comb
    return comb(m + n - 2, m - 1)
