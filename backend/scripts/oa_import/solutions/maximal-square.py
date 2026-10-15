def maximal_square(matrix):
    best = 0
    prev = [0] * (len(matrix[0]) + 1)
    for row in matrix:
        cur = [0]
        for j, ch in enumerate(row):
            cur.append(min(prev[j], prev[j+1], cur[j]) + 1 if ch == '1' else 0)
            best = max(best, cur[-1])
        prev = cur
    return best * best
