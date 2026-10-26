# Stage 5 — Interior-light activation

Implemented the full-night activation stage using the existing combined GeoJSON, spatial sampler, surface-light atlas, and three instanced fixture/glow layers. The combined source remains authoritative, as previously requested. No floor-specific light files were substituted and no source data was edited.

## Behavior and timing

1. A Night request starts preparing `interior_lights.geojson` while the existing eight-second environmental transition runs. Initial daylight does not fetch lighting data.
2. Parsed anchors and the room-light sampler are shared across map views. Each active map prepares its existing GPU atlas and fixture models with fixture gain zero.
3. Activation waits for the environment's `fullNight` endpoint and the registered map resources to be ready. A building still revealing also waits until its fixture layers can render.
4. Interior illumination and fixture glows then share a **1,200 ms** activation ramp. `INTERIOR_LIGHT_RAMP_MS` in `src/utils/interiorLightActivation.js` configures the default; the controller also accepts a duration option.
5. Returning to Day immediately targets zero interior gain while the environmental controller runs dawn. A full dimming sweep takes 1,200 ms. Reversal uses the current progress/intensity rather than restarting from an endpoint.

The activation clock reuses `createEnvironmentClock`: monotonic timestamps, frame-rate-independent travel, at most one scheduled RAF, and smoothstep gain. It is owned by `App` and passed to the main map and every route panel. Preset and camera changes are not clock inputs. Reduced motion resolves to the requested gain as soon as resources are ready, without playing the ramp.

The browser's normal activation first became nonzero **8,211.7 ms** after the Night request and reached full gain at **9,381.3 ms**. These include frame/browser scheduling; the configured durations remain 8,000 ms plus 1,200 ms. At environmental progress 0.3997, both controller gain and the actual surface shader uniform were zero.

## Loading, failures, and cleanup

`interiorLightResources` exposes `idle`, `loading`, `ready`, and `error` snapshots through `useSyncExternalStore`. Pending requests coalesce, and successful parsed data and the sampler remain cached for the page session. Resource updates notify React only when loading state/data changes.

A small non-blocking status message explains preparation. Failed HTTP requests, invalid GeoJSON, and a **20-second timeout** leave ambient Night rendering available. The message offers **Retry interior lights**; a new Night request also retries. Floor changes and route-panel mounts do not repeatedly retry an existing failure. A delayed response arriving after the user returns to Day warms the cache but does not illuminate the building.

GPU readiness is reported after initialized surface models have an atlas. The callback completes outside the active Deck draw. Loaded records stay available during dawn/day so toggling does not evict/recreate fixture geometry or the atlas. A newly mounted floor can prepare independently after activation without dimming already-lit panels.

The activation RAF directly requests Deck redraws. Existing layer draw methods read one stable gain function and update uniforms; the ramp does not set React state, modify lighting records, rebuild geometry, or upload new textures. The recorded React render count stayed at **112 throughout the activation ramp** in the StrictMode fixture.

Atlas ownership remains with the existing reference-counted cache, shared by room bodies and walls within a GL context. Route panels have separate GL contexts and therefore separate GPU textures; they share parsed data, sampling work, and activation intensity. Removing views releases their textures. Unmount also removes redraw subscriptions and motion-preference listeners and cancels the activation clock. Shared pending data fetches may complete into the cache; they are bounded by the timeout and do not update unmounted subscribers.

## Geometry and source attributes

All 138 enabled anchors retain their supplied intensity, radius, color, and local height. The existing enabled/validity filters remain in use. No fixture was invented for F7.

| Floor | Enabled anchors |
| --- | ---: |
| F0 | 19 |
| F1 | 20 |
| F2 | 23 |
| F3 | 16 |
| F4 | 23 |
| F5 | 19 |
| F6 | 18 |
| F7 | 0 |
| F-ALL | 138 |

The positioning code is unchanged. Dataset-backed tests confirm:

- On each supplied individual floor, fixture Z equals `z_height`.
- In F-ALL, fixture Z equals the **rendered floor datum + `z_height`**, with local height added once. Tests compare directly with the coordinates produced by `buildFilteredIndoorFeatureCollection`, rather than assuming the combined export's raw base is already the final rendered datum. The existing renderer combines source bases and its display-stack offsets; this stage does not change that convention.
- F7 has zero fixture layers and retains the existing ambient Night surface rendering.

All **51 public GeoJSON files** match their task-start SHA-256 hashes, including rooms, centerlines, walls, and light files. Fixture source positions/radii, room geometry, floor stacking, routing graphs, and label anchors were not modified.

