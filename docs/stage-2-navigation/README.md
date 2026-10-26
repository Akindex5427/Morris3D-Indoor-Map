# Stage 2 — Navigation and camera framing

Completed October 23, 2026. Scope: map navigation and initial framing only.

The map now has accessible Zoom In, Zoom Out, a vertical zoom slider, and Fit Building controls. The slider follows the actual camera, including wheel, touch, keyboard, and programmatic zoom. Buttons have 44 × 44 pixel targets; the optional slider hides in short map containers.

Initial load preserves F1 and the existing 45-degree pitch and north-facing bearing. Fitting waits for geometry, Deck initialization, and settled container dimensions. It projects the rendered building silhouette, including wall heights, to find a zoom that fills approximately 85% of the limiting dimension of the usable region. The region accounts for the header/sidebar through the map container and reserves space beside or below the control rail. This is a geometry-based fit, not a fixed zoom.

Initial fitting runs once. Manual navigation cancels a pending fit, and subsequent floor changes or sidebar resizing do not reset the camera. Fit Building explicitly frames the current floor or F-ALL without clearing the selected floor, search, or route. F-ALL includes the stacked geometry and full-height exterior shell. Route timeline panels retain their existing overhead orientation.

## Files changed for Stage 2

| File | Change |
| --- | --- |
| `src/App.jsx` | Initial/reset fit requests, manual-interaction handling, consistent keyboard zoom limits; removes floor-load recentering. |
| `src/App.css` | Compact navigation rail, focus styles, responsive placement and short-container behavior. |
| `src/components/Map3D.jsx` | Connects geometry, renderer readiness, camera controls and fitting; removes synthetic window resize dispatches. |
| `src/components/IndoorBuilding.jsx` | Exports the existing geometry transformation for reuse by the fitter. |
| `src/components/MultiFloorRouteTimeline.jsx` | Preserves panel camera orientation and manual navigation during layout changes. |
| `src/components/MapCameraControls.jsx` | New accessible buttons and controlled native zoom slider. |
| `src/hooks/useMapCameraNavigation.js` | New one-time fit lifecycle, size measurement, explicit reset and synchronized zoom actions. |
| `src/utils/buildingCamera.js` | New projected silhouette fitting, wall bounds and shared zoom limits. |
| `src/utils/buildingCamera.test.js` | 13 new camera geometry and framing tests. |
| `review/navigation-check.cjs` | Browser verification against the running application. |
| `docs/stage-2-navigation/` | This report, results and screenshots. |

Other workspace changes predating Stage 2 were preserved. No dependencies or GeoJSON datasets were changed by Stage 2; all 51 checked GeoJSON files match their Stage 2 starting hashes.

## Verification

- Production build: passed. Existing bundle-size and Vite CJS deprecation warnings remain.
- New camera tests: **13 passed**, including real floor geometry, F-ALL shell heights, desktop/mobile/short containers, orientation, zoom limits and source immutability.
- Full test suite: **115 passed, 11 failed**. The failures match the Stage 1 baseline: two room-color restoration assertions and nine routing-anchor assertions. Names and data-integrity results are in [test-summary.json](test-summary.json).
- Browser verification: passed, exit code 0, **no page errors**. Recorded results are in [browser-results.json](browser-results.json).
- `git diff --check`: passed.

| Browser scenario | Result |
| --- | --- |
| Initial desktop load (1440 × 1000) | F1, 45-degree pitch, approximately 85% fit, no control overlap. |
| Initial mobile load (390 × 844) | F1, approximately 85% fit in the region below the controls, no overlap. |
| Zoom far out and reset | Restores the geometry-derived fit. |
| Wheel, slider, keyboard, programmatic zoom | Camera and slider remain synchronized. |
| Touch pinch | Camera zoom changes and slider follows. |
| Floor switching | Retains manual view; Reset fits F0, F2 and F7. |
| F-ALL | Fits stacked rooms and full-height shell without clipping. |
| Sidebar expansion/collapse and mobile drawer | Preserves camera; explicit Reset uses current container dimensions. |
| Search followed by Reset | Search query, filtered results and selected floor retained. |
| Single-floor route planning | Route retained during Reset and zoom. |
| Multi-floor route panels | Controls work, overhead orientation retained, sidebar changes preserve manual camera. |
| GIS and Architectural Night presets | Presets render and remain selected through Reset; preset changes preserve camera. |

Screenshots: [desktop](initial-desktop.png), [mobile](initial-mobile.png), [F-ALL](all-floors.png).

Browser checks used headless Chrome with software WebGL. They verify behavior and projected bounds, not hardware rendering performance. Existing floor elevation conventions and the Stage 1 data-quality findings remain unchanged.

## Reproduction

```powershell
npm.cmd run build
npm.cmd run test -- --run
```

With the application running locally and Playwright plus Chrome available:

```powershell
$env:NAVIGATION_REVIEW_URL = 'http://127.0.0.1:3001'
node review/navigation-check.cjs
```

If Playwright is installed outside the project's module resolution path, set `PLAYWRIGHT_MODULE` to that installation's module path. The harness writes results and screenshots to this directory by default; `NAVIGATION_REVIEW_OUTPUT` can override it.

Stage 2 is complete. Stage 3 has not been started.
