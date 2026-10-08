def my_calendar(bookings):
    booked, res = [], []
    for s, e in bookings:
        if all(e <= bs or s >= be for bs, be in booked): booked.append((s, e)); res.append(True)
        else: res.append(False)
    return res
