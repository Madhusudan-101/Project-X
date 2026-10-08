def eval_rpn(tokens):
    st = []
    for t in tokens:
        if t in '+-*/' and len(t) == 1:
            b, a = st.pop(), st.pop()
            st.append(a + b if t == '+' else a - b if t == '-' else a * b if t == '*' else int(a / b))
        else: st.append(int(t))
    return st[0]
