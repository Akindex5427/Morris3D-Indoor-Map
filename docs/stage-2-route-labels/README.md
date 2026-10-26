# Stage 2: fixed-pixel route labels, identity, and anchoring

Completed 2026-10-24. This stage retains the four production deck.gl TextLayers, their existing font sizes, billboard settings, collision groups/priorities, route proximity thresholds, landmark spacing rules, and display caps. No camera-distance text scaling was introduced. No Day/Night timeline or Stage 3 decluttering changes were implemented.

## Browser measurements

Chrome headless with SwiftShader, 1440 × 1000 browser viewport, device pixel ratio 1. Tests sampled zoom 17, 19, and 21, each at pitch/bearing pairs 0°/0°, 45°/35°, and 65°/120°.

The baseline first computed a real F1 route from Classroom 0174 to University Honors (0181). Its actual TextLayer instances were cloned into an isolated Deck canvas at the same viewport dimensions. Raster bounds were measured with `gl.readPixels` and an alpha threshold of 16. Only the measurement clone disabled background and collision filtering, so occlusion and collision rejection could not masquerade as font-size changes. The production renderer retains its collision behavior. Font/icon atlas loading is awaited when an initial raster is empty.

| Sample | Before: glyph bounds over nine views | After: glyph bounds over nine views |
|---|---|---|
| Classroom 0174, 12 px endpoint text | 92–96 px wide, 10–11 px high | 92–96 px wide, 10–11 px high |
| Browsing Room, 10.5 px landmark text | 75–77 px wide, 11–12 px high | 75–77 px wide, 11–12 px high |

No substantial typography scaling defect was established. Small variations in raster bounds remain in the existing renderer; the specified font sizes are unchanged. At zero pitch, projected F1 building width grows from approximately 215 px at zoom 17 to 861 px at zoom 19 and 3,444 px at zoom 21. Constant-sized text necessarily becomes larger relative to the building when zooming out.

Supplemental measurements used the production Map3D component with real F6 room features and explicit label fixtures, including the connector fallback branch:

| Production layer/sample | Measured width | Measured height |
|---|---:|---:|
| Transition fallback “Stairs”, 10 px | 32 px | 8–9 px |
| Connector “Stairs”, 10.5 px | 34 px | 9 px |
| Endpoint “Stairs Area Upper”, 12 px | 112–116 px | 12–13 px |
| Landmark “Southern Illinois African American Heritage Center 0640A”, 10.5 px, wrapped | 174–176 px | 23–25 px |
| Start pin, animation disabled | 24 px | 29–30 px |
| Meter-based start glow | 10–140 px | 4–140 px |

The glow's zero-pitch diameter was 10, 36, and 140 px at zoom 17, 19, and 21 respectively. At 65° pitch, the elevated Classroom 0174 label anchor projects approximately 3.17, 12.74, and 51.68 px away from its ground-plane XY position. This is anchor displacement, not text-size growth. Whole-building bounds at steep pitch/high zoom may cross the horizon and are not used as an occupancy metric.

Evidence: [baseline](before.json), [final application measurements](after.json), [all four label layers and marker effects](all-four-layers.json).

## Changes

- `src/utils/routeLabelIdentity.js`: stable catalog provenance keys; floor-qualified identity; no name-based uniqueness. Raw geometry without catalog provenance uses a separate namespace rather than pretending its export-local OBJECTID belongs to a catalog.
- `src/App.jsx`: supplies provenance-linked display features and authoritative features to main and timeline maps; route focus endpoints use catalog identities.
- `src/components/MultiFloorRouteTimeline.jsx`: passes authoritative features to each production Map3D instance.
- `src/components/Map3D.jsx`: resolves route markers by stable identity, uses the shared anchor helper, removes duplicated centroid/grid helpers, and adds `maxWidth: 18` with `wordBreak: "break-word"` to the existing four TextLayers. In deck.gl 8.9 this width is relative to font size: nominal limits are 180, 189, and 216 px before background padding. Long individual words also break when necessary. Full source text is retained.
- `src/components/IndoorBuilding.jsx`: uses the same provenance identities for route surface emphasis and Night shader color protection, avoiding recoloring every namesake room.
- `src/utils/routeLandmarks.js`: endpoint exclusion and deduplication use feature identity. Existing distance, side, spacing, segment limits, and collision policy are preserved. Label anchors use the shared utility; routing/access centroids remain part of the unchanged proximity calculation.
- `src/utils/roomLabelAnchor.js`: cached JSTS geometry validation, centroid/interior-point calculation, and strict point-in-polygon verification in local projected meters. Handles holes, concavity, irregular shapes, and multipart polygons. Uses the largest-area part first and checks geographic round-trip precision. Invalid or unresolvable geometry produces an explicit failure reason and no label anchor, never an exterior-centroid fallback. Z remains the renderer's responsibility.

