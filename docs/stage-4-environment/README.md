# Stage 4 - Reversible cinematic environment

Subsequent correction: the original Stage 4 depth/blending choices described below caused a daylight visual regression. See the [Day Mode restoration report](../day-restoration/README.md) for the corrected endpoint state, early-sunset depth handoff, and measured comparisons.

Implemented for the Morris Library viewer. Scope ends at Stage 4; Stage 5 fixture activation policy is not implemented.

## Controller and appearance

`App` owns `useEnvironmentController(darkMode)` and passes the same sampled environment to the main map and every multi-floor route panel. The Night mode checkbox controls a target, not a shader or basemap replacement.

`createEnvironmentClock` uses `performance.now()` / RAF timestamps and an 8,000 ms full-range duration. Reversing snapshots the current elapsed-time state and travels toward the opposite endpoint at the same progress speed. One outstanding environmental RAF is permitted. Completion cancels further scheduling; effect cleanup cancels RAF and removes the reduced-motion listener. Reduced motion resolves immediately to the requested endpoint, including when the preference changes during playback.

All appearance keyframes, including basemap palette weights, live in `src/utils/environment.js`. Scalar and array values interpolate with smoothstep between keyframes; directional vectors are normalized. No camera, room selection, route geometry, preview progress, floor selection, or label anchors are controller inputs or outputs.

| Progress | Environment | Main properties |
| --- | --- | --- |
| 0 | Daylight | Authored basemap paint; neutral ambient and directional light; original day colors |
| 0.36 | Golden hour | Warm ambient fill, amber sunlight, low sun direction, slightly higher exposure, warm basemap |
| 0.70 | Blue hour | Cool ambient fill, diminished sunlight, lower exposure, blue basemap/atmosphere |
| 1 | Full night | Existing preset-based fragment illumination, restrained exterior envelope, dark basemap and night atmosphere |

Architectural Night and GIS Night retain their existing tuning objects and independent short preset interpolation. Changing a preset does not touch environmental progress. Reversing day/night also no longer snaps an in-progress preset interpolation to its target.

## Continuous building rendering

The active `useIndoorBuilding` hook always uses the same `NightSurfaceLayer` subclass and stable room/wall layer IDs. One shader blends day-lit RGB/alpha into the existing per-fragment night result. A cached night-color attribute retains source colors and endpoint alpha independently of the day-lit color. Selected rooms, route endpoints, connectors, and route landmarks retain the existing priority rules. The existing night exposure, ambient levels, source color retention, boundary transmission and light atlas remain in use.

The original room `material` function was not a supported deck.gl material accessor: it effectively used deck's material defaults. The permanent shader now declares those same daylight defaults explicitly. Wall materials retain their authored daylight values. Transparent building layers consistently disable depth writes throughout the cycle, avoiding a state switch during sunset. Depth testing stays enabled. Exterior mesh colors/alpha and material uniforms interpolate on stable IDs and mesh data; their small per-instance color buffers update during the transition.

Room geometry receives stable atlas row provenance independently of light loading. Light sampling updates the atlas/count attributes without reconstructing polygons or procedural walls. The existing shared GeoJSON light loader preloads and caches anchors in daylight. No fixture coordinates, radii, floor offsets, route graphs or datasets were modified.

Browser inspection exposed an existing side-wall shader problem: deck's `IS_SIDE_VERTEX` macro is defined after injected shader modules. The old conditional could read non-instanced attributes on instanced wall faces. The custom layer now supplies an early `NIGHT_SIDE_VERTEX` define and computes edge coordinates at the end of vertex `main`. The browser checks the actual compiled attribute locations for both top and side models.

## Basemap adapter

The selected daytime style stays mounted throughout day/night changes. The adapter changes supported paint properties, legacy Mapbox light parameters and fog/atmosphere; it never calls `setStyle`, changes a camera, or adds/removes application sources/layers. Explicit user changes between Streets and Outdoors remain supported: `style.load` captures the new style and reapplies the current environment.

Color-expression output values are transformed while retaining `zoom`, `match`, `case`, `step`, interpolation stops, and data keys. Application-owned GeoJSON/custom layers are excluded. Supported authored colors include hex, RGB(A), HSL(A), white, black and transparent. The adapter updates paint at approximately 30 Hz for the standard eight-second timeline; building uniforms use the shared RAF state. Mapbox's own property transitions are disabled for controlled properties to prevent a second easing timeline. Returning to daylight restores exact authored paint expressions, fog and light values. Cleanup removes the style listener and restores baseline paint/transition settings where the map still exists.

Live tests covered **149 color properties in Streets v12** and **162 in Outdoors v12**, with no unsupported color properties encountered in those loaded styles, no adapter failures and no Mapbox validation errors. Custom source identity, custom layer paint, Mapbox style object identity and camera values were preserved during each sampled cycle.

## Interior-light boundary for Stage 5

Existing fixture pools, halos and cores remain the same three instanced layers with the same data and positions. A temporary compatibility gain fades their opacity and surface contribution in during the final portion of the environment timeline and reverses it on the way to day. The controller exposes `fullNight` only at progress 1. Stage 5 can attach its endpoint activation behavior to that signal without rebuilding the environmental controller or fixture geometry. This stage does not add fixture scheduling, a new fixture system, or a separate post-night activation sequence.

## Files changed in this stage

New production files:

- `src/utils/environment.js` - keyframes, interpolation and reversible monotonic clock.
- `src/hooks/useEnvironmentController.js` - shared React lifecycle and reduced-motion handling.
- `src/utils/mapEnvironment.js` - style-aware color/light/atmosphere adapter.
- `src/hooks/useMapEnvironment.js` - Mapbox load/update/cleanup integration.

