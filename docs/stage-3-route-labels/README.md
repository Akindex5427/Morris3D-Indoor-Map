# Stage 3 - Responsive route-label decluttering and preview awareness

Implemented in the existing four deck.gl TextLayers. No replacement renderer, camera-distance typography scaling, route graph edits, room-coordinate edits, lighting-anchor edits, or floor-stack changes were introduced in this stage.

## Behavior and effective budgets

The shared display budget is `clamp(floor(2 + min(A / 32000, L / 85)), 2, 12)`, with a 0.2-capacity-unit hysteresis band. `A` is the clipped projected building-bounds area remaining after UI exclusions, in square CSS pixels; `L` is the route's clipped projected length in CSS pixels. The count becomes zero on route clearing. A budget is a ceiling: offscreen anchors, marker exclusions, collisions, and floor/preview relevance may result in fewer accepted labels.

- Endpoint labels have priorities 110/100; used connectors retain their existing priorities around 80, transition fallbacks around 70, and landmarks around 40. Retained labels receive a small selection preference. The GPU collision priorities remain stable.
- The existing 4.5-meter default, per-segment selection, opposite-side corridor pairs, and 6-meter landmark spacing remain in `findRouteLandmarks`.
- Candidate pools retain landmarks from all route floors; the display budget is applied after relevance filtering, so an early floor cannot consume the entire pool before preview reaches later floors.
- Text stays at 12 px for endpoints, 10.5 px for landmarks/room connectors, and 10 px for transition fallback labels. Layout uses at most three lines, 25 characters per line, an ASCII ellipsis when needed, and the existing `maxWidth: 18`. Full room names and identities remain unchanged in data and the details UI.
- Existing strictly interior geographic anchors and floor-relative/stacked Z are retained. Only the screen-space text offset changes. Placement tries the previous offset, then above/right/left/below, subject to bounded text boxes and exclusions.
- UI exclusions cover camera controls, legends, sidebar/drawer, header, help, floating details, directions controls, and map attribution where they intersect the actual map container. Invisible elements are ignored. Resize, scroll, layout transitions, and relevant DOM changes update these rectangles.
- Endpoint pins, transition icons, and the projected 3.5-meter preview halo reserve space. The halo exclusion has a minimum 24-pixel radius and an extra margin. Normal world-sized glows and pin artwork are preserved.

## Preview and multi-floor behavior

Playing preview admits landmarks from 6 meters behind to 24 meters ahead of current progress. Already-visible labels have a further 4-meter retention margin. Nearby upcoming turns and connectors gain selection preference. Progress is quantized to 1 meter and the cursor to 4-pixel screen cells for layout invalidation.

F-ALL secondary labels come from the active floor and the next transition floor when that transition is within 16 meters. A paused overview includes the active and next transition floor without the playing landmark-distance window. Endpoint labels remain eligible wherever there is room. Timeline panels use local segment progress and suppress secondary labels on inactive panels during playback. Individual-floor candidates remain floor-filtered.

No camera fitting, rotation, or centering was added to label selection. Offscreen labels are culled rather than dragging them into view or moving the camera. Consequently an endpoint outside a timeline panel's camera framing can have no map label; its full name remains in the route interface.

## Geometry and caching

`routeProximity.js` uses the installed JSTS `DistanceOp.nearestPoints` and `IsValidOp` on filled Polygon/MultiPolygon geometry, including interior rings. A route wholly inside a room has zero distance. A route in a hole is outside the room. All polygon parts and irregular boundaries participate; invalid geometry is rejected. Calculations use the existing local meter convention, centered at the route origin (`111320 * cos(latitude)` for longitude and `111320` for latitude), suitable for this building-scale proximity threshold. These are distances, not square-degree area calculations.

Weak caches retain the parsed local route and per-geometry results for each immutable route coordinate array. Stage 2 interior-anchor caches are reused. Route cumulative distances use the same haversine helper as preview; candidate progress and turn relationships are prepared only when route/candidate identities change. Timeline panel path metrics are no longer rebuilt on each preview tick. Camera movement only projects cached anchors/silhouette points and performs small rectangle tests. Actual rendered Deck viewports, including camera interpolation, are sampled at up to 10 Hz. No perpetual extra animation loop is introduced, and camera sampling is disabled when no route labels exist. Accepted layer-data arrays are reused while identities and offsets are unchanged.

## Collision integration

All four TextLayers share `route-room-labels`, including transition fallback labels. The CPU layout reserves space against objects outside deck.gl's collision engine and prevents accepted label boxes from overlapping. The existing GPU collision filter remains the final guard.

Browser verification exposed a deck.gl 8.9 limitation: collision visibility is sampled at the geographic anchor even when `getPixelOffset` displaces the label. Such labels can disappear by sampling empty pixels. `RouteLabelCollisionExtension` extends the existing `CollisionFilterExtension` to shift only that sample to the rendered text center. It retains the existing collision effect/group and adds one two-component offset attribute; it does not change the geographic anchor. A compatibility test guards the shader integration, and browser screenshots verify actual rendering. This adaptation should be rechecked when upgrading deck.gl.

Connector labels are deduplicated against endpoint feature identities. Legacy graph names are only compatibility hints resolved at a spatially nearby transition, not unique room identities. A mapped connector suppresses the transition fallback; unmapped fallbacks are deduplicated by floor/connector identity or coordinates.

## Files changed in this stage

Production:

