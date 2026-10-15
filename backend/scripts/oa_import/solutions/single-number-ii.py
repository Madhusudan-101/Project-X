def single_number_ii(nums):
    from collections import Counter
    return next(k for k, v in Counter(nums).items() if v == 1)
