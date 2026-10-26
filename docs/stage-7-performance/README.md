# Stage 7 — Performance optimization

The implementation preserves room coordinates, floor offsets, room colors, lighting parameters, routing data, and the existing controls. No geometries were simplified and no effects or labels were removed.

## Results

Medians from three complete hardware runs per variant:

| Scenario | p95 frame interval before → after | Workload duration before → after |
|---|---:|---:|
| F1 zoom/pan/rotation | 18.3 → 7.0 ms | 2.25 → 1.88 s |
| F-ALL camera | 12.2 → 9.8 ms | 1.97 → 1.96 s |
| Route labels during camera movement | 18.2 → 6.2 ms | 1.91 → 1.78 s |
| Animated route preview | 18.3 → 8.5 ms | 4.02 → 4.01 s |

The preview uses a fixed 4-second observation window. Its median drawn-frame rate increased from 84.6 to 153.2 frames/s, with approximately 22 GL calls per drawn frame in both builds. This is the observed headless desktop workload, not a guarantee for other devices or refresh rates.

Other findings:

- Initial F1 scenario: **6.65 → 5.82 s**, including the fixed settling wait. Eight-floor switching: **2.72 → 2.43 s**. Their p95 intervals did not improve (17.1 → 24.1 ms and 12.0 → 16.9 ms respectively); shorter overall workloads do not imply every frame became smoother.
- First Above & Below action: **0.85 → 0.57 s**; cached action: **0.17 → 0.05 s**. These include UI processing. The spatial-analysis algorithm itself was not changed.
- Search was effectively unchanged at about **0.11 s** for the four-query sequence. F-ALL's first loading scenario was also approximately unchanged: **2.43 → 2.48 s**.
- Cold Architectural Night activation was **slower**, **2.31 → 2.63 s** in these samples. Architectural camera interaction was **1.79 → 1.76 s**, and GIS camera interaction **1.85 → 1.80 s**. The final Night shader is unchanged; this work does not claim a universal lighting speedup.
- Route-plan script time decreased **1,690 → 844 ms**, while end-to-end duration changed only **2.74 → 2.67 s** because it includes a fixed settling wait and rendering.

### Allocations, draw calls and memory

| Workload | Wall mesh replacements before → after | Buffer traffic before → after |
|---|---:|---:|
| F1 camera | 40 → 0 | 14.16 → 6.95 MiB |
| Route-label camera | 96 → 0 | 18.74 → 0.67 MiB |
| Animated preview | 339 → 0 | 92.23 → 66.26 MiB |

Total draw calls are not uniformly lower: the faster renderer draws more frames, and asynchronous Mapbox tiles affect the totals. For example, preview GL calls increase from 7,458 to 13,508 while calls per drawn frame stay approximately constant. No draw-call reduction is claimed for transparent F-ALL overdraw.

Wall requests drop **21 → 17** per complete workload; `/wall.geojson` drops **5 → 1**. GeoJSON body/JSON completion calls drop **50 → 46**. Room-source request counts remain 14; room and combined-export loading paths were not universally replaced. Individual fetch and JSON completion timings are in the raw reports; their overlapping durations must not be summed as elapsed loading time.

At each settled post-switch sample (cycles 1–3), both variants return to **104 live GL buffers, 14 textures and 53 programs**, across all three runs. The immediate pre-cycle sample contains additional transient basemap resources. The final post-GC main-thread heap median is **57.22 → 58.60 MiB**: caching costs about **1.38 MiB** in this workload, rather than reducing retained heap. The final cycle adds a median **0.41 MiB before / 0.25 MiB after**. This short test shows stable sampled GL counts and slowing heap growth; it does not prove absence of long-term leaks.

## Changes and measured bottlenecks

1. **Camera movement rebuilt floor-wall meshes.** `useBuildingWallLayers` used a new default `floorBaseOffsets = {}` object on every render, invalidating its mesh memo. The initial software-rendering baseline replaced wall meshes 26–28 times per F1 interaction run. Stable defaults now retain the layer inputs, and `getCachedWallMeshes` weakly caches the immutable CPU meshes by dataset identity. A replacement dataset creates new meshes; GL resources remain owned by deck.gl.
2. **Walls were fetched and parsed repeatedly.** The baseline workload requested `/wall.geojson` five times per run. The three wall hooks now share a bounded cache of parsed responses and in-flight promises. Failed requests are removed for retry. A cancelled subscriber cannot cancel another map's shared request. The cache holds at most 32 sources; the current wall configuration uses 17.
3. **Reveal and route presentation changes regenerated geometry.** Perimeter and stacked walls now animate existing meshes with Z scale and translation about each wall's original base. This retains the existing reveal timing, opacity and floor offsets. Route-focus changes no longer invalidate the room coordinate transform, because that transform depends on floor spacing and reveal progress, not route focus. Highlighting still uses the full presentation state.
4. **Camera updates recreated selection callbacks and lighting effects.** A stable pick callback reads the latest application handler; the applied lighting effect is memoized by single-floor/stacked mode. Two unconditional per-render console logs were removed. These changes avoid unrelated work while preserving current selection behavior.
5. **Procedural shell caching was unbounded across thickness changes.** Its LRU now holds at most 4,096 shell geometries. Coordinate-key strings are weakly cached by immutable geometry. Eviction affects recomputation, not precision or rendering output.

