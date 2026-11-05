# Interactive 3D room-overlap highlighting

Implemented October 26, 2026 as an extension of the immediately adjacent-floor analysis. Selecting a result now highlights the reference, the adjacent feature, and their **exact intersection**, without changing the selected room, floor, or camera. Clear Highlight removes the active match while retaining the reference. Focus on Overlap is an explicit, optional camera action.

## Geometry and identity

`intersectRows` still performs one polyclip-ts intersection in the existing local Lambert azimuthal equal-area coordinate system. JSTS calculates its metric area. Those same clipped rings are inverse-projected to longitude/latitude and retained as `intersectionGeometry`; there is no second intersection algorithm, centroid estimate, bounding-box approximation, or simplification.

The result schema is now version 2, with `intersectionCrs: "EPSG:4326"`. Each match carries its existing candidate key/floor, reference key/floor, area, reference-relative percentage, and the geographic MultiPolygon. Polygon holes and disconnected regions remain intact. Zero-area contacts and areas at or below the existing **1e-6 m²** tolerance remain excluded. The bars, summary, narration, and map all consume the same result. The percentage denominator is unchanged.

Feature identity continues to use floor-qualified authoritative catalog provenance, including source file and export ID/row disambiguation. Names are display text, never unique keys. F-ALL selections still require exact authoritative footprint resolution or the existing explicit reference-choice step.

Intersection geometries live inside the existing bounded, 100-reference worker result cache. A reference result contains candidate-keyed matches; replacing a source dataset replaces the index/cache. Clicking a card changes only the active candidate key and does not request another intersection.

## Rendering and elevations

The existing correspondence overlay module now produces reference/candidate outlines and a separate shared-footprint fill/boundary:

- Reference: gold, matching the existing selected-room color.
- Above candidate: teal outline; below candidate: indigo outline.
- Intersection: stronger translucent directional fill with a white boundary.

The renderer reuses `buildFilteredIndoorFeatureCollection` and `computeElevation`, with full authoritative floor context. Overlay roofs follow the existing formulas:

```
single-floor roof = feature base - full-floor minimum base + rendered thickness
stacked roof      = feature base + floor × existing spacing + rendered thickness
rendered thickness = max(0.5, height - base) × existing height exaggeration
```

No extra stack offset or arbitrary height is added. The previous small overlay Z lift is unnecessary: analytical layers use `depthTest: false`, `depthMask: false`, and ordinary smooth alpha blending. They are deliberately visible through the building and labeled as analytical overlays. No fragment hashing, stippling, shader replacement, extrusion prism, or implied physical connection is introduced.

On an individual paired floor, the off-floor feature is projected onto the visible member's roof plane, and the exact intersection is shown there once. Both the panel and a fixed-screen map notice name the source and display floors. A manually selected unrelated floor hides the overlays while retaining the analysis; it does not project the pair onto an arbitrary floor.

In F-ALL, the two polygons and two copies of the shared footprint use their respective actual roof elevations, preserving identical intersection XY coordinates. Partial multi-floor views include only the visible paired floors. The supplied illustration contributes no geometry, percentages, or room relationships.

The fill and outline layers are non-pickable and cannot intercept ordinary room selection. They follow building rendering and precede route overlays/markers, preserving route visibility. Search selection remains intact; clearing/closing removes analytical geometry without editing source colors or materials. Existing manual floor changes still clear ordinary room selection, while the analysis reference remains pinned until changed or closed.

## Controls and presentation

Result cards retain names, metric areas, and fixed 0–100% bars. Native buttons support keyboard interaction, `aria-pressed` marks the one selected result, and visible text identifies its map highlight. Selecting another card replaces the overlay rather than accumulating it.

Clear Highlight keeps the reference. Closing the panel removes all analytical overlays. Selecting a new reference clears the prior pair. The existing Inspect pair in F-ALL action explicitly changes view mode without fitting the camera.

Focus on Overlap uses the existing projected camera-fit utility on the actual reference/candidate overlay coordinates, including their Z values. It preserves pitch/bearing, fits within the map/control space, and uses the existing smooth flight/reduced-motion behavior. It does not clear routes or change floors. Manual camera interaction cancels pending focus. On mobile, explicit focus closes the drawer so the map is visible.

The projected-footprint notice sits above the floating mobile room-details card, and its rectangle participates in existing route-label exclusion regions. The panel retains the current design tokens, responsive drawer, readable text summary, and local-voice controls. A result click does not start narration; the existing selected-candidate lifecycle cancels previous playback. No separate contextual speech engine was added.

## Performance

