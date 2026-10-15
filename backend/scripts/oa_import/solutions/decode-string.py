def decode_string(s):
    st, cur, num = [], '', 0
    for ch in s:
        if ch.isdigit(): num = num * 10 + int(ch)
        elif ch == '[': st.append((cur, num)); cur, num = '', 0
        elif ch == ']':
            prev, k = st.pop(); cur = prev + cur * k
        else: cur += ch
    return cur
