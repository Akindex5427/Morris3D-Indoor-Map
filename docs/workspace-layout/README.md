# Immersive full-height map workspace

## Implementation

The custom technology-stack footer was rendered directly in `src/App.jsx`, after the main workspace. Its JSX and all `.app-footer` CSS rules have been removed. It no longer contributes a flex item, its text height, or the extra flex gap. Mapbox/OpenStreetMap attribution and the Mapbox logo remain inside each map.

The existing layout already used a column flex shell, an intrinsic-height header, a flexible `.main-content` with `min-height: 0`, and a flexible map with `min-width: 0`. That structure is retained. `.App` now uses `height: 100vh` followed by `height: 100dvh` for browsers supporting dynamic viewport units. The main workspace receives the remaining height after header, gap, and existing safe-area-aware outer padding. There is no JavaScript height subtraction or footer reservation. The 12px outer design margin remains; it is not a footer gap.

Desktop header vertical padding changed from 12px to 4px and text spacing from 4px to 2px, preserving the existing title typography, subtitle, palette, and floor chip. The floor chip does not shrink. Compact portrait headers now retain the workspace label and current-floor chip, with wrapping at narrow widths; the subtitle is omitted. Those small headers are deliberately taller than before to preserve this information. The pre-existing compact landscape presentation still hides the header and shows the current floor in the map toolbar.

The mobile drawer keeps its existing state and interaction model. Its height now also has a dynamic-viewport fallback and is capped at the available workspace. Desktop sidebar scrolling and horizontal collapse behavior are unchanged.

Help moved from a viewport-fixed element into `.map-container`, with a 44px bottom clearance above attribution. It has an explicit accessible name. The existing short-map slider rule now hides the optional slider below 400px map height, keeping Zoom In, Zoom Out, Fit Building, and Help separate in landscape and short route panels. The slider remains available in the tested portrait and desktop views.

## Resize and attribution behavior

`Map3D.jsx` already observes its container with `ResizeObserver`, coalesces callbacks with `requestAnimationFrame`, calls Mapbox `resize()`, and requests a deck redraw. It also already handles the sidebar layout signal. No new resize observer, map instance, camera fit, or view-state mutation was added.

Actual browser checks found that the default deck view/canvas could intercept clicks on the native compact attribution control. Scoped CSS makes these two full-size surfaces transparent to pointer targeting, while Mapbox controls remain targetable. Deck's existing event manager still receives map interactions on its wrapper. The basemap's original negative stacking order is retained, and no rendering/material change is involved. Final tests exercised real pointer panning, GPU room picking, room selection, and opening attribution. A temporary alternative stacking experiment was discarded before production changes.

## Measured layout results

Measurements are CSS pixels, taken in Windows Chrome with the same viewport sizes before and after. Small fractional differences reflect font/layout rounding.

| Viewport | Header before / after | Map height before / after | Map height gained |
| --- | --- | --- | --- |
| 1920 × 1080 | 98.06 / 78.06 | 918.94 / 965.94 | 47 |
| 1440 × 900 | 98.06 / 78.06 | 738.94 / 785.94 | 47 |
| 1366 × 768 | 98.06 / 78.06 | 606.94 / 653.94 | 47 |
| 1024 × 720 | 90.66 / 70.66 | 566.34 / 613.34 | 47 |
| 820 × 1180 | 89.67 / 69.67 | 1031.33 / 1076.33 | 45 |
| 390 × 844 | 56 / 66 | 718 / 746 | 28 |
| 320 × 568 | 56 / 75.31 | 442 / 460.69 | 18.69 |
| 844 × 390 | hidden / hidden | 366 / 366 | 0 (footer was already hidden) |

The standard desktop header is 20.4% shorter. Every tested map reaches the workspace bottom, with only the intentional safe-area/outer margin. There is no document overflow. Mapbox canvas and deck viewport dimensions match the container within normal subpixel rounding.

## Verification and evidence

- `review/workspace-layout.cjs`: eight responsive sizes; footer absence; bottom alignment; document overflow; map/canvas sizes; sidebar opening, scrolling and closing; Help/attribution/zoom-control separation; camera preservation and retained map/canvas identity across sidebar and browser resizing; zoom button/slider synchronization; Fit Building; Help opening.
- `review/workspace-interaction.cjs`: actual pointer pan, Mapbox/deck ground-plane projection comparisons after both sidebar transitions, GPU picking and clicking Classroom 0174 after resizing, fresh mobile load, and an actual click to expand attribution. Ground-plane samples agreed to well below one CSS pixel. No page errors.
- The existing main route/lighting, floor-label, cinematic environment, and adjacent-analysis/narration browser suites passed: 6, 13, 21, and 11 scenarios respectively. These cover F0–F7, F-ALL, room search, routing/preview, both Night presets, analysis, and narration.
- All 11 existing interactive-overlap browser scenarios passed against the final layout, including actual shared footprints, F-ALL, route preservation, and mobile explicit focus. The final responsive checks and production build also passed; exit codes are recorded in `final-checks.json`.
- Full existing unit suite: **262 passed, 11 failed out of 273**. The failures match the prior baseline: nine routing-name expectations and two color-enrichment expectations. No new unit failures. No tests were added that merely assert CSS implementation details.
- Production build passed. Existing Vite CJS and bundle-size warnings remain.

Evidence: [before measurements](before.json), [after measurements](after.json), [interaction results](interaction.json), [unit/build results](checks.json), [existing regression status](integration/status.json), [final checks](final-checks.json), [overlap browser results](overlap/browser-results.json).

Rendered screenshots inspected during verification:

- [Desktop](after-1440x900.png)
- [Phone portrait](after-390x844.png)
- [Narrow phone](after-320x568.png)
- [Landscape](after-844x390.png)
- [Fresh mobile load](mobile-initial.png)
- [Expanded attribution](mobile-attribution.png)

The responsive-series screenshots preserve the same camera while changing viewport size, so the building may become cropped on narrower screens. This is intentional camera preservation, not an automatic refit. Fit Building remains the explicit recovery action.

## Files for this task

Production files:

- `src/App.jsx`: remove footer markup; place and name Help inside the map.
- `src/App.css`: dynamic-height shell/drawer, compact header, removal of footer rules, map-relative Help, short-map controls, attribution pointer access.

Added verification/report files:

- `review/workspace-layout.cjs`
- `review/workspace-interaction.cjs`
- `docs/workspace-layout/` report, measurements, logs, screenshots, and regression artifacts.

Other uncommitted files from the preceding adjacent-room/interactive-overlap enhancements were preserved. No GeoJSON, routing, room-analysis, camera, shader, material, or lighting source was changed by this task.

## Reproduction and limits

With the existing Vite server on `http://127.0.0.1:3004`, run the two new `review/workspace-*.cjs` scripts. Set `PLAYWRIGHT_MODULE` if Playwright is installed outside the repository. `node review/workspace-layout.cjs --baseline` captures measurements without asserting the new layout; do not overwrite the saved before evidence when checking the final app.

Browser verification used headless Windows Chrome with software WebGL and emulated viewport sizes. Physical mobile address-bar behavior, notches, touch gestures, and Safari/Firefox were not directly tested. CSS dynamic viewport units retain a `vh` fallback. The 11 pre-existing unit failures are outstanding; no performance improvement is claimed from these layout measurements.
