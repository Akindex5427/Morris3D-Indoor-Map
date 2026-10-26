# Cinematic transition stippling regression

The stippled surfaces were reproduced, isolated, and corrected. The original Day and Night endpoint images remain identical in the controlled comparisons. All 51 GeoJSON files are unchanged.

## Confirmed cause and experiment

The cause was the `EnvironmentDepthExtension` fragment shader. It generated a repeatable screen-space hash from `floor(gl_FragCoord.xy)`, compared that value to the depth-transition weight, and called `discard` for one subset of fragments. Two complementary passes used different depth-write states. Although the masks were complementary, overlapping translucent surfaces acquired different foreground/background contributions at alternating pixels. This produced the regular dotted appearance in the supplied screenshot.

The shader used `environmentDepthCoverage(surfaceNight)`, with its handoff finishing at `surfaceNight = 0.04` (golden hour, environment progress .36). Consequently the breakup was most visible near progress .20–.28, including the final portion of the reverse transition.

Before changing production shader code, the diagnostic fixture rendered the same authoritative geometry, camera, material values, and depth/blend passes with and without **only the fragment-rejection injection**. The original produced the screenshot's pattern; the rejection-disabled variant lost the pattern. That variant was an experiment, not the production correction: simply removing rejection while retaining two full per-layer draws changes compositing and opacity.

Alpha-to-coverage was disabled in the captured GL state. No positions, floor offsets, mesh coordinates, or polygon offsets changed during the experiment. The same result was observed with the room, wall, and envelope groups isolated. The evidence identifies the screen-door depth handoff as the source of this regular pattern; it does not claim that the datasets have no ordinary coincident-edge or transparency-order limitations.

Evidence: [original F-ALL at .20](before-all-0.2-original.png), [rejection-only ablation](before-all-0.2-no-rejection.png), [corrected F-ALL at .20](after-all-0.2-fixed.png), [ablation state](ablation.json), and the `dpr2-*-original.png` / `dpr2-*-fixed.png` images.

## Correction

`EnvironmentDepthExtension` now sets depth/blend state only. It contains no fragment shader injection, screen-coordinate hashing, dithering threshold, alpha hashing, or per-layer second draw.

During the existing early handoff, `EnvironmentDepthEffect` renders two **complete, smooth scene images** using the same layers, models, geometry, lighting state, camera, colors, and uniforms:

1. The existing daytime depth-write behavior.
2. The existing nighttime depth-write/blend behavior.

The effect interpolates the resulting stored RGBA images with the original smooth transition weight. Its resolve shader copies the interpolated result with blending disabled, so alpha is not applied a second time. This preserves intentional translucency and avoids forcing surfaces opaque. The images are transparent building renders; the basemap remains underneath, and there is no black theme overlay.

The two scenes use separate depth targets rather than mixing different depth policies on a pixel grid in one target. No duplicate Layer objects, building meshes, or floor geometry are created. Existing lighting shaders and source-material interpolation remain unchanged.

At both endpoints, and after the early handoff, postprocessing is bypassed. Deck renders through its ordinary framebuffer, retaining the original endpoint alpha/depth states and antialiasing. Geometry models and shaders stay stable throughout the timeline. Picking retains the original solid depth-tested behavior and does not use the scene resolve.

The effect uses Deck's existing two cached postprocess targets and one cached fullscreen resolve model. They are allocated on the first handoff, resized only with the viewport, and reused. No new animation clock or React state loop was introduced. Each Map3D instance owns its effect, so existing multi-floor route panels share the environment timeline while keeping their own cameras and GPU contexts.

## Appearance and functional verification

- **36 exact endpoint raster comparisons passed:** F0–F7 and F-ALL × Architectural/GIS × Day/Night. Corrected PNG data matched the pre-fix renderer exactly.
- **111 controlled rendering checks passed:** endpoint comparisons; forward and reverse samples including 0/.20/.40/.60/.80/1; extra samples .10/.28/.32/.36 in and around the handoff; both presets; F1/F-ALL; different zooms, bearings, and pitches. Building data, models and lighting-atlas identities remained stable through the transition sequences.
- **22 additional checks passed** at DPR 2, including separate room/wall/envelope renders, endpoint approach, repeated direction changes, and resource cleanup. The compositing model and both framebuffer/color/depth target sets were disposed on unmount.
- The earlier screenshot series also shows zero pixel differences at progress .40/.60/.80 for F1 and F-ALL, in addition to exact 0/1 endpoints. Only the defective early handoff changes its rendering method.
- Existing main-app route/lighting integration passed all six recorded cases: shared timeline/gain across route panels, paused camera/progress preservation, continuing route playback, activation-ramp resource reuse, and F-ALL camera preservation.
- Existing floor-label fixtures and the 21-case environment fixture passed. These include floor/preset behavior, the actual reversible clock, reduced motion, unmounting, and stable shader/geometry resources.

The screenshots were actually rendered and inspected in Chrome. The corrected facade is visually continuous while interior floors remain visible through its intentional transparency. The isolated rejection experiment also confirms that low opacity alone is not the cause.

## Performance and resource cost

