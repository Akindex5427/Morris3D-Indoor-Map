"""Compare captures from day-restoration.cjs on one browser/GPU configuration.

Requires Pillow and NumPy. Reads images only; does not resample or alter captures.
The zero-difference assertions apply to this controlled fixture, not other GPUs.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path("docs/day-restoration")
visual = json.loads((OUT / "visual.json").read_text())
records = {r["name"]: r for r in visual["results"]}
assert not visual["errors"]


def compare(left, right):
    a = np.array(Image.open(OUT / f"{left}.png").convert("RGBA"), dtype=int)
    b = np.array(Image.open(OUT / f"{right}.png").convert("RGBA"), dtype=int)
    assert a.shape == b.shape
    delta = np.abs(a - b)
    return {
        "reference": left,
        "compared": right,
        "differentPixels": int(np.any(delta, axis=2).sum()),
        "maximumChannelDifference": int(delta.max()),
        "meanAbsoluteChannelDifference": float(delta.mean()),
    }


day = []
for floor in [0, 1, 2, 3, 4, 5, 6, 7, "all"]:
    baseline = f"F{floor}-legacy"
    corrected = f"F{floor}-current"
    row = {"floor": floor, "before": compare(baseline, f"F{floor}-before"),
           "corrected": compare(baseline, corrected)}
    assert row["corrected"]["differentPixels"] == 0
    assert records[baseline]["geometryHash"] == records[corrected]["geometryHash"]
    assert records[baseline]["colorHash"] == records[corrected]["colorHash"]
    assert records[baseline]["modelCount"] == records[corrected]["modelCount"]
    day.append(row)

highlights = [compare(f"F1-{state}-reference", f"F1-{state}-current")
              for state in ["selected", "route"]]
night = [compare(f"F{floor}-{preset}-before", f"F{floor}-{preset}-current")
         for floor in [1, "all"] for preset in ["architectural", "gis"]]
assert all(r["differentPixels"] == 0 for r in highlights + night)
phases = [compare(f"F1-{phase}-before", f"F1-{phase}-current") for phase in ["golden", "twilight"]]
assert all(r["differentPixels"] == 0 for r in phases)

ablation = [compare(f"F{floor}-legacy", f"F{floor}-{variant}")
            for floor in [1, "all"] for variant in ["before", "depth-only", "depth-blend"]]
assert all(r["differentPixels"] == 0 for r in ablation if r["compared"].endswith("depth-blend"))
transition = [compare("F1-current", f"F1-transition-{p}")
              for p in [0.0001, 0.05, 0.36, 0.7, 0]]
assert transition[-1]["differentPixels"] == 0

hashes = json.loads(Path(".tmp/day-restore-before/geojson-hashes.json").read_text())
modified = [p for p, sha in hashes.items() if hashlib.sha256(Path(p).read_bytes()).hexdigest() != sha]
assert not modified, modified
result = {"captureCount": len(visual["results"]), "day": day, "highlights": highlights,
          "night": night, "phases": phases, "ablation": ablation, "transition": transition,
          "unchangedGeojsonFiles": len(hashes)}
(OUT / "comparison.json").write_text(json.dumps(result, indent=2) + "\n")
print(f"PASS: 9 daylight, 2 highlight, 4 Night comparisons; {len(hashes)} unchanged GeoJSON files")
for r in ablation:
    print(f"{r['compared']}: {r['differentPixels']} differing pixels")
