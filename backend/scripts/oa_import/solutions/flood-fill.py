def flood_fill(image, sr, sc, color):
    img = [row[:] for row in image]
    old = img[sr][sc]
    if old == color: return img
    stack = [(sr, sc)]
    while stack:
        r, c = stack.pop()
        if 0 <= r < len(img) and 0 <= c < len(img[0]) and img[r][c] == old:
            img[r][c] = color
            stack += [(r+1, c), (r-1, c), (r, c+1), (r, c-1)]
    return img
