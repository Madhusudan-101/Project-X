def replace_words(dictionary, sentence):
    roots = set(dictionary); out = []
    for w in sentence.split(' '):
        for i in range(1, len(w) + 1):
            if w[:i] in roots: w = w[:i]; break
        out.append(w)
    return ' '.join(out)
