from collections import deque
def ladder_length(begin_word, end_word, word_list):
    words = set(word_list)
    if end_word not in words: return 0
    q, seen = deque([(begin_word, 1)]), {begin_word}
    while q:
        w, d = q.popleft()
        if w == end_word: return d
        for i in range(len(w)):
            for c in 'abcdefghijklmnopqrstuvwxyz':
                n = w[:i] + c + w[i+1:]
                if n in words and n not in seen: seen.add(n); q.append((n, d + 1))
    return 0
