def matrix_reshape(mat, r, c):
    flat = [x for row in mat for x in row]
    if len(flat) != r * c: return mat
    return [flat[i*c:(i+1)*c] for i in range(r)]
