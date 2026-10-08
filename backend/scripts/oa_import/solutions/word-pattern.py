def word_pattern(pattern, s):
    w = s.split(' ')
    if len(w) != len(pattern): return False
    return len(set(pattern)) == len(set(w)) == len(set(zip(pattern, w)))
