def delete_and_earn(nums):
    pts = {}
    for n in nums: pts[n] = pts.get(n, 0) + n
    take = skip = 0
    prev = None
    for k in sorted(pts):
        if prev is not None and k == prev + 1:
            take, skip = skip + pts[k], max(take, skip)
        else:
            take, skip = max(take, skip) + pts[k], max(take, skip)
        prev = k
    return max(take, skip)
