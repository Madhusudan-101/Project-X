def is_n_straight_hand(hand, group_size):
    from collections import Counter
    if len(hand) % group_size: return False
    c = Counter(hand)
    for x in sorted(c):
        if c[x] > 0:
            need = c[x]
            for y in range(x, x + group_size):
                if c[y] < need: return False
                c[y] -= need
    return True
