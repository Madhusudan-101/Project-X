def car_fleet(target, position, speed):
    fleets, prev = 0, 0.0
    for pos, sp in sorted(zip(position, speed), reverse=True):
        t = (target - pos) / sp
        if t > prev: fleets += 1; prev = t
    return fleets
