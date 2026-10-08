def reconstruct_queue(people):
    res = []
    for h, k in sorted(people, key=lambda p: (-p[0], p[1])): res.insert(k, [h, k])
    return res