## Files changed

New production files:

- [interiorLightActivation.js](../../src/utils/interiorLightActivation.js): shared readiness gate and reversible gain clock.
- [useInteriorLightActivation.js](../../src/hooks/useInteriorLightActivation.js): App lifecycle, Night-request preparation, reduced motion, and cleanup.
- [interiorLightResources.js](../../src/utils/interiorLightResources.js): shared request/data/sampler cache, timeout, loading states, and retry policy.

Updated production files:

- [useInteriorLighting.js](../../src/hooks/useInteriorLighting.js): subscribes to shared resources and retains loaded anchors across Day/Night changes.
- [App.jsx](../../src/App.jsx), [MultiFloorRouteTimeline.jsx](../../src/components/MultiFloorRouteTimeline.jsx): own and forward the shared activation controller.
- [Map3D.jsx](../../src/components/Map3D.jsx): readiness registration, redraw subscription, gain integration, and loading/retry UI.
- [IndoorBuilding.jsx](../../src/components/IndoorBuilding.jsx): forwards the gain reader and resource-ready callback to existing surface layers.
- [nightSurfaceLayer.js](../../src/layers/nightSurfaceLayer.js): reads activation gain into `fixtureGain`; existing ambient, color-space, exposure, highlight, and atlas calculations remain intact.
- [interiorLightLayer.js](../../src/layers/interiorLightLayer.js): applies the same gain to existing glow/fixture opacity at draw time.
- [App.css](../../src/App.css): compact loading/error message styling.

Added focused tests: `interiorLightActivation.test.js`, `interiorLightResources.test.js`, and `interiorLightPlacement.test.js` under `src/utils`. Review fixtures/runners are `review/interior-stage5.{html,jsx,cjs}`, `review/interior-stage5-app.cjs`, and `review/interior-stage5-resources.cjs`.

## Verification results

**45 distinct focused unit tests passed** across activation, loading/cache/timeout, authoritative placement, existing interior lighting, environment, surface lighting, and presets. Tests include delayed completion after a Day request, rapid toggles, mid-ramp reversal, reduced motion, subscriptions, disposal/StrictMode reconnection, exact source attributes, and every floor's light positions. [Activation/cache test results](activation-tests.json).

**25 browser scenarios passed** with no captured JavaScript or GLSL errors. [Browser results](browser.json) cover:

- F0–F7 and F-ALL in both Architectural Night and GIS Night.
- No pre-endpoint fixture gain, followed by a smooth full-night activation.
- Stable data, GPU model, atlas, and tessellator identities through activation.
- No React rerenders during the independent light ramp.
- Mid-ramp reversal and manual camera movement.
- Preset changes preserving full-night environment progress and light gain.
- Delayed loading held through full night: ambient rendering and camera controls remained available; releasing the response completed preparation and activation in 1,693 ms.
- Simulated HTTP 503 failure and successful explicit retry.
- Repeated switching, reduced motion, and unmount during dimming.

**Six full-app route scenarios passed** with no captured errors. [Route/app results](app-browser.json) confirm that F1–F3 timeline panels share the same gain, preserve paused camera/preview state and GPU resources during activation, and allow animated preview to continue through both sunset and the light ramp. In the activation interval, preview progress advanced from **0.110 to 0.125**. F-ALL camera state also remained unchanged on return to Day.

**Ten additional Day/Night cycles passed** with one combined-data request, identical model/data/atlas objects, and confirmed atlas texture deletion on unmount. A separate failure check verified that a floor change did not retry, while a new Night request retried once and recovered. [Resource results](resources.json).

`npm run build` passed. Existing Vite CJS-deprecation and large-chunk warnings remain. Targeted whitespace checks passed. The entire unrelated repository test suite was not rerun.

Screenshots: [Architectural Night](architectural-night.png), [GIS Night](gis-night.png), [full-app Day](app-day.png), [full-app Night](app-night.png), and [failure/retry UI](loading-failure.png).

## Limitations and reproduction

F7 has no interior-light anchors; ambient rendering is intentional. Verification used installed Chrome with SwiftShader/WebGL2 and included React StrictMode; physical mobile-GPU performance and WebGL float-texture fallback hardware were not benchmarked. Actual wall-clock activation can be delayed by loading, GPU preparation, or a busy browser, without advancing the light ramp before readiness.

With Vite running on port 3004 and `PLAYWRIGHT_MODULE` pointing to the installed Playwright package, run the three `review/interior-stage5*.cjs` scripts. The focused unit tests run through Vitest. Stage 5 is complete; no later-stage work was included.
