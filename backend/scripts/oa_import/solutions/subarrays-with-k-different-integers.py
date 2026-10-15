def subarrays_with_k_distinct(nums, k):
    def at_most(k):
        cnt, lo, res = {}, 0, 0
        for hi, n in enumerate(nums):
            cnt[n] = cnt.get(n, 0) + 1
            while len(cnt) > k:
                cnt[nums[lo]] -= 1
                if not cnt[nums[lo]]: del cnt[nums[lo]]
                lo += 1
            res += hi - lo + 1
        return res
    return at_most(k) - at_most(k - 1)
