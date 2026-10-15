from collections import Counter
def can_construct(ransom_note, magazine):
    return not (Counter(ransom_note) - Counter(magazine))
