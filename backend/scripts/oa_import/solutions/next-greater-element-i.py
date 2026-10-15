def next_greater_element(nums1, nums2):
    nxt, stack = {}, []
    for x in nums2:
        while stack and stack[-1] < x:
            nxt[stack.pop()] = x
        stack.append(x)
    return [nxt.get(x, -1) for x in nums1]
