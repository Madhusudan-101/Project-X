def length_of_last_word(s):
    words = s.split()
    return len(words[-1]) if words else 0
