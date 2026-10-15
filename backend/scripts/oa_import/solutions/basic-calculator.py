def calculate(s):
    res, num, sign, st = 0, 0, 1, []
    for ch in s:
        if ch.isdigit(): num = num * 10 + int(ch)
        elif ch in '+-':
            res += sign * num; num = 0; sign = 1 if ch == '+' else -1
        elif ch == '(':
            st.append((res, sign)); res, sign = 0, 1
        elif ch == ')':
            res += sign * num; num = 0
            prev, psign = st.pop(); res = prev + psign * res
    return res + sign * num
