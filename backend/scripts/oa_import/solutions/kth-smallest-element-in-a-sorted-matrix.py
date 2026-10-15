def kth_smallest(matrix, k):
    return sorted(x for r in matrix for x in r)[k - 1]
