def can_attend_meetings(intervals):
    iv = sorted(intervals)
    return all(iv[i][1] <= iv[i+1][0] for i in range(len(iv) - 1))
