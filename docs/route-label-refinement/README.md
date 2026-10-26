# Route-label sizing and decluttering correction

## Confirmed cause

The existing four route TextLayers already specified pixel sizes and billboarding. That alone did not guarantee constant screen size in the installed deck.gl 8.9 renderer: its `project_pixel_size_to_clipspace` helper multiplies offsets by the viewport focal distance, and the final perspective divide uses each anchor's clip-space W. Off-center or elevated anchors therefore retained perspective scaling. Earlier measurements centered the camera on each label and largely missed this defect.

With zoom 19 and pitch 60 degrees, shifting the camera latitude by ±0.00025 around the same room changed the raster width of `Classroom 0174` from **80 to 111 pixels**. After the correction it measures **92 pixels in both positions**, and across zooms 17/19/21 and pitches 0/45/60/65 degrees. The building continues to project normally.

The annotation circles also used meter-sized radii and default meter-sized outlines. The start-room glow previously ranged from 10 to 140 pixels wide across zooms 17–21. These were separate sources of visible scaling.

## Implementation

- Preserve the existing TextLayers, font sizes (12/10.5/10 pixels), authoritative identities, room anchors, floor elevations and shared collision group.
- Correct billboard offsets on the GPU by multiplying them by `clipW / focalDistance`, cancelling perspective scaling for text, backgrounds, pixel offsets and associated route markers. The collision lookup uses the same corrected screen offset. This is a projection correction in the existing renderer, not a zoom-driven typography rule or another rendering system.
- Give endpoint/landmark/connector glows and the preview indicator pixel-sized radii and outlines. Existing endpoint animation remains independent of zoom.
- Limit names to two lines with ellipsis; retain the full name in room data/details.
- Reduce the total label budget to at most six, with additional labels allowed only when both projected building area and visible route length provide room. Below 32,000 square screen pixels or 100 route pixels, permit one endpoint name; below 12,000 or 45 respectively, retain pins/route without room text.
- Retain the existing 4.5-meter polygon-to-route filter, holes/multipart handling, stable IDs and preview windows. Add a same-floor screen-space gate: secondary landmark anchors must be within 96 pixels of the route, with 12 pixels of retention hysteresis. This avoids labeling the distant interior of a large polygon merely because its boundary touches the route.
- Hide secondary landmarks when the projected building area is below 90,000 square screen pixels or the visible route is shorter than 240 pixels. Keep endpoints/connectors prioritized. The existing route-progress, active-floor and upcoming-connector logic remains in place.
- Keep cached geographic work separate from camera projection/layout. No new per-frame geometry or texture allocation.

## Files changed for this correction

- `src/components/Map3D.jsx`: pixel-sized route annotations and shared projection extension.
- `src/layers/routeLabelCollisionExtension.js`: projection correction and matching collision lookup; lightweight extension for route markers.
- `src/hooks/useRouteLabelLayout.js`: cursor exclusion matches its fixed pixel halo.
- `src/utils/routeLabelLayout.js`: stricter budgets, same-floor screen corridor, two-line text layout.
- `src/utils/routeLabelLayout.test.js`, `src/layers/routeLabelCollisionExtension.test.js`: focused regressions.
- `review/route-label-refinement.cjs`, `review/route-label-perspective-baseline.cjs`, `review/route-label-wheel.cjs`: reproducible browser measurements and interaction checks.
- This directory contains measurement JSON and screenshots. Earlier stage browser fixtures were reused for integration checks.

Routing graphs, room coordinates, light sources, lighting controllers/materials, floor stacking, camera controls and route-preview timing were not changed by this correction. Pre-existing workspace edits remain in place.

## Verification

Chrome 155, SwiftShader, 1440×1000 viewport, DPR 1. Raster tests isolate an actual production layer, preserve its pixel-projection extension and disable collision only to measure the complete glyph/background. Full-app checks retain collision handling.

| Measurement | Before correction | After correction |
| --- | --- | --- |
| Classroom 0174, near/far off-center views | 80–111 px wide | 92 px wide |
| Rest Room Female, near/far off-center views | 80–110 px wide | 92 px wide |
| Classroom label including background, all tested views | not recorded | 101 px wide, 21–22 px high |
| Start-room glow, tested zooms/angles | 10–140 px wide | 30 px wide |
| Preview dot, all tested views | meter-scaled | 24×23 px raster |
| Preview halo, all tested views | meter-scaled | 36 px wide, 36–37 px high |

One-pixel edge differences are rasterization/antialiasing. Both text-only and background-inclusive runs passed, totaling **154 raster samples**. See `before-perspective.json`, `after-pixels.json`, and `after-background.json`.

The same F1 route (0174 to 0181) shows:

| View | Previous visible labels | Revised visible labels |
| --- | --- | --- |
| Zoom 19 | 5 | 3 |
| Zoom 16.5 | 2 | 1 |
| Zoom 19.5, paused | 7 | 4 |
| Pitch 60, bearing 75 | 6 | 4 |
| F-ALL, paused cross-floor route | 8 | 4 |

- **47 focused unit tests passed** across six files: layout, polygon proximity, room identity, landmarks, anchors and shader/collision integration.
- Browser fixtures passed F0–F7 and F-ALL, duplicate names, elevations, transition fallback labels, Architectural Night, GIS Night and Day.
- Full-app route checks passed close/far views, pause/play/seek, timeline/stacked views, sidebar collapse/expansion and route clearing with no application/GLSL errors in the final run. Its last mobile drawer check timed out; mobile interaction is checked separately in `wheel.json` rather than counting that full run as wholly passed.
- Native mouse-wheel, zoom-control, Reset View and mobile drawer checks passed on the 0110 → 0130 route. The open mobile drawer suppresses all labels. See `wheel.json` for measured zoom and visible names; fitted mobile views may omit endpoint text where it cannot fit around controls/markers.
- Production build passed. Existing large-bundle and Vite CJS deprecation warnings remain.

## Limits

Mapbox style requests failed in this environment during the full-app checks, so the screenshots show the loaded indoor geometry over the fallback background. Label/marker pixels, camera projection, floor behavior and route interaction were measured directly; basemap visual appearance was not validated here. Hardware GPU/browser combinations beyond Chrome SwiftShader were not tested.

The shader correction targets the installed deck.gl 8.9 projection convention. Recheck these raster tests when upgrading deck.gl. At extremely distant zooms names intentionally disappear while route pins and directions remain available; font size is never reduced to fit the building.
