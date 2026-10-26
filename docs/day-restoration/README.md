# Day Mode visual restoration

Implemented and verified on 2026-10-25. This corrects the Stage 4 daylight regression while retaining the shared environmental controller and the existing Night endpoints.

## Confirmed causes

Two Stage 4 rendering-state changes affected daylight:

1. The room and structural GeoJSON layers forced `depthMask: false` throughout the timeline. Before Stage 4, daylight used depth writes. Transparent overlapping surfaces therefore no longer had the same occlusion, even though their color accessors returned the same RGBA values.
2. `nightEnvelopeLayers` applied nighttime exterior-wall blending during daylight: `[SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA]`. The original daylight rendering inherited Deck's `[SRC_ALPHA, ONE_MINUS_SRC_ALPHA]`, including its alpha-channel factors. This changed the canvas alpha composited over the basemap. Restoring depth alone did not restore the exterior appearance.

The isolation test changed only these settings in the captured pre-fix renderer:

| View | Before correction: differing pixels | Restore depth only | Restore depth and original blend |
| --- | ---: | ---: | ---: |
| F1 | 221,346 | 63,530 | 0 |
| F-ALL | 500,871 | 313,361 | 0 |

These are exact RGBA comparisons at 1100 × 900, on the same Chrome/SwiftShader renderer. They are not cross-device tolerances.

The Stage 4 custom surface shader, material defaults, color accessors, exposure, and light interpolation were also inspected. At progress zero, the shader returns the ordinary deck-lit daylight output with exposure 1. Night radiance compression and linear/sRGB conversion are confined to the night contribution. No additional gamma correction, replacement palette, or daylight material adjustment was needed. The original unsupported room-material function had used Deck's effective defaults; the explicit defaults introduced in Stage 4 reproduce that output in the comparisons.

## Reference provenance

There is no Git commit containing the complete application immediately before Stage 4. Recent usability stages are uncommitted; `b2b12bd` is the latest recorded commit and is too old to represent that state.

The local `.tmp/stage7-baseline/src` snapshot supplies the saved pre-environment day shader/material and envelope paths. Its reconstruction script is `.tmp/reconstruct-stage7-baseline.py`. The comparison fixture applies those paths to the same current datasets, wall meshes, camera, lighting, opacity, and display-metadata enrichment as the corrected renderer. This isolates rendering behavior without reverting later catalog, identity, or geometry fixes.

Saved baseline SHA-256:

- `IndoorBuilding.jsx`: `b36cf57add14882ea97754b52639e36a42b728224b42f6d618d89300eaa4f3ba`
- `interiorLighting.js`: `e7d8024acecc723afb76c37c563d025f0eed6a96cd4a3f89062fae71773f5601`
- `nightSurfaceLayer.js`: `9eb050cbbbe4769f2c71ad3d92b2262b324b847c6d17290077f78d5a5d978f09`

The pre-fix Stage 4 source was saved at task start in `.tmp/day-restore-before/src`. Selection/route comparisons use the original stock `SolidPolygonLayer` rendering path with current stable feature identities: the older snapshot's name-based selection is not a valid identity reference. Exact equivalence to an unavailable complete pre-Stage-4 application build cannot be claimed.

## Production changes

| File | Change |
| --- | --- |
| [IndoorBuilding.jsx](../../src/components/IndoorBuilding.jsx) | `useIndoorBuilding` restores daylight depth writes for both room and structural layers and attaches the shared depth-transition extension. |
| [environmentDepthExtension.js](../../src/layers/environmentDepthExtension.js) | New small deck.gl `LayerExtension` controls depth/blend state on existing models. It preserves endpoint rendering and provides a reversible occlusion handoff. |
| [nightSurfaceLayer.js](../../src/layers/nightSurfaceLayer.js) | `getShaders` preserves inherited fragment declarations so the extension's uniforms are available. Existing lighting and color math remain unchanged. |
| [interiorLighting.js](../../src/utils/interiorLighting.js) | `nightEnvelopeLayers` preserves authored/inherited daylight blend state and supplies the previous nighttime blend factors only for night coverage. |

The extension uses a shared, fixed per-pixel coverage pattern to move between depth-writing and non-depth-writing rendering. Each covered pixel uses one of two complementary draws of the same model; geometry, layer IDs, buffers, and materials are not reconstructed. Depth testing remains enabled. Picking uses one solid, depth-writing pass throughout.

The depth handoff finishes by golden hour, when the existing `surfaceNight` keyframe reaches 0.04. A smoothstep remapping makes the handoff gradual and reversible. Completing it before the surfaces become highly transparent avoids a stippled twilight appearance. Golden hour, twilight, and full night then use their existing single-pass rendering. Daylight also uses one ordinary pass. The transient extra draw occurs only during early sunset or the corresponding part of sunrise.

The eight-second clock, environmental keyframes, sunlight, exposure, atmosphere, basemap adapter, preset interpolation, fixture system, and camera/route state management are unchanged. No style reload or new animation loop was added.

## Source colors and data integrity

Original Colors still uses the existing `color` accessor and parser. Named colors, RGB arrays, supported RGB(A) strings, and three-/six-digit hexadecimal values retain their established interpretation. Opacity remains governed by the existing floor, reveal, selection, and visualization settings; this fix does not introduce a new source-alpha interpretation.

The app's existing missing-color enrichment from the combined dataset remains in place. The fixture uses that same enrichment; comparing raw individual exports alone would be misleading because some exports omit display colors. Features still lacking a color retain the established fallback.

