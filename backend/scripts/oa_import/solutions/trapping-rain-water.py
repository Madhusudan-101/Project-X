def trap(height):
    l, r, lm, rm, w = 0, len(height) - 1, 0, 0, 0
    while l < r:
        if height[l] < height[r]:
            lm = max(lm, height[l]); w += lm - height[l]; l += 1
        else:
            rm = max(rm, height[r]); w += rm - height[r]; r -= 1
    return w
