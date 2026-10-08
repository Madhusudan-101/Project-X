def count_bits(n):
    return [bin(i).count('1') for i in range(n + 1)]
