"""Validate a native resource-probe log; the host exit must separately be zero."""
import json
import pathlib
import sys

marker = "TN_QUALITY_RESOURCE_LIFECYCLE:"
rows = [json.loads(line.split(marker, 1)[1])
        for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if marker in line]
assert len(rows) == 1, "expected exactly one native result"
result = rows[0]
assert result["pass"] is True, result.get("error", "native probe failed")
assert len(result["cycles"]) == 2, "expected two cycles"
for cycle in result["cycles"]:
    assert len(cycle) == 5, "expected five samples per cycle"
    for sample in cycle:
        for field in ("textures", "drawCalls"):
            assert type(sample[field]) is int and sample[field] > 0, field
        assert "bloom" in sample["debug"]["stages"], "bloom missing"
        assert sample["debug"]["dropped"] == [], "stage dropped"
for first, second in zip(*result["cycles"]):
    assert second["textures"] <= first["textures"], "texture count grew"
print("PASS: two native cycles, positive counters, no growth or dropped stages")
