def reverse_vowels(s):
    v = [c for c in s if c in 'aeiouAEIOU']
    return ''.join(v.pop() if c in 'aeiouAEIOU' else c for c in s)
