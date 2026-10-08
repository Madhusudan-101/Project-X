def find_itinerary(tickets):
    import heapq
    g = {}
    for a, b in tickets: heapq.heappush(g.setdefault(a, []), b)
    route = []
    def visit(a):
        while g.get(a): visit(heapq.heappop(g[a]))
        route.append(a)
    visit("JFK")
    return route[::-1]
