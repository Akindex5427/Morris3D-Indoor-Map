# Stage 5: room colors and semantics

Implemented October 23, 2026. The initial inspection found no functional color selector: App supplied an unused `colorScheme="default"`. The old `Legend.jsx` describes display states, not room functions, and remains unmounted.

## Evidence from the data

All eight individual room exports and `rooms-all-WGS-v6.geojson` were inspected. [data-audit.json](./data-audit.json) records every attribute, populated/distinct counts, low-cardinality values, raw color frequencies, feature counts, and pre-change SHA-256 hashes. Reproduce with `node review/color-audit.cjs` (this regenerates the audit against current data).

There is **no verified room-purpose classification field or supplied color-to-function taxonomy**. Available attributes describe names, source IDs, level, stack, heights, geometry measures, and (in some exports) colors. `type`, `tipo`, `category`, `use`, and `department` are absent. `name` can describe a room, but is not a validated classification. `stack` is not a verified use taxonomy.

F1–F7 have no raw `color` attribute. F0 has 132 colored features and 16 missing values. The combined file has 1,559 colored features, 49 missing colors, and 38 distinct nonempty color strings, including `ightskyblue` and `magneta`; the existing parser handles these aliases.

Existing rendering also uses `enrichMissingFeatureDisplayProperties` to recover missing display colors from the combined export, first by floor-scoped bounding box, then normalized name, then legacy name rules (floor/stair/elevator/structure/shaft/mechanical). The active renderer applies slight floor shading, darker walls, floor-surface transparency, and navigation overrides. These are display conventions, **not evidence of verified functional categories**. Original Colors preserves this behavior; the historical enrichment code has not been changed.

| Source | Room-file features | Verified classifications | Unclassified | Raw color missing |
| --- | ---: | ---: | ---: | ---: |
| F0 | 148 | 0 | 148 | 16 |
| F1 | 355 | 0 | 355 | 355 |
| F2 | 243 | 0 | 243 | 243 |
| F3 | 288 | 0 | 288 | 288 |
| F4 | 199 | 0 | 199 | 199 |
| F5 | 149 | 0 | 149 | 149 |
| F6 | 138 | 0 | 138 | 138 |
| F7 | 90 | 0 | 90 | 90 |
| Individual total | 1,610 | 0 | 1,610 | 1,478 |
| F-ALL (separate combined export) | 1,608 | 0 | 1,608 | 49 |

These count source features, including structural pieces, stairs and slabs, not distinct physical rooms. F-ALL is a separate export, not an additional 1,608 unique rooms. No source identity crosswalk or dataset corrections were introduced.

## Implemented behavior

- **Original Colors** is the default and preserves the existing source/enrichment/shading path.
- **Uniform Color** supplies neutral RGB `[174,181,187]` to room surfaces and appropriately darker walls in daylight. Floor-dependent color variation is bypassed. Existing transparency, floor slabs, boundaries, search gold, route start/end colors, and route emphasis remain intact.
- **Room Function** is shown as unavailable, with an explanation, because the supplied data has no verified classifications. Supported real functional categories: **none**. No functions are inferred from names, colors, IDs, or stack.
- Functional colors are implemented behind an explicit configuration interface. Unmapped features use the neutral unclassified color. A compact collapsible legend lists only categories in the map's loaded floor/filter data, plus Unclassified when needed. Transparent floor-surface features are excluded from its counts. Each route timeline panel has its own summary. The legend is hidden in Original/Uniform modes and when the current view has no classified features. No large Map Legend panel was restored.
- Both Architectural Night and GIS Night receive the selected surface/wall base colors. The existing shader performs illumination without writing back to source colors. GPU color update triggers include mode/configuration changes. Navigation colors retain priority, and geometry/elevation/stacking logic is unchanged.
- Visual Controls owns the selector; the selected mode is shared by the main map and all route timeline maps. Mode changes do not reset camera, search, floor, or route state.

## Adding verified classifications later

`src/utils/roomColorConfig.js` is deliberately empty. To enable functional coloring:

1. Obtain an authoritative room-purpose field/taxonomy and document its source or approval in `provenance`.
2. Populate that attribute in the appropriate authoritative datasets through a separately reviewed data update. Validate individual exports and the combined export independently: do not join them on names or assume source IDs are interchangeable.
3. Set `field` to the actual verified attribute. Define categories as `{ id, label, color: [r, g, b] }`, with stable unique IDs, readable labels, and integer RGB channels from 0 to 255. Use a consistent, distinguishable palette.
4. Set `values` to an exact mapping of attribute values to those category IDs. Matching is explicit and case-sensitive; no fuzzy/name-based inference is performed. Missing values, unmapped values, invalid categories, or absent provenance stay unclassified.
5. Verify coverage and palette accessibility across all sources before release. The selector becomes available once a loaded feature resolves to a verified category; views with no classifications remain neutral with no category legend.

`getRoomFunction`, `resolveRoomColor`, and `summarizeRoomFunctions` accept a configuration argument for testing or future integration. Production uses the shared configuration module. Synthetic categories in unit tests are test fixtures only and are never loaded into the app or datasets.

## Files changed for this stage

| File | Stage 5 change |
| --- | --- |
| `src/App.jsx` | Shared mode state and verified-data availability; main/timeline/control wiring |
| `src/App.css` | Selector explanation and compact legend styles |
| `src/components/VisualControls.jsx` | Accessible selector and unavailable classification state |
| `src/components/Map3D.jsx` | Mode passed to renderer; compact per-map legend |
| `src/components/IndoorBuilding.jsx` | Surface/wall color resolution, GPU triggers, visible-floor category summary |
| `src/components/MultiFloorRouteTimeline.jsx` | Mode propagation into all route panels |
| `src/components/RoomColorLegend.jsx` | New compact, collapsible category legend |
| `src/utils/roomColorConfig.js` | Empty verified-classification configuration |
| `src/utils/roomColors.js` | Pure classification, color resolution, and category aggregation |
| `src/utils/roomColors.test.jsx` | Real-data coverage, immutability, classification and legend tests |
| `review/color-audit.cjs` | Reproducible attribute/color audit |
| `review/color-check.cjs` | Browser verification |
| `docs/stage-5-colors/` | Audit, verification reports and screenshots |

Earlier stages already left changes in this working tree. The table describes this stage's additions, not the complete Git diff. No GeoJSON was edited in Stage 5.

## Verification

- Production build passed. Existing Vite CJS and large-bundle warnings remain.
- All **13 new tests passed**. Full unit suite: **147 passed, 11 failed, 158 total**. Every failure name matches the previously recorded Stage 3 baseline: two in `featureColors.test.js`, nine in `routeAnchors.test.js`. See [test-summary.json](./test-summary.json) and [unit-results.json](./unit-results.json).
- **All 33 browser checks passed, with zero JavaScript page errors.** These exercise Original → Uniform → Original on every floor and F-ALL, each in day, Architectural Night and GIS Night (27 combinations). Actual renderer accessors are checked for body/wall colors, original-color restoration, unchanged geometry and source colors. Search highlights in all three lighting styles, route colors/geometry, mobile controls and two-panel multi-floor timelines in all three styles also passed. Results are recorded in [browser-results.json](./browser-results.json).
- All nine audited GeoJSON SHA-256 hashes match their pre-change audit values.
- Functional classification and current-view legend behavior are tested with synthetic fixtures because no real classified rooms exist. This is infrastructure verification, not a claim that library functions have been established.
- `git diff --check` passed.

The remaining limitation is data availability: Room Function cannot provide meaningful real categories until verified room-purpose data is supplied.
