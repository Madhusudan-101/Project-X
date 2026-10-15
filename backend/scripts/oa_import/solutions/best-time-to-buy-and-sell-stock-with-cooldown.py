def max_profit(prices):
    hold, sold, rest = float('-inf'), 0, 0
    for p in prices:
        hold, sold, rest = max(hold, rest - p), hold + p, max(rest, sold)
    return max(sold, rest)
