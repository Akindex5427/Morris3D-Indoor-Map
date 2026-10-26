# Stage 6 — Final integration and performance verification

Verification completed on October 26, 2026. Browser tests were actually executed against the application and its existing production-component fixtures. The production build passes. The full unit suite has **236 passes and 11 failures out of 247 tests**; the failing test names are identical to the previously recorded failures. All 14 browser suites completed successfully after correcting outdated test assumptions and readiness checks.

One confirmed performance regression was corrected: continuously rewriting feature-dependent Mapbox color expressions caused repeated tile paint-buffer and atlas uploads. Matched production runs show **44–49% fewer temporary buffer/texture creations** in the tested transitions. This is an allocation reduction; no general FPS improvement is claimed.

## 1. Files changed

Application:

- `src/utils/mapEnvironment.js` — identifies feature-dependent expressions and gives their expensive updates a separate progress budget. Constant/camera colors, fog, and light keep the existing update cadence. Source expressions, category semantics, exact endpoints, reversal, source/layer identity, and custom overlays are preserved.

Tests:

- `src/utils/mapEnvironment.test.js` — four new tests for expression classification, update budgeting, endpoint/reversal restoration, forced keyframes, and source immutability.
- `review/color-check.cjs` — settled endpoint checks use reduced motion and inspect the actual night-wall color accessor; route preservation checks inspect the authoritative route.
- `review/search-check.cjs`, `review/navigation-check.cjs`, `review/correspondence-check.cjs` — compare authoritative route paths instead of animated preview fragments or camera-dependent labels. Navigation checks the continuous renderer’s environment progress instead of requiring the removed separate Night layer ID.
- `review/environment-stage4.cjs` — waits for requested geometry/models and samples actual decreasing reversal frames. It no longer assumes rendering is complete after an arbitrary delay or compares a later reversal frame against a stale earlier sample.
- `review/performance-check.cjs` — accepts a reduced-motion override for comparable endpoint workloads.

New verification tools:

- `review/final-verification.cjs` — runs existing suites with separate artifact paths.
- `review/route-model-snapshot.cjs` — reads the authoritative path and endpoint identities supplied to Map3D.
- `review/environment-local-style.cjs` — verifies real Mapbox paint/fog/light APIs with a local style and zero style reloads during sampling.
- `review/connector-routing-check.cjs` — explicit stair and elevator route checks.
- `review/cinematic-performance.cjs`, `review/final-performance.cjs` — production hardware profiling, repeated routes, and ten-cycle resource/heap samples.
- `review/allocation-attribution.cjs` — identifies allocating contexts and call stacks.
- `review/summarize-final-verification.py` — produces `summary.json` and compares historical observations.
- `docs/stage-6-final/` — raw results, logs, screenshots, start hashes, summary, and this report. `pre-fix/` preserves the measurements taken before the allocation fix.

There were many existing uncommitted changes when this stage started. This list covers this stage only. The start-hash comparison confirms **all 51 GeoJSON files are unchanged**, and the only existing application source file changed in this stage is `mapEnvironment.js`. Room/routing geometry, lights, floor offsets, and rendering materials were not edited.

## 2. Functionality verified

### Labels

- Existing deck.gl labels retain fixed CSS-pixel typography and the perspective correction, including off-center pitched views, text backgrounds, and route-marker decorations.
- The fresh text-only and background-inclusive runs contain **154 raster samples** across zooms 17/19/21, pitches 0/45/60/65 degrees, bearings, and off-center positions. The measured room texts remain **92 px wide**; background-inclusive widths remain 101/102 px for the sampled labels. One-pixel edge-height differences are antialiasing.
- Floor-qualified authoritative identities remain distinct for duplicate names. Interior-point anchors, holes, irregular and multipart polygons, floor elevations, and F-ALL alignment are covered by the unit suites and browser fixtures.
- Label counts respect the responsive budget of at most six, route proximity and the screen corridor, active/transition floor filtering, preview windows, collision exclusions, controls, and sidebar space. No duplicate label keys or overlapping accepted CPU boxes were found by the layout assertions.
- Native wheel zoom, zoom controls, Reset View, mobile drawers, route clearing, split/timeline views, F-ALL, pause/play/seek, and sidebar changes passed. The GPU collision extension remains enabled in full-app checks; it is disabled only when isolating a label for raster measurement.

