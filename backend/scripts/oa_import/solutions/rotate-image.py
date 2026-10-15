def rotate(matrix):
    return [list(r) for r in zip(*matrix[::-1])]
