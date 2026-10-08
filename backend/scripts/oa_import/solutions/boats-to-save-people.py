def num_rescue_boats(people, limit):
    p = sorted(people)
    i, j, boats = 0, len(p) - 1, 0
    while i <= j:
        if p[i] + p[j] <= limit: i += 1
        j -= 1; boats += 1
    return boats
