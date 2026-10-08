def max_profit(k, prices):
    if not prices: return 0
    if k >= len(prices) // 2:
        return sum(max(0, b - a) for a, b in zip(prices, prices[1:]))
    buy, sell = [float('-inf')] * (k + 1), [0] * (k + 1)
    for p in prices:
        for j in range(1, k + 1):
            buy[j] = max(buy[j], sell[j-1] - p)
            sell[j] = max(sell[j], buy[j] + p)
    return sell[k]
