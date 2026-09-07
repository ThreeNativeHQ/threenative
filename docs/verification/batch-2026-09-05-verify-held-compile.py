"""Check held-frame progress; require the host process exit separately."""
import json
import pathlib
import sys

marker = "TN_HELD_COMPILE:"
rows = [json.loads(line.split(marker, 1)[1])
        for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if marker in line]
if len(rows) != 1:
    raise RuntimeError("expected exactly one held-compile marker")
result = rows[0]
if not (result["pass"] is True and result["yields"] == 32
        and result["timer"] is True and result["error"] is None):
    raise RuntimeError(f"held compilation failed: {result}")
print("PASS: 32 yields, timer progress, and compilation completed while presentation was held")
