def repeated_substring_pattern(s):
    return (s + s)[1:-1].find(s) != -1