- `src/App.jsx` - pass preview playing state.
- `src/components/Map3D.jsx` - shared candidate preparation, responsive layer data, marker exclusions, connector/endpoint deduplication, transition fallback collision participation.
- `src/components/MultiFloorRouteTimeline.jsx` - cache panel metrics; pass local progress, playing state, and active-panel state.
- `src/hooks/useRouteLabelLayout.js` - viewport/UI observation, cached preparation, quantized preview/layout updates, stable layer arrays.
- `src/utils/routeLabelLayout.js` - bounded text, route progress/turn model, budgets, visibility windows, priorities, placement and hysteresis.
- `src/utils/routeProximity.js` - cached valid filled-polygon proximity.
- `src/utils/routeLandmarks.js` - integrate that proximity while preserving existing selection/spacing behavior.
- `src/layers/routeLabelCollisionExtension.js` - offset-aware sampling for the existing GPU collision engine.

Verification:

- `src/utils/routeLabelLayout.test.js`, `src/utils/routeProximity.test.js`, `src/layers/routeLabelCollisionExtension.test.js`.
- `review/route-label-stage3.cjs` - computed-route UI regression.
- `review/route-label-stage3-fixture.html`, `.jsx`, `.cjs` - production Map3D fixtures for all floors, duplicate names, fallback labels and lighting modes; fixture paths are explicitly synthetic, not evidence of room connectivity.
- This report, JSON results and screenshots in `docs/stage-3-route-labels/`. The existing Stage 2 raster measurement script was reused with a separate output path.

Earlier stages already left other modified/untracked files in this workspace. This list identifies Stage 3 work, not the entire working-tree diff.

## Verification

Targeted unit/regression tests cover layout budgets, constant font-size properties, marker/UI/label exclusions, duplicate identities, preview windows/hysteresis, active/late floors, clearing, long text, route progress/turns, polygon interiors/holes/multipart/concavity/invalidity/cache reuse, all source anchors, route instructions, catalogs, and lighting. Across the ten targeted suites, 97 distinct tests passed. This is not a claim that every unrelated repository test passes.

Browser: Chrome headless, SwiftShader, DPR 1, desktop 1440x1000 and mobile viewport 390x844. Actual computed routes: F1 Classroom 0174 - University Honors (0181), approximately 38.8 meters, and F1 Classroom 0174 - F3 Southern Illinois University Press (0362), approximately 66 meters. Tests exercise zoom, pitch/bearing, playback/pause/seek, timeline/F-ALL, sidebar resizing, mobile obstruction handling and clearing. The separate 13-check fixture run covers F0-F7/F-ALL, duplicate identities, transition fallback and Architectural/GIS Night/day. See `browser.json`, `fixture.json` and screenshots for recorded outcomes.

Final verification completed October 25, 2026: all 16 computed-route browser scenarios and 13 fixture checks passed, with no application/GLSL errors. The mobile test waits for layout settlement and explicitly verifies that labels return after closing the drawer. The final production build passed (main bundle 1,491.74 kB, gzip 420.17 kB); it retains the large-chunk warning. The last browser run recorded four Mapbox style-fetch failures separately from application errors, so its screenshots do not verify live basemap POI-label interactions.

Representative desktop results:

| Scenario | Budget | Accepted labels |
| --- | ---: | ---: |
| F1, zoom 16.5 | 2 | 2 endpoints, no landmarks |
| F1, zoom 19 | 5 | 2 endpoints + 3 landmarks |
| F1, zoom 19.5, playing | 7 | 2 endpoints + 4 landmarks |
| F1, zoom 19.5, paused | 7 | 2 endpoints + 5 landmarks |
| F1, pitch 60 deg, bearing 75 deg | 6 | 2 endpoints + 4 landmarks |
| F-ALL, paused | 8 | 2 endpoints + 2 connectors + 4 landmarks |
| F-ALL, destination playback | 8 | 2 endpoints + 1 connector + 2 landmarks |
| Route cleared | 0 | 0 |
| Mobile drawer open | 2 | 0, map obstructed |
| Mobile drawer closed, building fitted | 3 | 1 endpoint + 1 connector + 1 landmark |

The raster measurement run isolates real production layers to prevent collisions from obscuring glyph measurements, using the unchanged font properties and pixel offsets. Across zooms 17/19/21 and pitch/bearing pairs 0/0 deg, 45/35 deg, 65/120 deg:

| Object | Raster width | Raster height |
| --- | ---: | ---: |
| Classroom 0174 endpoint text | 92-97 px | 10-11 px |
| Browsing Room landmark text | 75-77 px | 11-12 px |
| Endpoint pin | 24 px | 29-30 px |
| Existing meter-sized endpoint glow | 10-140 px | 4-141 px |

The building's top-view width changes from about 215 px to 3,444 px over those zooms. Small glyph-bound differences reflect existing rasterization/projection behavior; no zoom-based font scaling was introduced. Raw 36-sample results are in `pixel-measurements.json`.

## Limits

- Basemap symbols have their own Mapbox collision engine; they do not participate in the route-label collision group. DOM map controls/attribution are excluded, but map-native POI text is not. Some sandboxed runs could not fetch the Mapbox style; the computed-room/deck.gl tests still ran, and a browser rerun outside the sandbox tested with basemap access. Network failures, if present in an individual run, are recorded separately.
- UI rectangles/text boxes are conservative approximations. At extreme pitch, on rapid camera movement, or while a layout transition is in progress, the 100 ms sampling interval can produce a brief placement adjustment. The shared GPU filter remains active.
- Mobile testing emulates viewport dimensions in desktop Chrome; physical-device touch performance and other GPUs/browsers were not profiled. This stage makes no FPS improvement claim.
- The production build retains the existing large-chunk warning. No new dependency was installed.
