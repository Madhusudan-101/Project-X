def longest_word(words):
    built, best = set(), ''
    for w in sorted(words):
        if len(w) == 1 or w[:-1] in built:
            built.add(w)
            if len(w) > len(best): best = w
    return best
