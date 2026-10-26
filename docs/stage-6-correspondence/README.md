# Stage 6 — Vertical room correspondence

Implemented October 23, 2026. Select a room, then choose **Rooms Above & Below** in its details panel. The sidebar keeps that reference pinned while displaying every supported floor above and below. Select a result to inspect its floor, or choose **Inspect pair in F-ALL** to see both authoritative footprints. Result navigation preserves the camera. Fit Building and manual camera controls remain available.

## Analysis and coordinate system

The authoritative inputs are the eight cached individual room exports in `FLOOR_POLYGON_MAP`, not the combined display export, rendered vertices, camera coordinates, or source `Shape_Area` values. Each feature is identified by its source-specific catalog key. Source Z is ignored for the analytical footprint.

The files use geographic longitude/latitude XY in the same local extent. A single projection is centered on the combined extent of the loaded authoritative datasets (all eight loaded: longitude **-89.22046717581765**, latitude **37.71529136028342**). D3's [Lambert azimuthal equal-area projection](https://d3js.org/d3-geo/azimuthal) is scaled with a mean Earth radius of **6,371,008.8 m**, and translated to a local origin. Every floor uses that same projection. Areas are calculated on projected metric coordinates, never directly on degree coordinates. Unknown declared coordinate systems and nonlocal/inconsistent extents are rejected.