Artifacts: `labels/`, `label-backgrounds/`, `label-floors/`, `label-routes/`, `label-wheel/`.

### Cinematic environment and fixtures

- Day, golden-hour (.36), blue-hour (.7), full night, and the reverse samples passed. Actual clock progression, mid-transition reversal, preset changes at night, reduced motion, and unmount cleanup passed.
- Main building data, tessellation, position buffers, model instances, route data, selection identity, and camera were retained across the sampled material timeline. The existing shader and complementary depth-coverage strategy remain in use.
- Interior gain remains zero before the full-night endpoint and then ramps to full illumination in approximately 1.2 seconds. Delayed loading waits at ambient night without blocking camera interaction; HTTP 503 and explicit retry recover correctly.
- Architectural and GIS presets passed on F0–F7 and F-ALL. The combined lighting source contains **138 anchors**: 19/20/23/16/23/19/18/0 across F0–F7. F7 receives ambient night rendering without invented fixtures.
- Main-app tests verify shared progress/gain across route panels, unchanged paused cameras and preview progress, and continuing preview playback during sunset and light activation.
- Ten-cycle fixture checks retain light data, GPU models and atlas identity, fetch the combined source once, and dispose atlas textures on unmount. The hardware workload separately confirms one light-source request per run.

Artifacts: `environment/`, `interior/`, `interior-app/`, `interior-resources/`.

### Basemap behavior

Hosted Mapbox styles initially failed to reach fully loaded state in an earlier attempt. The final rerun loaded **Streets v12 and Outdoors v12 successfully**. It exercised 149 and 162 supported color properties, including 24 and 30 feature-dependent properties, with no paint/fog/light validation failures. Both styles retained their style object, custom source, custom paint, and camera; source colors restored exactly at daylight.

The additional local-style test recorded **zero `setStyle` calls during the timeline samples**, retained the custom source and layer, and validated paint, camera, fog, light, and daylight restoration. Test setup explicitly selects a style before taking the preservation snapshot; that setup operation is not a timeline reload.

Artifacts: `basemaps/basemaps.json`, `local-style.json`.

### Existing application

The regression suites passed **33 color/lighting scenarios, 25 search scenarios, nine vertical-correspondence scenarios and 18 navigation scenarios**. These cover all individual floors and F-ALL, original/uniform colors and highlight priority, desktop/mobile framing, search selection and duplicates, route preservation, correspondence geometry/cache/retry, and route timelines. Room Function remains explicitly unavailable for the current unclassified data; tests confirm that unavailable state rather than fabricating categories.

Two explicit F1 → F3 route tests passed: Prefer Stairs used stair transitions; Prefer Elevator used elevator transitions. Both produced valid two-panel routes. See `connectors.json`.

## 3. Tests executed and outcomes

| Check | Outcome |
| --- | --- |
| Complete Vitest suite | 247 total; 236 passed; 11 failed |
| Newly introduced unit failures versus historical report | 0 |
| New Mapbox allocation-budget tests | 4/4 passed |
| Browser suites | 14/14 completed successfully |
| Raster measurements | 154 samples passed |
| Existing application scenarios | 85 passed |
| Environment fixture | 21 recorded checks passed |
| Interior fixture | 25 recorded checks passed |
| Interior main-app integration | 6 recorded checks passed |
| Explicit connector routing | 2/2 passed |
| Hosted basemap styles | 2/2 passed in final rerun |
| Local-style preservation | passed; zero timeline reloads |
| Production benchmark | three runs before and three after the allocation fix |
| Supporting endpoint workload | three complete runs, 15 scenarios per run |
| Build | passed; existing CJS deprecation/large-bundle warnings |

The 11 unit failures are the known two missing-color enrichment expectations (seven F6 features and one F2 feature remain unmatched) and nine routing-anchor tests that request room names no longer found in the current datasets. The exact failure list and comparison are in `summary.json` and `unit-tests.json`. These were not hidden, converted into passes, or “fixed” by altering authoritative data.

