"""Compare the isolated Deck canvases; exclude nondeterministic basemap tiles."""
import json
from pathlib import Path
from PIL import Image, ImageChops

root = Path('docs/stage-7-performance')
before = json.loads((root / 'visual-before/results.json').read_text())
after = json.loads((root / 'visual-after/results.json').read_text())
assert before == after, 'Rendered room geometry or color accessors changed'
results = []
for path in sorted((root / 'visual-before').glob('*.png')):
    first = Image.open(path).convert('RGBA')
    second = Image.open(root / 'visual-after' / path.name).convert('RGBA')
    assert first.size == second.size
    difference = ImageChops.difference(first, second)
    results.append({
        'image': path.name,
        'differentPixels': sum(any(pixel) for pixel in difference.getdata()),
        'maxChannelDifference': max(high for low, high in difference.getextrema()),
        'pixels': first.width * first.height,
    })
(root / 'visual-comparison.json').write_text(json.dumps({
    'geometryAndColorHashesIdentical': True, 'results': results,
}, indent=2))
print(json.dumps(results, indent=2))