Polygon topology is checked with JSTS `IsValidOp`, following the [JTS validity model](https://locationtech.github.io/jts/javadoc/org/locationtech/jts/operation/valid/IsValidOp.html). Rings must contain finite geographic coordinates, be closed, and have nonnegligible area. Self-crossings, invalid holes, and invalid multipart topology are rejected and reported, not silently repaired. The supplied **1,610 features all passed**. Polygon and MultiPolygon holes/parts are preserved.

Actual intersections are computed with [polyclip-ts](https://github.com/luizbarboza/polyclip-ts), the polygon Boolean library already present through Turf. JSTS computes areas of the resulting metric polygons. Dependencies are now explicitly declared at their existing installed versions rather than imported as undeclared transitive dependencies: `polyclip-ts@0.16.8`, `d3-geo@1.7.1`, and `jsts@2.7.1`.

For intersection area `I`, reference area `R`, and candidate area `C`:

```
Reference overlap (%) = 100 × I / R
Candidate overlap (%) = 100 × I / C
```

The UI displays square meters and reference overlap; the analysis also returns candidate overlap. Edge/point-only contact is excluded. Areas at or below **0.000001 m²** are treated as numerical dust. Substantial intersection-area overshoot is reported as an error; only floating-point overshoot within tolerance is clamped. Positive values below display precision are shown as `<0.01 m²` or `<0.1%`, rather than zero.

Above and Below are determined from source floor numbers. Floors are ordered by distance from the reference floor; results within a floor are ordered by descending intersection area, then label/key. Geometry overlap does not imply physical connectivity and never creates routing edges.

## Data results

| Floor | Features validated | Invalid features |
| --- | ---: | ---: |
| F0 | 148 | 0 |
| F1 | 355 | 0 |
| F2 | 243 | 0 |
| F3 | 288 | 0 |
| F4 | 199 | 0 |
| F5 | 149 | 0 |
| F6 | 138 | 0 |
| F7 | 90 | 0 |
| Total | 1,610 | 0 |

For **Southern Illinois University Press (0362)** on F3, the reference footprint is approximately **227.83 m²**. Calculated example results include:

| Floor | Source feature | Intersection | Reference coverage |
| --- | --- | ---: | ---: |
| F4 | Staff (OBJECTID 20) | 158.68 m² | 69.6% |
| F4 | Staff (OBJECTID 15) | 14.12 m² | 6.2% |
| F5 | Lc Books HV To PG | 157.86 m² | 69.3% |
| F6 | Math Lab 0677 | 65.11 m² | 28.6% |
| F7 | Testing Services | 62.47 m² | 27.4% |
| F2 | Information Resources Management | 220.61 m² | 96.8% |
| F1 | Private Room | 93.37 m² | 41.0% |
| F0 | dewey books 330 to 551 | 67.79 m² | 29.8% |

These are examples, not hard-coded relationships. All matches, including small overlaps and structural/floor features, are in [data-audit.json](./data-audit.json). The example yields 4, 4, 7, and 7 matches on F4–F7, and 5, 12, and 8 matches on F2–F0. Candidate filtering invokes 79 polygon intersections rather than comparing all 1,322 other-floor features. Timing measurements are included in the audit and browser report; they are observations from this environment, not performance guarantees.

## Indexing, caching and lifecycle

- The existing room catalog fetches/parses each authoritative floor source once and publishes shared datasets. Analysis does not fetch or reparse GeoJSON.
- A dedicated module worker is created only when the action is used. Projection, validation, bounding boxes and intersections execute off the map's UI thread. Heavy geometry libraries are bundled in a separate worker asset.
- The worker caches prepared metric geometry and a per-floor index sorted by minimum X. A binary search limits the X range; strict XY bounding-box tests discard disjoint candidates before clipping.
- Up to 100 reference analyses are cached per dataset version. Ordinary camera, floor, color-mode and lighting changes do not request analysis.
- Source-object changes invalidate the worker index and reference cache. Late responses are ignored using request sequence IDs. Closing analysis removes the overlays; a new ordinary selection clears the old analysis. Failed floors remain explicitly unavailable and can be retried, after which the index rebuilds with the newly loaded dataset.

## F-ALL and visualization

The combined display export has different identities and footprints from the authoritative files. Selection now retains the actual picked feature instead of resolving repeated names to an arbitrary feature. Exact horizontal topology matching ignores ring direction/start, multipart order and Z, but does not round coordinates, equate bounding boxes, or match names/IDs across exports.

If a picked F-ALL feature has one exact authoritative footprint, that footprint can be used. Otherwise the sidebar explicitly asks the user to choose among geometrically overlapping **same-floor** authoritative footprints. The real combined `Siu Press` feature exercises this choice path. These choices are not claimed to be verified identity matches. No usable match produces an explicit instruction to select on the individual floor.

Reference outlines are indigo; corresponding outlines are teal. Overlays are separate non-pickable layers, never source recoloring. Authoritative XY is preserved exactly. They reuse `buildFilteredIndoorFeatureCollection` and `computeElevation`, including the existing **base + floor × 4.5 m** stacked datum and the full-floor datum for single-floor views. A render-only 0.08 m roof offset prevents coplanar artifacts. Outlines remain visible through the stack, so they are footprint guides rather than opaque physical surfaces. F-ALL retains its existing combined model; the sidebar explains that its depiction can differ from the authoritative overlays.

No camera rotation/fit is requested by result navigation or Inspect pair. The user controls the view, including whether to fit or rotate. Routing remains active when navigating away and reappears on applicable floors. Night presets and room-color modes leave the analysis outlines intact.

## Files changed for Stage 6

| File | Change |
| --- | --- |
| `package.json` | Explicit geometry dependencies at existing installed versions |
| `src/utils/roomCorrespondence.js` | Projection, topology validation, spatial index, intersection areas, result/cache logic |
| `src/utils/roomCorrespondenceIdentity.js` | Floor/label helpers and exact cross-export footprint matching |
| `src/workers/roomCorrespondence.worker.js` | On-demand worker execution and prepared-index reuse |
| `src/hooks/useRoomCorrespondence.js` | Async state, stale-response protection, dataset invalidation and retry |
| `src/components/RoomCorrespondencePanel.jsx` | Pinned reference, Above/Below groups, geometry resolution, errors, navigation and F-ALL action |
| `src/components/RoomInfoPopup.jsx` | Compact Rooms Above & Below action |
| `src/layers/roomCorrespondenceLayers.js` | Separate paired roof/outline overlays using existing elevation helpers |
| `src/App.jsx` | Selection identity, analysis integration, floor navigation and overlay wiring |
| `src/components/Map3D.jsx` | Exact picked feature forwarding and overlay layers |
| `src/components/IndoorBuilding.jsx` | Active renderer forwards the picked feature, including its geometry |
| `src/utils/roomCatalog.js` | Source-specific combined-display selection keys for highlighting |
| `src/App.css` | Compact sidebar/results and action styling |
| `src/utils/roomCorrespondence.test.js` | Geometry, validity, source-data, identity, cache and overlay tests |
| `src/components/RoomCorrespondencePanel.test.jsx` | Empty/error/partial states and numeric display tests |
| `review/correspondence-check.cjs` | Browser verification |
| `docs/stage-6-correspondence/` | Audit, source hashes, test evidence and screenshots |

The existing repository ignores `package-lock.json`; npm updated the local lockfile, while the explicit dependency versions are recorded in `package.json`. Earlier-stage working-tree changes were retained.

## Verification

- Production build passed, including the separately bundled analysis worker. Existing Vite CJS and large-bundle warnings remain.
- **12 new unit tests pass.** Full suite: **159 passed, 11 failed, 170 total**. All 11 failure names exactly match the Stage 5 baseline (two existing color-repair expectations and nine routing-anchor tests). See [test-summary.json](./test-summary.json) and [unit-results.json](./unit-results.json).
- Geometry tests cover one strong match, multiple matches, partial coverage, unequal sizes, zero/edge-only overlap, holes, multipart footprints, invalid inputs, missing names, missing floors, F0/F7 boundaries, exact/ambiguous F-ALL resolution, immutable sources, cache reuse/invalidation, and XY/Z overlay placement. The real Press example is computed from all eight datasets.
- **All nine production browser scenarios passed, with zero JavaScript page errors.** Outcomes are recorded in [browser-results.json](./browser-results.json). They compare browser results with the independent Node test run within numeric tolerance, exercise result navigation and paired F-ALL overlays, Night/color modes, no recomputation during camera changes, F-ALL reference selection, F0/F7, routing, mobile sidebar use and missing-floor retries.
- A real mouse-click check against the production build also passed: Classroom 0174 remained selectable, with its details panel and overhead camera focus preserved. See [map-click-results.json](./map-click-results.json). This reused the existing selection-check harness with its output redirected to this stage's report directory.
- `git diff --check` passed.
- All **51 public GeoJSON hashes remain unchanged**, including room polygons, routing/centerline sources and interior light files. See [source-hashes.json](./source-hashes.json). No routing algorithm or graph builder was edited.

## Known limitations

- Areas use a local equal-area projection of a spherical Earth model. They are approximate geographic footprint areas, not survey-grade ellipsoidal measurements or usable floor-area certificates. Source georeferencing accuracy is not independently established.
- Source features include slabs, stairs and structural pieces as well as rooms. No verified room-function taxonomy exists, so these are not silently filtered or merged. Missing names use real source identifiers where available, otherwise “Unnamed feature.” Different features can overlap each other; their percentages must not be summed as unique coverage.
- Invalid footprints are excluded with reasons; the feature does not edit/repair survey geometry. Missing floors make results explicitly incomplete.
- F-ALL can require an explicit authoritative-footprint choice. The displayed combined model is not rewritten to match the individual exports.
- Vertical correspondence is strictly XY footprint overlap by floor order. It does not establish physical access, continuous shafts, structural support, occupancy, or a navigable path.
