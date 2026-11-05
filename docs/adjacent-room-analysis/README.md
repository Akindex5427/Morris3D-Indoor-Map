# Immediate-floor room analysis, overlap bars, and narration

Implemented October 26, 2026. Rooms Above & Below now compares only the immediately preceding and succeeding configured floors. All positive-area matches on those floors remain available. The panel adds fixed-scale percentage bars and a concise, user-initiated spoken/text summary.

## Shared analysis and geometry

`adjacentRoomFloors` reads the ordered authoritative `ROOM_FLOORS` configuration in `roomCatalog.js`. It selects neighboring entries, not `floor +/- 1` arithmetic or the nearest successfully loaded dataset. Tests include nonconsecutive IDs. F0 produces only F1; F7 only F6. A missing adjacent dataset stays explicitly unavailable instead of being skipped or interpreted as zero overlap.

The existing worker and polygon engine are retained: a shared local Lambert azimuthal equal-area projection in meters, JSTS topology validation/area calculation, polyclip-ts intersections, multipart/hole support, and bounding-box filtering with a per-floor min-X index. Areas at or below **0.000001 m²** are numerical dust; a synthetic 0.000004 m² overlap remains included. Boundary-only contacts are excluded. No geometry is repaired, simplified, or inferred.

The versioned result includes `scope: "immediate-floors"`, reference identity/name/floor/area, adjacent floor IDs, per-floor availability and data-quality counts, all matched identities, intersection areas, reference/candidate percentages, units, and the numerical tolerance. The graphics, deterministic summary, and narration consume this same result; presentation never recalculates intersections.

**Displayed overlap = 100 × intersection area / reference footprint area.** Candidate-relative percentages remain available in the engine output but are not substituted in the UI. Independent polygon percentages are never summed as coverage.

Actual browser result for the first authoritative **Group Study 0420D** search result, source `OBJECTID 69`, F4:

| Reference / intersecting feature | Floor | Area | Reference overlap |
| --- | --- | ---: | ---: |
| Reference footprint | F4 | 37.55 m² | — |
| Floor | F5 | 37.55 m² | 100.0% |
| Lc Folios A To Z | F5 | 22.98 m² | 61.2% |
| Imc Books | F3 | 31.52 m² | 83.9% |

Other features share the reference name. They retain distinct catalog identities and their own geometries; these figures are not hard-coded or generalized to every feature named Group Study 0420D.

## Presentation and interaction

- The reference header shows its original label, floor, metric footprint area, and existing indigo indicator.
- Immediately Above/Below sections exist only for configured neighbors. All results remain sorted by descending intersection area, with stable identity tie-breaking. Generic/background labels are not removed or assigned invented functions.
- Lightweight CSS bars use `width: referencePercent%` on an invariant 0–100% scale. Teal/indigo distinguish directions; explicit headings, numeric percentages, areas, and screen-reader text also convey the meaning. There are no chart dependencies or bar animations.
- Specific names receive modest typographic emphasis. Source spelling is retained. Duplicate labels remain separate selectable buttons with stable feature keys.
- Selecting a new room while analysis is open replaces the reference, clears the old results/highlight candidate, and stops old narration. Worker request IDs reject late responses. Inspecting a result intentionally retains the pinned reference and existing paired F-ALL behavior; changing the inspected candidate also stops playback.
- Reference/result navigation, highlights, and Inspect pair in F-ALL retain the existing camera behavior. Closing the panel cancels narration. Mobile opening/recalculation accounts for the actual sticky drawer header/tab dimensions and padding, without moving the map camera.
- Missing floor data, incomplete/invalid footprints, analysis failure, and a valid empty overlap have separate messages. The latter reads “No overlapping features found on the immediately adjacent floor.”

## Summary and speech

`summarizeRoomAnalysis` generates one object with sentences, text, reference key, and selected finding identities. The identical `summary.text` is both displayed under **Read analysis summary** and passed to speech synthesis.

It generally mentions one finding per available adjacent side. Verified classification provenance and an optional explicit `analysisRole` can influence ranking; the current data supplies no verified classifications. Otherwise, specific source names are preferred over exact generic labels such as Floor and Structure, then ranked by intersection area and stable key. This is a narration preference only, not a claim that a feature is occupiable, structural, or load-bearing. Generic-only results are described as features bearing their supplied labels. Missing names use existing source-identifier labels.

Percentages are rounded for speech, with “less than 1 percent” for small positive values. The summary includes unavailable/incomplete analysis where applicable and excludes unsupported access, structural, or building-system claims. The tested F4 summary contains 76 words, approximately 30–35 seconds at common speech rates; actual duration and longer source names vary by voice.

`createAnalysisSpeech` uses the browser [SpeechSynthesis API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis), reacts to [voice availability changes](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices), and handles [playback errors](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/error_event). Controls provide Listen, Pause/Resume where the API is present, Stop, and Replay. Speech never starts automatically. The default rate is 0.98.

Only voices reporting `localService: true` and an English language are eligible. The device's default eligible voice is preferred, otherwise the first eligible local voice. No operating-system voice name is required and no remote voice, LLM, or external summarization endpoint is used. Unsupported APIs or absent local voices show an explanation and preserve the text summary. A startup watchdog reports engines that fail to begin within eight seconds.

A single active-player owner prevents queued/overlapping analysis narration. Stop, reference changes, candidate changes, and unmount invalidate callbacks before cancellation. Voices-changed listeners and startup timers are removed on disposal. React updates occur for playback lifecycle events, not audio frames.

## Performance and preservation

