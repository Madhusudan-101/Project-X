def max_profit(prices):
    best, low = 0, float('inf')
    for p in prices:
        low = min(low, p)
        best = max(best, p - low)
    return best