The controlled benchmark uses the same data and a camera path at environment progress .20, with three runs, alternating variant order, and a camera warm-up before each measurement. It isolates Deck rendering from basemap/network work. The measured renderer was **ANGLE Direct3D11 on AMD Radeon 780M**, Chrome 155.0.8059.86, 1228×920, DPR 1.

| View | Original median p95 frame interval | Corrected median p95 | GL calls over 120 sampled RAF ticks, original → corrected |
| --- | ---: | ---: | ---: |
| F1 | 6.2 ms | 6.2 ms | 1,180 → 1,298 |
| F-ALL | 54.9 ms | 12.1 ms | 5,900 → 6,018 |

The added calls correspond to one resolve quad per drawn handoff frame. Two complete scene evaluations are limited to the same early transition window in which the previous implementation already performed complementary per-layer draws. Later phases and both endpoints use one ordinary scene render.

No buffers, textures, programs, or framebuffers were allocated during any of the 12 warmed camera measurement windows. Five forward/reverse cycles per run also reused the initialized targets/programs without new texture, framebuffer, or program creation.

The first F1 handoff adds **two color textures, two depth buffers, two framebuffers, one resolve program, and three quad buffers** in this fixture. They remain cached until unmount. Their memory scales with physical viewport dimensions and the number of map contexts; DPR 2 increases target pixel area fourfold. The disposal test verifies that the owned target handles and resolve model are released.

The F-ALL result is a measurement of this controlled scene, not a general application FPS promise. Fragment rejection, target rasterization, and MSAA behavior differ between the paths. Normal endpoint rendering retains the original MSAA. Intermediate offscreen textures use Deck's standard postprocess targets, so geometric silhouette-edge antialiasing can differ by a pixel from direct MSAA rendering. No lower-resolution targets, mesh simplification, geometry shifts, or forced opacity were used to improve the results.

## Tests and build

- Focused depth/compositing/environment/lighting tests: **28 passed, zero failed**.
- Full available unit suite: **249 total, 238 passed, 11 failed**. The failures are the same previously documented nine stale routing-room-name tests and two missing-color enrichment expectations. They are unrelated to this correction; no source data was fabricated to satisfy them.
- Production build: passed. Existing Vite CJS deprecation and large-bundle warnings remain.
- The data-integrity check confirms **51 unchanged GeoJSON hashes**, covering room polygons, routing centerlines and interior lights.

Raw artifacts: `verification.json`, `additional.json`, `integration/status.json`, `performance.json`, `focused-tests.json`, `unit-tests.json`, `build.log`, `endpoint-comparison.json`, `integrity.json`, and screenshots in this directory.

## Files changed

Production:

- `src/layers/environmentDepthExtension.js` — removes stippled fragment rejection and per-layer duplicate draw; applies explicit complete-scene depth states.
- `src/layers/environmentDepthEffect.js` — new narrowly scoped, cached RGBA resolve using existing deck.gl/luma.gl facilities.
- `src/components/Map3D.jsx` — owns and supplies the stable effect to Deck.

Verification:

- `src/layers/environmentDepthExtension.test.js` — replaces expectations for the old dithered strategy with complete-surface/depth/picking/resource assertions.
- `src/layers/environmentDepthEffect.test.js` — verifies endpoint bypass, target/model reuse, reversal and cleanup.
- `review/stipple-review.html`, `review/stipple-review.jsx` — development-only production-geometry fixture.
- `review/stipple-baseline-depth.js` — frozen pre-fix extension for reproducible diagnostic comparisons; not imported by the application.
- `review/stipple-ablation.cjs`, `review/stipple-fixed.cjs`, `review/stipple-verify.cjs`, `review/stipple-additional.cjs`, `review/stipple-performance.cjs`, `review/stipple-integration.cjs` — browser diagnostics, comparisons and integration runs.
- `docs/stipple-regression/` — engineering report and measured artifacts.

Only Map3D and the depth extension changed among existing application source files. The new effect is the only new production source file. GeoJSON colors, room geometry, stacking, routing, label identities, preset parameters, basemap adapter, fixture positions, bloom/glow settings and the eight-second controller were preserved.

## Remaining limits and reproduction

This corrects the repetitive screen-door breakup. Existing layer-order transparency limitations are preserved; this is not an order-independent-transparency rewrite. Shader-specific silhouette-edge antialiasing during the offscreen handoff and GPU memory requirements are noted above. Hardware beyond the recorded AMD renderer, browsers beyond Chrome, and long-duration soak behavior were not comprehensively tested. The `_LayersPass` export and postprocess lifecycle are verified against the installed deck.gl 8.9 version and should be rechecked on a major renderer upgrade.

With the Vite server on port 3004 and Playwright installed, set `PLAYWRIGHT_MODULE` and run the `review/stipple-*.cjs` scripts. `stipple-ablation.cjs` uses the frozen old implementation; `stipple-fixed.cjs` captures the corrected path. `stipple-verify.cjs` performs the endpoint/transition comparisons. Run the performance script alone to avoid concurrent browser workloads. Test pages and the frozen shader are not imported by the production entry point, and no debugging overlays are enabled in the app.