Prepared metric geometry, the spatial index, and the existing bounded 100-reference result cache remain in the worker. Intersections are performed only for plausible candidates on the adjacent floors. Initial preparation may still prepare all already-cached datasets so they share a consistent projection; it does not intersect all floors.

The hook requests only the reference and adjacent sources when needed and reuses the catalog's parsed datasets/in-flight requests. Unrelated catalog publications and camera, color, theme, or route-preview updates do not submit another analysis. Replacement source versions rebuild the index; invalid replacement data cannot silently fall back to an older index. Worker cleanup resets the terminated instance, including during development reloads.

Observed worker intersection times in the final browser run were approximately **42.1 ms (F0), 17.7 ms (F1), 9.3 ms (F4), and 4.7 ms (F7)**; exact timings are in `browser-results.json`. These are individual sampled analysis durations, not a repeated performance benchmark or an FPS improvement claim. The browser test verifies no additional worker requests during camera movement, both Night presets, and room-color changes. CSS bars and summary generation add no map layers, GPU geometry, textures, or render loop.

All **51 GeoJSON files** match the task-start hashes. Routing graphs, room coordinates, light positions, stack offsets, lighting shaders, and environmental controllers are unchanged.

## Verification

- **11 end-to-end Chrome scenarios passed**, with zero page errors: F0/F1/F4/F7 adjacency and all bar values; shared text/speech; rapid reference changes; pair navigation/F-ALL camera preservation; both Night presets and color modes without reanalysis; unsupported/missing voices and close cleanup; F-ALL source resolution; mobile width/header visibility; missing F7 data/retry from F6; route preservation.
- Every measured bar matched the computed percentage within browser CSS serialization precision and **one CSS pixel**. The unit tests also verify literal 61.2% and 20% widths rather than relative-to-largest normalization.
- Existing browser regression suites passed: **6 route/lighting integration cases, 13 floor-label fixture cases, and 21 cinematic environment cases**. These cover all floor views, both presets, route preview, resource identity, camera preservation, reduced motion, and reversal.
- **266 unit tests: 255 passed, 11 failed.** The failures are the same nine stale routing-name expectations and two existing color-enrichment expectations recorded before this task. No new failing tests. The 29 analysis/panel/summary/speech/worker tests pass, including holes, concavity, multipart geometry, duplicate names, tiny overlaps, no overlap, invalid topology, missing sources, configured nonconsecutive floors, cancellation, missing voices, playback error/timeout, and invalid-index replacement.
- Production build passed. Existing Vite CJS deprecation and bundle-size warnings remain.
- Native Chrome exposed three local English device voices. A real click on Listen produced a native start event; Pause and Resume emitted their native events; Stop cleared speaking/pending state. The recorded `interrupted` event is the expected consequence of explicit Stop. Acoustic quality was not assessed by listening. Controlled speech tests separately verify deterministic cancellation, missing/unsupported engines, and errors.
- Desktop Day/Night and mobile screenshots were rendered and visually inspected. The mobile inspection identified and corrected sticky navigation covering the reference header. Earlier failed-attempt screenshots are diagnostic artifacts, not the accepted final UI.

Evidence: [browser results](browser-results.json), [final checks](checks.json), [unit report](unit-tests.json), [native speech](native-speech.json), [regression status](integration/status.json), [data integrity](integrity.json), [Day screenshot](day-desktop.png), [Night screenshot](night-desktop.png), [mobile screenshot](mobile.png).

## Files

Production modified:

- `src/utils/roomCatalog.js` — authoritative adjacent-floor helper.
- `src/utils/roomCorrespondence.js` — adjacent-only intersections and structured result metadata.
- `src/hooks/useRoomCorrespondence.js` — relevant-source tracking, request invalidation, retry and worker lifecycle.
- `src/workers/roomCorrespondence.worker.js` — invalid replacement-index handling.
- `src/components/RoomCorrespondencePanel.jsx` — reference area, adjacent groups, bars, summary integration, accessible empty/error states and mobile positioning.
- `src/App.jsx`, `src/App.css` — reference-change integration and responsive panel styling.

Production added:

- `src/utils/roomAnalysisSummary.js` — deterministic presentation-only summarizer.
- `src/utils/analysisSpeech.js` — local-voice playback lifecycle controller.
- `src/components/RoomAnalysisNarration.jsx` — accessible controls and optional shared text summary.

Tests modified/added: `src/utils/roomCorrespondence.test.js`, `src/components/RoomCorrespondencePanel.test.jsx`, `src/utils/roomAnalysisSummary.test.js`, `src/utils/analysisSpeech.test.js`, and `src/workers/roomCorrespondence.worker.test.js`.

Browser/check harnesses: `review/adjacent-room-analysis.cjs`, `review/adjacent-native-speech.cjs`, `review/adjacent-analysis-checks.cjs`. Reports and captured evidence live in this directory. Historical correspondence reports describe the prior all-floor scope; this report supersedes that scope.

## Reproduction and remaining limitations

Start Vite on `http://127.0.0.1:3004`, then run `node review/adjacent-room-analysis.cjs` and `node review/adjacent-native-speech.cjs`. Set `PLAYWRIGHT_MODULE` if Playwright is installed outside the repository. `node review/adjacent-analysis-checks.cjs` records the full unit suite/build and compares failures to the saved baseline.

No verified occupancy or structural taxonomy has been supplied; the analysis remains polygon-footprint correspondence, not connectivity or engineering inference. English local speech availability and pause/resume reliability vary by browser/device. Text remains available everywhere. Native speech and visuals were tested in Windows Chrome, not Safari, Firefox, or physical mobile hardware. Physical mobile acoustics and assistive-technology usability require device-specific testing. No new application defect remains confirmed by the completed checks; the 11 prior unit failures remain outstanding.