## 4. Runtime and performance measurements

Current production runs: Windows, Ryzen 9 7940HS, 16 logical processors, Chrome **155.0.8059.86**, ANGLE Direct3D11 on **NVIDIA RTX 4060 Laptop GPU**, 1440×1000, DPR 1. Three runs used fresh page contexts and the same instrumented workload before/after the fix. No other browser test suite ran concurrently with the measured workloads.

Frame intervals are browser RAF observations, including idle intervals; they are not GPU timer-query measurements. Draw-call counters cover Deck and Mapbox. Instrumentation also counts blending-enabled calls, allocations/deletions, root commits, requests, and post-GC main-thread heap. It does not measure VRAM or fragment overdraw directly.

Final medians across three runs:

| Scenario | p50 ms | p95 ms | p99 ms | GL calls per drawn frame | Root commits/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| F1 sunset + wheel | 14.2 | 14.9 | 28.5 | 64.6 | 58.6 |
| F1 dawn + wheel | 14.2 | 15.3 | 28.5 | 73.2 | 67.5 |
| F-ALL sunset + wheel | 14.2 | 14.9 | 28.6 | 90.7 | 58.6 |
| F-ALL dawn + wheel | 14.3 | 15.0 | 28.6 | 102.3 | 68.0 |
| Route preview during sunset | 14.2 | 14.9 | 16.8 | 57.5 | 70.5 |
| First route plan/render window | 14.3 | 57.0 | 227.9 | 110.7 | 39.8 |
| Settled F1 night | 14.2 | 14.8 | 15.0 | 0 | 0 |

The first-route window includes rendering and a fixed settling wait; it is not a pure routing-engine latency measurement. Repeated route windows have median p95 values around 14.8–14.9 ms, but some p99 spikes remain. The root-commit figures include the complete React root and do not identify individual component render cost. The interior-only gain ramp is separately verified to avoid a broad React update loop.

### Confirmed regression and measured correction

Allocation stacks attribute the repeated uploads to **Mapbox tile paint/atlas preparation**, not recreated Deck building models or duplicate interior-light atlases. The installed Mapbox source confirms that transitions of feature-dependent properties are unsupported and changing them requires layer/tile updates.

`mapEnvironment.js` now budgets feature-dependent recoloring independently, permitting at most roughly 15 updates/s on the eight-second timeline. Actual cadence depends on rendering cadence. Uniform/camera colors, atmosphere and 3D lighting keep their existing cadence; the exact source expressions and end states are preserved. This reduces redundant uploads without changing room colors, geometry, route state, or the material timeline. Feature-dependent basemap colors can lag the continuously sampled controller by this small update budget; this is the explicit performance tradeoff.

Median creations per scenario, three matched runs:

| Scenario | Buffers before → after | Textures before → after | p95 ms before → after |
| --- | ---: | ---: | ---: |
| F1 sunset + wheel | 36,213 → 18,746 | 2,392 → 1,240 | 14.9 → 14.9 |
| F1 dawn + wheel | 36,823 → 18,637 | 2,430 → 1,230 | 14.9 → 15.3 |
| F-ALL sunset + wheel | 34,157 → 19,012 | 2,253 → 1,254 | 16.3 → 14.9 |
| F-ALL dawn + wheel | 34,233 → 18,791 | 2,259 → 1,239 | 28.4 → 15.0 |
| Preview during sunset | 14,268 → 7,293 | 1,140 → 582 | 14.8 → 14.9 |

The allocation reduction is reproducible in these counts. Frame-time differences are mixed, so this report does not claim a general frame-rate increase or a draw-call reduction. The remaining uploads are disposed normally; the fix does not eliminate all Mapbox tile rebuilding.

### Repeated switching and memory

Each final hardware run completed ten reduced-motion Day/Night cycles after warm-up. All sampled cycles retained **120 live buffers, 15 textures, 48 programs, three framebuffers, three renderbuffers and 29 vertex arrays**. Building data/model/atlas references stayed identical. Each run fetched the light source once.