Updated production files:

- `src/App.jsx` - owns and shares the environment.
- `src/components/Map3D.jsx` - continuous environment, stable basemap, cached fixture loading and opacity.
- `src/components/MultiFloorRouteTimeline.jsx` - forwards the shared environment to every panel.
- `src/components/IndoorBuilding.jsx` - stable shader layers, endpoint color attributes, persistent lights and atlas row provenance; removes unreachable legacy filtering code.
- `src/layers/nightSurfaceLayer.js` - day/night shader blend, stable empty-atlas fallback, corrected side attributes, continuous alpha/exposure.
- `src/utils/interiorLighting.js` - continuous exterior envelope appearance on stable layer IDs.
- `src/hooks/useInteriorLighting.js` - daylight preload with the existing toggle-based retry signal.
- `src/hooks/useNightPreset.js` - preset interpolation survives environmental reversal.

Tests and evidence:

- `src/utils/environment.test.js` - nine focused controller/adapter/light-identity tests.
- `src/utils/interiorLighting.test.js`, `src/utils/surfaceLighting.test.js` - update envelope expectations for continuous appearance and stable IDs.
- `review/environment-stage4.{html,jsx,cjs}` - production Map3D fixture, temporal tests and GPU resource/binding assertions.
- `review/environment-stage4-app.cjs` - actual application routing/timeline verification.
- `review/environment-stage4-map.cjs` - live Streets/Outdoors adapter verification.
- This directory - reports, raw JSON results and screenshots.

Earlier uncommitted work was retained. No dependency changes or new rendering library were required.

## Verification

The final targeted Vitest run passed **90/90 tests in 10 files**. It covers clock progression at different frame intervals, keyframe interpolation, reversal, rapid toggles, disposal, reduced motion, light object reuse, paint expression preservation, custom sources/camera preservation, existing preset behavior, source colors, light placement, route label layout/proximity/identity, interior anchors and vertical correspondence on the real datasets. This is a targeted regression suite, not a claim that every pre-existing repository test passes.

The production Vite build passed: main JS **1,501.02 kB**, gzip **423.81 kB**. Existing CJS API and large-chunk advisories remain.

Browser verification used headless Chrome on this Windows workspace with ANGLE SwiftShader (software WebGL), 1440x1000 for the map/application scenarios. The live basemap adapter run used 1200x900. These are functional checks, not hardware-GPU frame-rate benchmarks.

- [Browser fixture results](browser.json): 21 recorded scenarios, including forward/reverse keyframes, a timed complete transition (8,313.8 ms observed by browser polling for the 8,000 ms clock), interrupted reversal, night preset changes, F0-F7 and F-ALL, reduced motion and unmount during playback. The script asserts stable polygon data, tessellator, position buffer, GPU models, atlas texture, camera, route and focus references across environmental samples. It checks top/side attribute bindings and records zero application/GLSL errors on the successful run.
- [Actual application results](app-browser.json): initial F1 day/night preserved the camera; two computed F1 to F3 route panels shared exactly the same intermediate progress and unchanged cameras; paused preview progress was retained; playing preview advanced through sunset; F-ALL returned to daylight without a camera change. Zero captured application/GLSL errors.
- [Live basemap results](basemaps.json): both supported styles preserved custom sources/layers and camera state, changed color through the timeline, and restored exact daylight paint. Zero captured Mapbox validation errors.
- Visual evidence: [day](progress-0.png), [golden hour](progress-0.36.png), [blue hour](progress-0.7.png), [night](progress-1.png), and [application night UI](app-night.png).

Reproduce with:

```text
npm test -- --run src/utils/environment.test.js src/utils/nightPresets.test.js src/utils/surfaceLighting.test.js src/utils/interiorLighting.test.js src/utils/roomColors.test.jsx src/utils/routeLabelLayout.test.js src/utils/routeProximity.test.js src/utils/routeLabelIdentity.test.js src/utils/roomLabelAnchor.test.js src/utils/roomCorrespondence.test.js
npm run build
```
 Browser scripts expect Vite at `http://127.0.0.1:3004`, Chrome and Playwright (`PLAYWRIGHT_MODULE` may point to a local installation). Live Mapbox verification requires network access and the existing configured token.

## Limitations and intentional fallbacks

- Full night retains the selected style's cartography with a dark palette. It does not load `dark-v11`, so its labels, sprites and layer inventory are not a pixel-for-pixel copy of that separate style.
- Raster imagery, pre-colored sprites, dynamically constructed color expressions, unsupported CSS color forms, and imported Standard-style configurations are left as authored. The current UI's Streets/Outdoors styles are verified. A future unsupported style needs its own adapter coverage rather than destructive style replacement.
- Atmosphere uses supported Mapbox fog, sky colors and star intensity. Its visibility depends on camera pitch and view extent. This is an art-directed timeline, not a solar ephemeris, global-illumination simulation, moving shadow system or bloom postprocessing pipeline.
- UI chrome still follows the existing Day/Night target theme immediately; the map environment follows the cinematic timeline. Reduced-motion users intentionally receive immediate environment endpoints.
- If float light textures are unavailable, the existing ambient-only surface fallback remains. Missing fixture data does not hide the building. The combined source still has no invented F7 fixtures.
- No handheld-device or hardware-GPU performance certification was performed. Software-rendered browser timing includes scheduler and polling overhead. Mapbox networking was intermittent in some application runs; the separate live-style test successfully loaded and verified both styles.