All **51 public GeoJSON files** have the same SHA-256 hashes as at task start, including room polygons, centerlines, walls, and lighting anchors. These files contain earlier uncommitted work, which this fix leaves intact. Color-output and geometry hashes match between the reference and corrected renderer for every floor. No coordinates, elevations, feature identifiers, route graphs, light positions, or radii were changed.

## Verification

### Controlled visual comparisons

All comparisons use identical datasets, camera center, zoom, pitch 45°, bearing 15°, viewport, DPR 1, and Original Colors. The runner waits for both React state and the actual Deck layers/data to match the requested state before capturing. Existing wall datasets are preloaded. Basemap pixels are excluded from exact comparison to avoid tile/network variability; separate full-app screenshots include the basemap.

| Floor | Pre-fix pixels differing from saved day reference | Corrected |
| --- | ---: | ---: |
| F0 | 205,611 | 0 |
| F1 | 221,346 | 0 |
| F2 | 169,905 | 0 |
| F3 | 256,993 | 0 |
| F4 | 197,558 | 0 |
| F5 | 210,780 | 0 |
| F6 | 219,241 | 0 |
| F7 | 225,510 | 0 |
| F-ALL | 500,871 | 0 |

Additional results:

- Selected-room and route-highlight comparisons: **zero differing pixels** against the stock-day renderer with current identities.
- Architectural Night and GIS Night, F1 and F-ALL: **zero differing pixels** against the pre-fix Stage 4 surfaces and exterior walls.
- F1 golden hour (0.36) and twilight (0.70): **zero differing pixels** against the pre-fix Stage 4 renderer after the handoff completes.
- Return to daylight after forward/reverse samples: **zero differing pixels** from initial daylight.
- A progress value of 0.0001 differed in only 4 of 990,000 pixels, with mean absolute channel difference 0.000034/255; there is no whole-building depth-state pop on leaving daylight.
- Room/wall data references and GPU models remain identical across sampled intermediate states.

See [comparison.json](comparison.json), [visual.json](visual.json), [ablation.json](ablation.json), and [phases.json](phases.json). Representative images: [F1 before](F1-before.png), [F1 corrected](F1-current.png), [F-ALL corrected](Fall-current.png), [full app daylight](app-day.png), [full app night](app-night.png), and [search selection](app-search-selected.png).

### Browser behavior

The full-app run passed six scenario groups with no captured JavaScript/GLSL errors:

- Initial F1 Day/Night, with unchanged camera.
- Search for Classroom 0174, exactly one selected polygon, four Day/Night cycles, and both presets, preserving selection and camera.
- GPU polygon picking after returning to daylight.
- A paused F1–F3 route with two panels sharing one environmental progress value; cameras and preview position stay unchanged during sunset and reversal.
- Route preview continues advancing during sunset.
- F-ALL route camera remains unchanged across Night-to-Day.

The final transition run passed 21 checks with no captured errors; its full cycle completed in 8.283 seconds including browser scheduling. It checks seven forward/reverse keyframe samples, all nine floor views, actual compiled top/side shader attribute bindings, data/tessellator/position-buffer/model/light-atlas reuse, mid-transition reversal, full-cycle timing, preset changes at night, reduced motion, and unmount cleanup. See [app-browser.json](app-browser.json) and [transition-browser.json](transition-browser.json).

### Automated tests and build

- **68 of 70 selected unit tests passed.** All 67 tests covering the depth extension, environmental controller, surface lighting, presets, envelope, room-color modes, and catalog passed; the existing source-color parser test also passed.
- Two existing `featureColors.test.js` assertions fail because they expect no missing colors after enrichment: F2 still has **1**, and F6 still has **7**. The helper, test file, and datasets are byte-for-byte unchanged from task start. No colors were fabricated to satisfy these assertions. Full results: [unit-tests.json](unit-tests.json).
- `npm run build`: passed. Existing Vite CJS deprecation and large-chunk warnings remain.
- Targeted whitespace check: passed.

New/updated test code: [environmentDepthExtension.test.js](../../src/layers/environmentDepthExtension.test.js), [interiorLighting.test.js](../../src/utils/interiorLighting.test.js), [day-restoration fixture](../../review/day-restoration.jsx), [visual runner](../../review/day-restoration.cjs), [comparison script](../../review/compare-day-restoration.py), [app checks](../../review/day-restoration-app.cjs), and [transition checks](../../review/day-restoration-transition.cjs). The fixture also has a small HTML entry point.

## Limits and reproduction

- Exact image results apply to this Chrome/SwiftShader configuration. Hardware GPU, antialiasing, DPR, and driver differences can change pixels. This is not a claim of pixel-perfect equivalence across devices or to an unavailable Git build.
- Early-sunset depth handoff uses spatial coverage. A fine pattern can be visible briefly at DPR 1. It finishes before twilight; the later cinematic surfaces match their existing appearance. Two model draws are needed during this short interval; endpoint draw counts and resource allocations are unchanged. Mobile hardware performance was not benchmarked in this repair.
- Optional `wall_room_*_stack.geojson` files referenced by the existing stacked-wall loader are absent from this checkout. F-ALL comparisons include the available combined room geometry and perimeter shell. No missing geometry was invented or removed.
- The saved reference/pre-fix snapshots are local review inputs under `.tmp`; they are required to rerun historical comparisons and are not a committed historical release.

With Vite on port 3004 and `PLAYWRIGHT_MODULE` pointing to the installed Playwright package, run `node review/day-restoration.cjs`. Set `DAY_REVIEW_ABLATION=1` for the isolation cases or `DAY_REVIEW_PHASES=1` for just golden-hour/twilight comparisons, then run `python review/compare-day-restoration.py` (Pillow and NumPy required). Browser behavior checks use `node review/day-restoration-app.cjs` and `node review/day-restoration-transition.cjs`.
