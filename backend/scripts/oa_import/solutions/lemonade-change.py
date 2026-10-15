def lemonade_change(bills):
    five = ten = 0
    for b in bills:
        if b == 5: five += 1
        elif b == 10:
            if not five: return False
            five -= 1; ten += 1
        else:
            if ten and five: ten -= 1; five -= 1
            elif five >= 3: five -= 3
            else: return False
    return True
