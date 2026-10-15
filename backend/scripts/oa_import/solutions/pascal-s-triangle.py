def generate_pascals_triangle(num_rows):
    rows = []
    for i in range(num_rows):
        row = [1] * (i + 1)
        for j in range(1, i):
            row[j] = rows[i-1][j-1] + rows[i-1][j]
        rows.append(row)
    return rows
