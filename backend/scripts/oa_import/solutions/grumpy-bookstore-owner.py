def max_satisfied(customers, grumpy, minutes):
    base = sum(c for c, g in zip(customers, grumpy) if not g)
    extra = best = 0
    for i, (c, g) in enumerate(zip(customers, grumpy)):
        extra += c * g
        if i >= minutes: extra -= customers[i - minutes] * grumpy[i - minutes]
        best = max(best, extra)
    return base + best
