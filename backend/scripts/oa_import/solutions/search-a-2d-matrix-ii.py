def search_matrix_ii(matrix, target):
    r, c = 0, len(matrix[0]) - 1
    while r < len(matrix) and c >= 0:
        if matrix[r][c] == target: return True
        if matrix[r][c] > target: c -= 1
        else: r += 1
    return False
