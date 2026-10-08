def max_area(height):
    i, j, best = 0, len(height) - 1, 0
    while i < j:
        best = max(best, min(height[i], height[j]) * (j - i))
        if height[i] < height[j]: i += 1
        else: j -= 1
    return best
