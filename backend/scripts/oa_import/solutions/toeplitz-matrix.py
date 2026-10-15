def is_toeplitz_matrix(matrix):
    return all(matrix[i][j] == matrix[i+1][j+1] for i in range(len(matrix)-1) for j in range(len(matrix[0])-1))
