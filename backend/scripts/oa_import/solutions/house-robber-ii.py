def rob_circular(nums):
    def line(a):
        x = y = 0
        for n in a: x, y = y, max(y, x + n)
        return y
    return nums[0] if len(nums) == 1 else max(line(nums[1:]), line(nums[:-1]))
