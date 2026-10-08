def backspace_compare(s, t):
    def build(x):
        out = []
        for ch in x:
            if ch == '#':
                if out: out.pop()
            else:
                out.append(ch)
        return out
    return build(s) == build(t)
