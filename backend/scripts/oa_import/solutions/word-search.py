def exist(board, word):
    m, n = len(board), len(board[0])
    def go(i, j, k):
        if k == len(word): return True
        if not (0 <= i < m and 0 <= j < n) or board[i][j] != word[k]: return False
        keep, board[i][j] = board[i][j], '#'
        ok = go(i+1, j, k+1) or go(i-1, j, k+1) or go(i, j+1, k+1) or go(i, j-1, k+1)
        board[i][j] = keep
        return ok
    return any(go(i, j, 0) for i in range(m) for j in range(n))
