def plus_one(digits):
    return [int(c) for c in str(int(''.join(map(str, digits))) + 1)]
