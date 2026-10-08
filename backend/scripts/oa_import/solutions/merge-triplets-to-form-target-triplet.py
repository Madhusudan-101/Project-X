def can_form_target(triplets, target):
    got = [False] * 3
    for t in triplets:
        if all(t[i] <= target[i] for i in range(3)):
            for i in range(3):
                if t[i] == target[i]: got[i] = True
    return all(got)
