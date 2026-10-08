def majority_element(nums):
    cand, cnt = None, 0
    for n in nums:
        if cnt == 0: cand = n
        cnt += 1 if n == cand else -1
    return cand
