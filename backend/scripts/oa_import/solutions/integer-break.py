def integer_break(n):
    if n <= 3: return n - 1
    q, r = divmod(n, 3)
    return 3 ** q if r == 0 else 3 ** (q - 1) * 4 if r == 1 else 3 ** q * 2
