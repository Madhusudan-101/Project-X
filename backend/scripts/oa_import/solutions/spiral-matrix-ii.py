def generate_matrix(n):
    m = [[0] * n for _ in range(n)]
    r = c = 0; dr, dc = 0, 1
    for i in range(1, n * n + 1):
        m[r][c] = i
        nr, nc = r + dr, c + dc
        if not (0 <= nr < n and 0 <= nc < n and m[nr][nc] == 0): dr, dc = dc, -dr; nr, nc = r + dr, c + dc
        r, c = nr, nc
    return m
