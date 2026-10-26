# Stage 3 — Comprehensive room search

Scope: search coverage, source identity, asynchronous loading, and selection/focus across F0–F7. Individual room GeoJSON exports are authoritative for search; the existing combined export remains authoritative for F-ALL rendering.

Selection presentation revised again at the user's request: the on-feature name label has been removed and a fixed-size, name-only room-details panel restored. It appears below desktop search or as a compact card on mobile/collapsed layouts. The overhead selection animation is retained. The panel has no Stack, Height, Base height, Area, identifier, or other attribute rows, and its size is independent of camera zoom.

## Diagnosis

The previous `SearchBar` received `allRooms`, which contained only the currently displayed export. It cached suggestions when typing and truncated them to eight. It did not recompute suggestions when additional data arrived. The routing planner already loaded all eight individual files through a separate path, but general search did not use them.

Selection used a name-first identifier, so repeated names could resolve to the first matching feature or highlight multiple polygons. Enter applied the truncated suggestions as display filters instead of selecting a result. Floor loading unmounted the viewer and lacked stale-response cancellation; camera focus checked the selected floor but did not verify that the requested polygon was available.

## Implementation

- A shared catalog loads all eight configured sources, deduplicates concurrent fetches, and publishes a new search snapshot whenever a source completes or reloads. Single-floor display and routing reuse these source promises. Search does not substitute the differing combined export for a failed floor.
- Entries retain original names and identifiers, floor, source path, source row, and source feature. Internal keys include the source, floor and export identifier; a row suffix disambiguates missing/repeated source IDs. Internal keys are not presented as invented room identifiers.
- Search covers `name`, `roomname`, `room_id`, `id`, `number`, `OBJECTID`, `FID`, `FID_`, and GeoJSON feature IDs where present. Matching normalizes case, whitespace, accents and punctuation, supports partial matches and compact room numbers, and ranks exact matches first. It does not correct source spelling or apply room-specific aliases.
- All matching features remain available in a scrollable list. Results show their floor and a source identifier. Keyboard navigation, Enter selection, Escape dismissal, result counts, loading progress, explicit failed-floor status and Retry are supported. Results update if loading completes while a query is already entered.
- Selecting a result clears display filters, switches to its individual floor, and highlights only its source key. The camera waits for initialized Deck state and the exact loaded polygon, then flies to a north-up overhead view (pitch/bearing zero) in 1.2 seconds, matching the route camera's transition duration. It fits the selected polygon with control padding and a zoom ceiling of 21. Reduced-motion preference disables the animation. Search does not move or scale geometry; the rest of the floor may extend outside the close view, and Fit Building restores the overview.
- Subsequent floor loads keep the UI mounted and discard stale responses. Manual camera actions cancel pending search focus. Clear Search clears selection and details. Fit Building continues to use the Stage 2 behavior.
- A name-only room-details panel displays the original room name (or `Name unavailable` for an unnamed feature), with a close button that clears the selection. Its text is announced through an accessible live region. There is no selected-feature TextLayer. Source identifiers remain available in search results. Existing route and landmark label behavior remains separate from selection presentation.
- The outer map layout clips without scrolling, so focus in a closing mobile drawer cannot scroll the map out of view. The sidebar and search results retain their own scrolling.
- Route IDs and anchor resolution remain unchanged. Search can inspect an individual floor while a multi-floor timeline is open, retaining the route. The Timeline view action restores the combined-floor view.

## Data coverage

These are **source feature counts**, not counts of distinct occupiable rooms. The exports also include structural polygons, stair components and floor surfaces. No semantic feature category was silently removed or inferred.

| Floor | Source file in `public/` | Total features | Searchable | Identifier only | Excluded |
| --- | --- | ---: | ---: | ---: | ---: |
| F0 | `rooms-basement-WGS.geojson` | 148 | 148 | 0 | 0 |
| F1 | `rooms-level-01-WGS.geojson` | 355 | 355 | 7 | 0 |
| F2 | `rooms-level-02-WGS.geojson` | 243 | 243 | 0 | 0 |
| F3 | `rooms-level-03-WGS.geojson` | 288 | 288 | 2 | 0 |
| F4 | `rooms-level-04-WGS.geojson` | 199 | 199 | 0 | 0 |
| F5 | `rooms-level-5-WGS.geojson` | 149 | 149 | 0 | 0 |
| F6 | `rooms-level-6-WGS.geojson` | 138 | 138 | 0 | 0 |
| F7 | `rooms-level-7-WGS.geojson` | 90 | 90 | 0 | 0 |
| **Total** | | **1,610** | **1,610** | **9** | **0** |

No current feature is excluded: all have usable polygon geometry and a name or source identifier. The nine unnamed features are F1 OBJECTIDs **10–16** and F3 OBJECTIDs **249, 315**. They remain searchable by identifier; no names were invented.

The catalog records exclusions with source row, floor, identifiers and reasons when a feature lacks both usable names and identifiers, or has missing/invalid polygon geometry. Geometry checks cover supported polygon types, finite geographic coordinates, ring closure and nonzero ring area; they are not a complete topology/self-intersection audit.

Full counts, unnamed-feature provenance and query results: [data-audit.json](data-audit.json).

## Search examples

