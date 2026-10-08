def compare_version(version1, version2):
    a, b = [int(x) for x in version1.split('.')], [int(x) for x in version2.split('.')]
    for i in range(max(len(a), len(b))):
        x = a[i] if i < len(a) else 0
        y = b[i] if i < len(b) else 0
        if x != y: return -1 if x < y else 1
    return 0
