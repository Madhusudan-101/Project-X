def title_to_number(column_title):
    n = 0
    for ch in column_title:
        n = n * 26 + (ord(ch) - 64)
    return n