The original Night shader and atlas implementation are retained. A trial moved constant color decoding to the CPU, but hardware profiling found 69 extra texture creations during one preset transition without a clear timing benefit. That trial was removed before the final measurements. The accepted optimization improves shared scene handling without changing the Night lighting formula.

## Existing efficient paths retained

- The room catalog already shares asynchronous loads for F0–F7. Search was measured without replacing its authoritative index or changing matching semantics.
- Above & Below already uses a lazy worker, prepared floor geometry, bounding-box candidate filtering and a bounded result cache. Ordinary camera navigation does not trigger analysis.
- Light anchors already render in three instanced layers (pools, halos, fixtures). The 138 anchors retain their positions, elevations, radii and colors.
- Existing dynamic text consists of route focus, landmark and connector labels. It uses pixel sizes and a shared `CollisionFilterExtension`; the benchmark exercises these labels during camera movement and preview. No new global room-label system was added.
- Independent route timeline maps retain their own GL contexts and cameras. They now share wall fetches, parsed data and CPU meshes, while GPU resources remain scoped to each context.
- Transparent room/wall surfaces and the Night envelope retain their depth/blending settings. Their overdraw remains a cost, particularly in F-ALL. Transparency was not reduced to improve the numbers.

## Measurement method

The repeatable harness is [`review/performance-check.cjs`](../../review/performance-check.cjs), orchestrated by [`review/matched-performance.cjs`](../../review/matched-performance.cjs). It uses production builds, a 1440 × 1000 viewport, device scale factor 1, and headless Chrome 155.0.8059.85 on Windows. The machine reports an AMD Ryzen 9 7940HS and 16 logical processors, with 15.21 GiB RAM. The matched comparison uses **ANGLE Direct3D11 on the NVIDIA GeForce RTX 4060 Laptop GPU**, verified from the WebGL renderer string.

There are three complete runs per variant, with a fresh Chrome process for each workload. Original and shader-trial runs initially alternated; after rejecting the shader trial, all three optimized runs were repeated against the final build. The unchanged original measurements are retained. The original build is served on port 3003 and the optimized build on 3002. An isolated reconstruction of the pre-optimization source produced the exact original main bundle SHA-256 (`86d9859d298c5d13a14cefcd141b152de6d36b19b068b698ef53e093ab3de47d`). See [build-provenance.json](build-provenance.json). The isolated copy does not modify the working application.

Each run starts with a fresh browser context, then executes the same sequence: initial F1; wheel zoom, pan and rotation; F-ALL load and camera interaction; all eight individual floors; four search queries; first and cached vertical analysis; both Night presets; route planning; route labels during camera movement; animated route preview; and three repeated F1 → F-ALL → Architectural → GIS → F1 cycles.

The probes record browser animation-frame intervals, actual frames containing GL draw calls, GL calls, buffer upload counts/bytes, mesh identity replacements, live GL resource counts, main-thread task/script time, long tasks, GeoJSON fetch/JSON completion times, and post-GC JavaScript heap samples. Worker analysis reports its own preparation/query timing. Neither application's source data nor rendering configuration is changed by the probe.

Interpretation:

- The initial scenario includes a fixed 3-second settling wait after the first valid camera; it is not a pure time-to-first-pixel measurement.
- Action scenarios include specified settling waits. Their duration reflects completing the same interaction sequence, rather than a fixed-duration FPS stress test.
- RAF frequency is not rendering FPS. `drawnFPS` counts only RAF intervals with a GL draw. The frame percentiles include idle intervals within each scenario; short search windows can contain no frames and report zero percentiles.
- Draw-call and live-resource totals include Deck and the Mapbox basemap; separate Deck draw-call counts are also retained. Basemap tile/style completion can change resource totals between samples. Upload bytes measure submitted buffer traffic, not VRAM occupancy.
- `Response.json()` timing includes waiting for the body and decoding/parsing; it does not isolate synchronous JSON parsing. External basemap requests and ordinary host scheduling are not fully controlled.
- Post-GC heap readings cover the main renderer, not worker heaps or GPU memory. Three switching cycles per run can reveal short-run growth but do not establish long-duration leak freedom.
- Hardware GPU rendering is exercised, but GPU-only execution time, fragment overdraw counters, and VRAM usage are not measured. Frame intervals are end-to-end browser observations, not GPU timer-query results. No mobile-FPS claim is made.

