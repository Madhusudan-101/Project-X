#!/usr/bin/env python3
"""Split a bundle of `### <problem-id>` sections into solutions/<id>.py (authoring helper)."""
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
out = Path(__file__).parent / "solutions"
out.mkdir(exist_ok=True)
for m in re.finditer(r"^### (\S+)\n(.*?)(?=^### |\Z)", text, re.S | re.M):
    (out / f"{m.group(1)}.py").write_text(m.group(2).strip() + "\n")
    print("wrote", m.group(1))
