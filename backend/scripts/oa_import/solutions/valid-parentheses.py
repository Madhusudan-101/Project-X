def valid_parentheses(s):
    pair, st = {')': '(', ']': '[', '}': '{'}, []
    for ch in s:
        if ch in pair:
            if not st or st.pop() != pair[ch]: return False
        else: st.append(ch)
    return not st