| Query | Results | Floor distribution |
| --- | ---: | --- |
| `class` | 9 | F1: 1; F2: 1; F6: 3; F7: 4 |
| `GROUP   STUDY` | 23 | F3: 3; F4: 9; F5: 7; F6: 4 |
| `classroom-0754` | 1 | F7 |
| `dewey` | 7 | F0 |
| `structure` | 432 | F0: 31; F1: 116; F2: 64; F3: 78; F4: 65; F5: 29; F6: 19; F7: 30 |
| `staircase` | 855 | F0: 86; F1: 152; F2: 154; F3: 169; F4: 94; F5: 60; F6: 96; F7: 44 |

Repeated names remain separate source features. The browser checks select two F4 `Structure` results and verify different source keys, with exactly one highlighted polygon each time. Case variations of `structure` appear across all eight floors.

## Verification records

- Production build: **passed**; existing bundle-size and Vite CJS deprecation warnings remain.
- Browser verification: **passed**, exit code 0, 25 phases and zero page errors, including fixed panel dimensions and mobile container placement. See [browser-results.json](browser-results.json).
- Direct map click: **passed**; a visible classroom polygon opens the name-only panel and completes the overhead camera animation. See [map-click-results.json](map-click-results.json).
- New unit tests: **19 passed**. Full-suite baseline details appear below.
- `git diff --check`: **passed**.
- Source integrity: all **51 GeoJSON hashes unchanged** from the start of Stage 3.

Representative browser selections use real attributes:

| Floor | Query | Selected source name |
| --- | --- | --- |
| F0 | `JOURNALS 1995 older a` | `journals 1995 & older a to f` |
| F1 | `CLASSROOM-0174` | `Classroom 0174` |
| F2 | `026` | `Classroom 0261` |
| F3 | `lactation` | `Lactation Room 0323` |
| F4 | `conference 048` | `Library Conference 0480A` |
| F5 | `group study 0550a` | `Group  Study 0550A` (source contains doubled whitespace) |
| F6 | `math class` | `Math Classroom 0654` |
| F7 | `classroom0754` | `Classroom 0754` |

The revised harness verifies the selected floor, exact polygon highlight, loaded feature count, room centering, visible selected-polygon bounds, overhead orientation, name-only details panel, absence of a selected-feature overlay, constant panel dimensions while zooming, keyboard selection, and mobile selection. It also checks manual zoom, both Night presets, retained single-floor routes, inspection from a multi-floor timeline, return to the timeline, unchanged F-ALL feature count, delayed indexing, and failed-floor Retry.

Machine-readable browser results: [browser-results.json](browser-results.json). Screenshots: [desktop selection](selected-f7.png), [mobile selection](mobile-search.png).

The original Stage 3 unit suite added 19 tests: 17 catalog/loading/search cases and two optional camera-context cases. Its last full run reported **134 passed / 11 failed / 145 total**. The 11 failures match the Stage 1/2 baseline: two color-restoration assertions and nine routing-anchor assertions. See [test-summary.json](test-summary.json) for their names and the 51-file GeoJSON integrity check. The presentation revision is verified by the updated browser harness and a fresh production build. Browser checks use headless Chrome with software WebGL and do not measure hardware rendering performance.

## Changed files

| File | Responsibility |
| --- | --- |
| `src/utils/roomCatalog.js` | Shared source configuration, validation, identity, normalization, search ranking and asynchronous store. |
| `src/hooks/useRoomCatalog.js` | React subscription and all-floor loading. |
| `src/components/SearchBar.jsx` | Comprehensive results, floor/ID labels, keyboard interaction and loading/error status. |
| `src/App.jsx` | Shared source loading, stale-response cancellation, selection lifecycle and route-view coordination; responsive name-only selection panels. |
| `src/components/Map3D.jsx` | Data-ready overhead camera animation, selected polygon framing and priority over an existing route camera request. |
| `src/components/IndoorBuilding.jsx` | Exact source-key selection highlight and its protection in Night rendering; legacy routing IDs retained. |
| `src/components/RoomInfoPopup.jsx` | Fixed-size name-only selection card and close action. |
| `src/App.css` | Search status, active result, localized load status and responsive fixed-size selection panels. |
| `src/utils/buildingCamera.js` | Optional room-focus context bounds and zoom ceiling; default building fitting unchanged. |
| `src/utils/roomCatalog.test.js` | Catalog, real-data, duplicate, invalid-data, retry and out-of-order load tests. |
| `src/utils/buildingCamera.test.js` | Room focus with complete floor context on desktop and mobile. |
| `review/search-check.cjs` | Reproducible browser verification and data report. |
| `review/selection-name-check.cjs` | Direct visible-polygon click and name-only panel verification. |
| `docs/stage-3-search/` | Report and verification artifacts. |

No source GeoJSON, dependencies, floor-stacking formulas, routing graph logic, lighting fixture positions or Night preset definitions were changed. Workspace edits predating Stage 3 were preserved.

## Reproduction

```powershell
npm.cmd run build
npm.cmd run test -- --run
```

With Vite running and Playwright plus Chrome available:

```powershell
$env:SEARCH_REVIEW_URL = 'http://127.0.0.1:3001'
node review/search-check.cjs
```

If needed, set `PLAYWRIGHT_MODULE` to an existing Playwright installation. `SEARCH_REVIEW_OUTPUT` overrides the output directory. The harness temporarily simulates a delayed and failed F7 response within its own browser session; it does not modify datasets or the server.

Stage 3 is complete. No later stage was started.
