def asteroid_collision(asteroids):
    st = []
    for a in asteroids:
        alive = True
        while alive and a < 0 and st and st[-1] > 0:
            if st[-1] < -a: st.pop()
            elif st[-1] == -a: st.pop(); alive = False
            else: alive = False
        if alive: st.append(a)
    return st
