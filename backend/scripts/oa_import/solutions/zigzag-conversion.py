def convert(s, num_rows):
    if num_rows == 1 or num_rows >= len(s): return s
    rows, r, d = [''] * num_rows, 0, 1
    for ch in s:
        rows[r] += ch
        if r == 0: d = 1
        elif r == num_rows - 1: d = -1
        r += d
    return ''.join(rows)