- Geographic intersections and inverse conversion occur once per uncached analysis, in the existing worker.
- Floor transforms are weakly cached by authoritative dataset-array identity and floor/spacing configuration, bounded to 16 configurations per dataset. Only selected footprints are converted into overlay roof geometry.
- Map overlay data/layers are memoized independently of camera and lighting frames. Existing building meshes, materials, light atlases, and routing geometry are reused.
- The active pair uses four lightweight layers: shared fill, outline casing, role outlines, and shared boundary. Clearing removes the intersection layers; closing removes all analytical layers through deck.gl's normal lifecycle.
- The browser checks confirmed stable building data/tessellator/model identities during repeated result changes and no additional worker analysis during camera, preset, or color-mode changes. No FPS improvement or long-term memory-leak claim is made. Retaining intersection rings adds CPU/worker-message memory within the bounded result cache.

## Verification

- **11 overlap browser scenarios passed**: F4/F5 and F4/F3, keyboard selection, all qualifying candidates, rapid replacement, clear, explicit focus, manual navigation, stacked elevations, cinematic transition/both presets/color modes, unrelated/paired floor switching, close/reopen, F0/F7, duplicate names, route preservation/draw priority, and mobile interaction. No page errors.
- A separate **40° pitch / 30° bearing** scenario passed in individual-floor and F-ALL modes, including bounds-based focus and both Night presets. Rendered Day/Night/transition images were visually inspected; no dotted transparency or Z-fighting was observed.
- A focused mobile check confirmed the projection notice does not overlap the menu or floating room-details card after explicit focus.
- Existing regression suites passed: **6 main-app route/lighting cases, 13 floor-label cases, 21 cinematic environment cases, and 11 adjacent-analysis/narration cases**. Their outputs are under `integration/`.
- **273 unit tests: 262 passed, 11 failed**, with no new failures. The same pre-existing nine routing-name and two color-enrichment expectation failures remain. The 26 geometry/overlay/panel tests pass, including holes, multipart/disconnected regions, cache invalidation, source immutability, role colors, both elevation modes, and exact real-data geometry/area agreement within `max(1e-6 m², area × 1e-8)`.
- Production build passed, including the final mobile-notice adjustment. Existing Vite CJS and bundle-size warnings remain.
- **All 51 GeoJSON files match their task-start hashes.** No room geometry, routing graph, light data, or floor stacking source was edited.

Evidence: [final verification](final-verification.json), [unit/build checks](checks.json), [browser results](browser-results.json), [regression suite status](integration/status.json), [geometry/data integrity](integrity.json), [single-floor example](above-single.png), [pitched Architectural Night](perspective/stacked-pitched-architectural.png), [final mobile map](mobile-notice/mobile-map.png).

## Files changed for this enhancement

Production:

- `src/utils/roomCorrespondence.js` — retains exact intersection geometry with provenance in the shared cached result.
- `src/layers/roomCorrespondenceLayers.js` — actual/projected roof footprints, exact intersection layers, bounded transform cache, and directional styling.
- `src/App.jsx` — result-only selection, clear/focus actions, and shared overlay props without implicit floor changes.
- `src/components/Map3D.jsx` — memoized overlay data, explicit camera focus, and projected-footprint notice.
- `src/components/MultiFloorRouteTimeline.jsx` — forwards shared analysis props to existing route-panel maps.
- `src/components/RoomCorrespondencePanel.jsx`, `src/App.css` — selected-card state, controls, directional legend, and responsive projection explanations.
- `src/hooks/useRouteLabelLayout.js` — reserves the notice rectangle in existing collision management.

Tests/harnesses:

- `src/layers/roomOverlapLayers.test.js` (new), `src/utils/roomCorrespondence.test.js`, `src/components/RoomCorrespondencePanel.test.jsx`.
- `review/interactive-overlap.cjs`, `review/overlap-perspective.cjs`, `review/interactive-overlap-checks.cjs`, `review/overlap-regressions.cjs` (new).
- `review/adjacent-room-analysis.cjs` — updates its reopen expectation for the newly required floor-preserving card behavior.
- `docs/interactive-overlap/` — reports and captured verification evidence.

The preceding adjacent-floor/narration work was already present and uncommitted when this task started. `start-hashes.json` distinguishes this enhancement from those earlier changes.

## Reproduction and limitations

With Vite on `http://127.0.0.1:3004`, run `node review/interactive-overlap.cjs`, `node review/overlap-perspective.cjs`, and `node review/overlap-regressions.cjs`. Set `PLAYWRIGHT_MODULE` when Playwright is installed outside the repository. `node review/interactive-overlap-checks.cjs` records the unit/build results and compares failures to the saved preceding baseline.

Analytical overlays intentionally show through occluding floors/walls; they are not an occlusion-accurate architectural rendering. Authoritative individual-floor polygons can differ from the combined F-ALL export; the existing reference-resolution safeguards and warning remain. Focus on a large background polygon may frame much of the building because its actual footprint is large. Footprint overlap does not establish access, structural support, or shared building systems. Browser verification used Windows Chrome and an emulated mobile viewport, not physical mobile hardware or every browser/GPU. The 11 prior unit failures remain outstanding; no new defect remained confirmed by the completed checks.
