def remove_duplicates(s):
    out = []
    for ch in s:
        if out and out[-1] == ch: out.pop()
        else: out.append(ch)
    return ''.join(out)
