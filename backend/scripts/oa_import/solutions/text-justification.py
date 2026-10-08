def full_justify(words, max_width):
    res, line, length = [], [], 0
    for w in words:
        if length + len(w) + len(line) > max_width:
            gaps = len(line) - 1
            if gaps == 0: res.append(line[0].ljust(max_width))
            else:
                spaces = max_width - length
                q, r = divmod(spaces, gaps)
                res.append(''.join(word + ' ' * (q + (1 if i < r else 0)) for i, word in enumerate(line[:-1])) + line[-1])
            line, length = [], 0
        line.append(w); length += len(w)
    res.append(' '.join(line).ljust(max_width))
    return res
