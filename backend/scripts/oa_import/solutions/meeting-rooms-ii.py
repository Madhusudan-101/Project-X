import heapq
def min_meeting_rooms(intervals):
    h = []
    for s, e in sorted(intervals):
        if h and h[0] <= s: heapq.heapreplace(h, e)
        else: heapq.heappush(h, e)
    return len(h)