Post-GC main-thread heap changed by approximately **+0.44, +0.82 and +0.67 MiB** over ten cycles. No programs/framebuffers/renderbuffers were created during those cycles. Mapbox still created and disposed 1,500 buffers, 120 textures and 360 vertex arrays across each ten-cycle workload; endpoint recoloring necessarily updates its tile paint data. Stable sampled live counts and small heap deltas do not prove long-duration leak freedom. Probe arrays and browser scheduling also affect retained heap.

## 5. Historical comparison and remaining performance concerns

The supporting workload repeats the earlier Stage 7 scenarios: initial F1, wheel/pan/rotation, F-ALL, all-floor switching, search, first/cached correspondence, both Night presets, labels, route planning and preview. It uses reduced motion to measure settled endpoints; the new feature-expression budget affects intermediate progress only. These supporting files were collected before the budget fix and retained rather than presented as a newly rerun post-fix workload.

Historical runs used Chrome 155.0.8059.85 and the same reported CPU/GPU. Their ordinary RAF cadence was around 6 ms, versus roughly 14 ms now. They also predate the cinematic renderer and newest labels. Consequently these are historical observations, not a controlled attribution of gains or regressions:

| Supporting workload p95 frame interval | Historical Stage 7 ms | Current-stage observation ms |
| --- | ---: | ---: |
| Initial F1 | 24.1 | 57.0 |
| F1 camera | 7.0 | 14.9 |
| All-eight-floor switching | 16.9 | 85.4 |
| Route-label camera | 6.2 | 14.9 |
| Animated preview | 8.5 | 14.7 |

Cold loading, floor switches, and first route rendering remain latency hotspots. Full-root transition commits and transparent F-ALL rendering remain costs. The depth handoff can require complementary draws, and blending-enabled draw counts are not equivalent to fragment-overdraw measurements. No geometry simplification, lighting removal, transparency reduction, or speculative rendering refactor was performed to improve benchmarks.

## 6. Limitations and outstanding defects

- **11 pre-existing unit failures remain.** Resolving them requires reconciling stale routing fixtures and authoritative name/color provenance, rather than inventing data. No new failing unit test was introduced.
- F7 has no supplied light anchors. Room Function classification is unavailable in the current data.
- Hardware performance is verified on one Windows/NVIDIA machine. Functional/raster checks use Chrome SwiftShader, DPR 1. Other browsers, DPRs and mobile GPU performance were not measured.
- Hosted Mapbox availability was intermittent initially; final Streets/Outdoors checks passed. Network/cache conditions remain an uncontrolled contribution to cold-load measurements.
- No GPU-only execution time, VRAM, fragment-overdraw counters, worker heap, or multi-hour soak test was collected.
- Temporary Mapbox upload churn remains, though reduced. Cold-load/first-route/floor-switch tail latency and whole-root transition update frequency remain opportunities for further profiling; no broader improvement claim is made.
- Existing build size and Vite CJS warnings remain. The sandbox account became locked during testing, requiring approved commands outside that sandbox; this is an execution-environment issue, not an application defect.

No newly confirmed functional application defect remains from these checks. The production code change is limited to the measured basemap allocation regression.

## 7. Reproduction and evidence

Serve development on `http://127.0.0.1:3004` and the built production app on `http://127.0.0.1:3005`. Set `PLAYWRIGHT_MODULE` to an installed Playwright module. Run `node review/final-verification.cjs` for the browser suites, `node review/environment-local-style.cjs`, and `node review/connector-routing-check.cjs`. Run `node review/cinematic-performance.cjs` alone for the three production runs. `node review/final-performance.cjs` also runs the supporting workload three times. Run `npx vitest run --reporter=json --outputFile=docs/stage-6-final/unit-tests.json`, `npm run build`, then `python review/summarize-final-verification.py`.

Raw evidence: `unit-tests.json`, per-suite `status.json`/logs/results, `cinematic-performance.json`, `pre-fix/cinematic-performance.json`, `allocation-attribution.json`, `workload-1.json` through `workload-3.json`, `summary.json`, `build.log`, and `start-hashes.json`.
