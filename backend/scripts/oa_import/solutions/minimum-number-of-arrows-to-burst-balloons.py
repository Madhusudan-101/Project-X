def find_min_arrow_shots(points):
    arrows, end = 0, float('-inf')
    for s, e in sorted(points, key=lambda p: p[1]):
        if s > end: arrows += 1; end = e
    return arrows
