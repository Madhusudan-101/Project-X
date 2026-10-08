def two_sum(numbers, target):
    i, j = 0, len(numbers) - 1
    while i < j:
        s = numbers[i] + numbers[j]
        if s == target: return [i + 1, j + 1]
        if s < target: i += 1
        else: j -= 1