Raw timing data and ranges are retained alongside the report. See [measurements.md](measurements.md) for the median table, [summary.json](summary.json) for medians/ranges and resource summaries, and [before.json](before.json) / [after.json](after.json) for the matched hardware observations. Both hardware variants use the same 60-second action timeout and workload.

Earlier SwiftShader software measurements are retained separately: [before-software.json](before-software.json), [after-interrupted.json](after-interrupted.json), and [after-software-timeout.json](after-software-timeout.json). Two optimized attempts timed out during Playwright's scroll-into-view action (animation checkbox and F-ALL button), with no reported JavaScript error. Their cause was not established. They are **not** included in the matched hardware aggregates and do not establish reliable optimized software-renderer performance.

## Correctness checks

The full application unit suite has **164 passing / 11 failing / 175 total**, including all five new tests passing. Results and the unchanged Stage 6 failures are recorded in [test-summary.json](test-summary.json) and [unit-results.json]. The pre-existing failures are two source-color assertions and nine routing-anchor tests with dataset/name mismatches.

**85 functional browser scenarios pass**: 33 color/lighting, nine correspondence, 25 search and 18 camera/navigation checks. These cover F0–F7, F-ALL, both Night presets, original/uniform colors, selected room and route colors, route timelines, worker cache/retry, duplicate and delayed search results, desktop/mobile framing, wheel/slider/pinch synchronization, and route-preserving Reset View. The camera checks confirm 85% building occupancy after fitting. See [regression-results.json](regression-results.json) and the four scenario folders. These functional suites use SwiftShader; their successful results do not erase the separate instrumented benchmark timeouts.

Two older harness assumptions were corrected: camera tests require Vite module access and the current room-search selector; the search audit now reads the catalog passed to the mounted component rather than potentially importing a second HMR store instance. These are test changes, not changes to application search behavior.

Five new tests cover shared request/parse reuse, failed-load retry, bounded source caching, mesh reuse and dataset invalidation, and reveal vertex equivalence. Existing tests cover routing, room search, camera fitting, color modes, lighting, multipart geometry, overlap analysis and floor stacking.

Fixed-camera comparisons cover F1 and F-ALL in Day, Architectural Night and GIS Night. All room geometry/property/color hashes match, and **all six final isolated Deck canvas images are pixel-identical**. Basemap tiles are excluded from this pixel comparison. See [visual-comparison.json](visual-comparison.json) and the `visual-before` / `visual-after` folders. Color/lighting and image checks were rerun after dropping the shader trial.

All **51 GeoJSON file hashes** in the Stage 6 source snapshot remain unchanged. This includes room polygons, routing centerlines and light sources. The production build passes; the existing Vite CJS and large-chunk warnings remain. The correspondence worker bundle remains 272.44 kB; the main application bundle is approximately 1,265.32 kB before compression.

## Files changed in this stage

Application:

- `src/components/Map3D.jsx`, `src/components/IndoorBuilding.jsx`: stable selection/lighting and narrower geometry dependencies.
- `src/layers/buildingWallLayer.js`, `src/layers/perimeterWallLayer.js`, `src/layers/stackedWallLayer.js`: shared loads and mesh reuse; GPU wall reveal.
- `src/utils/wallGeometry.js`, new `src/utils/wallDataCache.js`, `src/utils/roomWallGeometry.js`: reusable meshes, bounded loading and shell caches.

Verification:

- New `src/utils/wallDataCache.test.js`.
- New `review/performance-check.cjs`, `review/matched-performance.cjs`, `review/performance-visual-check.cjs`, `review/compare-performance-images.py`, `review/summarize-performance.cjs`, `review/stage7-regression.cjs`.
- `review/color-check.cjs` and `review/correspondence-check.cjs` accept output/server overrides so Stage 7 evidence can be kept separately.
- `review/navigation-check.cjs` and `review/search-check.cjs` use current UI selectors and the live search catalog.
- `docs/stage-7-performance/` contains the measurements, unit results, image comparison and browser regression artifacts.

## Reproduction

Build with `npm run build` and serve with `npm run preview -- --host 127.0.0.1 --port 3002 --strictPort`. Serve the original production build on port 3003. Set `PLAYWRIGHT_MODULE` to an installed Playwright module and run `node review/matched-performance.cjs` for the alternating hardware comparison. For individual workloads, run `node review/performance-check.cjs`, with `PERF_OUTPUT`, `PERF_URL`, `PERF_REPEATS`, and `PERF_ANGLE=d3d11` as needed. The standalone harness defaults to SwiftShader unless the renderer is explicitly selected. Baseline and optimized runs must use their respective builds.

Run `node review/performance-visual-check.cjs` against each build with distinct `PERF_VISUAL_OUTPUT` folders, then `python review/compare-performance-images.py` (Pillow required). Run `node review/summarize-performance.cjs` after complete before/after timing files exist. Run `node review/stage7-regression.cjs` with the production preview on 3002 and the existing development server on 3001; the camera and search harnesses need Vite module access. Run unit tests with `npm run test -- --run`.
