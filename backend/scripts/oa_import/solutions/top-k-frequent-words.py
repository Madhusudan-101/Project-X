def top_k_frequent(words, k):
    from collections import Counter
    c = Counter(words)
    return sorted(c, key=lambda w: (-c[w], w))[:k]