The existing `roomCatalog.js` was inspected and reused without alteration. Its authoritative source paths and feature keys remain intact. Source GeoJSON, routing graphs, fixture coordinates/radii, and stack offsets were not changed by this stage.

## Cross-export limitation handled explicitly

The F-ALL export rounds coordinates to nine decimal degrees; the individual files retain more digits. Exact numeric matching initially rejected all 1,608 combined features. The route-only identity adapter now compares complete ring/part footprints at that measured export precision (approximately 0.1 mm), with ring direction/start and part order normalized. It does not change any coordinates or spatial-analysis precision. Names, cross-export OBJECTIDs, and row order are never matching evidence.

**1,473 F-ALL features resolve uniquely; 135 remain unmatched.** Some footprint differences are larger than export rounding. No ambiguous match was observed in this dataset; synthetic ambiguity is tested and rejected. Labels still use authoritative floor geometry when the older combined export cannot be linked. The code does not falsely attach route emphasis to a different combined polygon. Reconciling the differing exports is outside Stage 2.

## Verification

- **78/78 targeted unit/regression tests passed**, across seven suites: identity, anchors, route landmarks, route instructions, catalog, Night presets, and surface lighting. [Machine-readable results](tests.json).
- Anchor tests verify strict interior containment for **all 3,218 source polygons**: 1,610 across F0–F7 plus 1,608 in F-ALL. Synthetic cases cover holes, multipart, concave/narrow shapes, invalid topology, duplicate IDs, duplicate names, independent export IDs, rounding, and ambiguous matches.
- **13 production-component browser integration scenarios passed**: every individual floor and F-ALL, connector fallback, Architectural Night, GIS Night, and return to Day. Duplicate names were tested on every floor; F-ALL used Emergency Exit features on F0 and F6. These fixtures test rendering, identity, and elevation, not route computation. [Results](integration.json).
- **4 live application scenarios passed**: full long name in the details panel; actual computed F1 Classroom 0174 → F3 Southern Illinois University Press (0362) route in timeline panels; stacked overview; and switching to F3. Endpoint Z was 1.1 m in individual views and 5.6/14.6 m in the stacked view. [Results](app-integration.json), [screenshot](computed-route.png).
- No browser page errors or application alert dialogs in the successful checks.
- Production build passed; `git diff --check` passed. Existing Vite CJS and large-chunk warnings remain. Reusing JSTS on the main thread increases the main application bundle to 1,473.87 kB (414.84 kB gzip), versus the prior Stage 7 report's 1,265.32 kB (367.90 kB gzip). No dependency was added. This stage did not repeat GPU performance profiling.

New review files: `review/route-label-measurements.cjs`, `route-label-check.cjs`, `route-label-app-check.cjs`, `route-label-review.html`, and `route-label-review.jsx`. New test files: `src/utils/routeLabelIdentity.test.js` and `roomLabelAnchor.test.js`.

Runtime evidence covers Chrome/SwiftShader at DPR 1; hardware GPU, Safari/Firefox, and other device pixel ratios were not measured. The full historical test suite was not rerun; the reported pass count applies to the seven targeted suites only.

## Reproduction

Run Vite on the review scripts' default port 3004, and make Playwright available through `PLAYWRIGHT_MODULE` if it is not locally installed. Run `node review/route-label-measurements.cjs`, `node review/route-label-check.cjs`, and `node review/route-label-app-check.cjs`. For the supplemental measurement, set `LABEL_HARNESS=1`, `LABEL_URL=http://127.0.0.1:3004/review/route-label-review.html`, and `LABEL_REPORT=docs/stage-2-route-labels/all-four-layers.json`.

The saved `before.json` is the pre-implementation measurement and should not be overwritten when reproducing final measurements.
