**Morris Library 3D Indoor Map Viewer — Stage 1 audit and implementation plan**

Audit date: October 22, 2026. Scope: the current working tree, including the existing, uncommitted Night Mode work and dataset edits. This is an inspection report; it does not implement the proposed features or change application behavior.

Evidence comes from the application, routing library, installed dependencies, configuration, and local GeoJSON files. Read-only calculations checked feature counts, attributes, coordinate structure, elevations, and polygon overlaps. Performance observations below distinguish code paths that definitely execute from costs that still need profiling. The audit did not establish hardware frame rates, survey accuracy, or architectural correctness of the source drawings.

**Assessment**

The existing React/deck.gl viewer can support all eight requested features without replacing its renderer or routing engine. The main prerequisite is a consistent room catalog and coordinate contract: general search uses the current display export, routing uses a separate all-floor index, and F-ALL uses a combined export that differs from the individual floor files. Names currently act as identifiers despite substantial duplication. Vertical placement also differs between building geometry and navigation overlays.

| Requested capability | Existing capability | Assessment |
| --- | --- | --- |
| Visible zoom and Reset View | Gesture zoom, keyboard shortcuts, unused zoom handlers | Visible controls require implementation; Reset needs a real building fit. |
| Responsive initial framing | Building center calculation; room/route bounds fitting; resize observation | Initial framing does not fit the building to the viewport. Existing fitting machinery is reusable. |
| Search across F0–F7 | Current-display search; separate all-floor routing catalog; cross-floor selection/focus handler | Incomplete integration, ambiguous identifiers, and limited result handling. |
| Dynamic room labels | Collision-aware route endpoint, landmark, transition, and connector labels | General room labels and their visibility policy require implementation. |
| Meaningful room colors | Source colors, metadata repair, highlight/navigation colors, two Night styles | No working thematic mode selector or corresponding semantic legend. Attribute coverage limits available themes. |
| Rendering performance | Memoized geometry, cached wall footprints/light fields, shared Night textures | Several avoidable loading/recomputation paths exist; hardware bottlenecks remain unmeasured. |
| Accurate F-ALL superimposition | Source XY is retained while Z is added | Preserve this XY behavior. Dataset differences and inconsistent Z conventions need explicit resolution. |
| Rooms Above/Below | Geographic polygons, projection/point/segment helpers, Turf wall operations | Feasible new analytical service; no existing room-overlap query or polygon-intersection-area API. |

**Source map and reusable architecture**

Paths are relative to the repository root. Line references describe the audited working tree.

| Source | Relevant functions/state and responsibility |
| --- | --- |
| `package.json`, `vite.config.js`, `src/index.jsx` | React 18/Vite application; deck.gl 8.9, Mapbox GL 3, react-map-gl 7; Vitest; React StrictMode in development. Static public GeoJSON is the data source. |
| `src/App.jsx:41`, `:105`, `:454` | `ALL_BUILDING_FLOORS`, `ROUTER_CONFIG`, `FLOOR_POLYGON_MAP`: F0–F7 configuration and separate display/routing sources. |
| `src/App.jsx:497`, `:761`, `:775` | `loadRouteRoomIndex`, `loadAllFloorDisplayReference`, `loadGeojson`: eager routing catalog, cached combined metadata reference, and floor-specific display loading. |
| `src/App.jsx:889`, `:900`, `:911`, `:992` | `handleFloorChange`, `findRoomFeatureById`, `handleRoomSelect`, `handleSearch`: selection, filtering, floor switching, and camera requests. |
| `src/App.jsx:361`, `:1023`, `:1032`, `:2230` | Keyboard shortcuts, `handleViewReset`, unused `handleZoomIn`/`handleZoomOut`, and `handleUserCameraInteraction`. App owns the main controlled camera. |
| `src/components/Map3D.jsx:163`, `:191`, `:212`, `:336` | Coordinate extraction, geographic bounds, approximate metric bounds, `getLabelPosition`. |
| `src/components/Map3D.jsx:490`, `:574`, `:641`, `:1130`, `:1274`, `:2136` | Resize handling, `getDisplayData`, visible floors, search/route camera effects, and DeckGL controller. |
| `src/components/IndoorBuilding.jsx:171`, `:190`, `:204`, `:238`, `:268`, `:671` | `computeElevation`, floor/base accessors, `applyBaseToGeometry`, `buildFilteredIndoorFeatureCollection`, active `useIndoorBuilding` hook. |
| `src/components/SearchBar.jsx`, `RoutePlanner.jsx`, `RoomInfoPopup.jsx` | General search, independent routing search, selected-room details. The popup receives properties rather than the complete source feature. |
| `src/components/VisualControls.jsx`, `FilterPanel.jsx`, `Legend.jsx` | Existing settings panel, basic filters, and an unused floor-oriented legend. No thematic color mode or general label control is connected. |
| `src/components/MultiFloorRouteTimeline.jsx` | Separate Map3D instance/camera for each route-floor panel; relevant to camera scope and resource costs. |
| `src/utils/featureColors.js:49`, `:184` | `parseFeatureColor`, `enrichMissingFeatureDisplayProperties`: source-color parsing, aliases, fallback color, and combined-export metadata repair. |
| `src/utils/roomWallGeometry.js:81`, `:175` | `buildRoomWallShells`, wall-footprint cache, cache-clear utility; Turf inward buffer and difference. |
| `src/utils/wallGeometry.js`, `src/layers/buildingWallLayer.js`, `perimeterWallLayer.js`, `stackedWallLayer.js` | Wall meshing, floor wall fetches, perimeter envelope, configured stacked wall exports. |
| `routing/geometry.ts:52`, `:89`, `:233`, `:267`, `:351` | Common local projection, ring/polygon projection, point containment, segment intersection, and bounds. Re-exported by `routing/index.ts`. |
| `routing/graph.ts`, `astarGraph.ts`, `router.ts`, `multiFloorRouter.ts:125`, `:375` | Spatial graph construction, A*, routing, `computeMultiFloorRoute`, and vertical connector construction. |
| `src/utils/routeAnchors.js:45`, `:61`, `:104`, `:118` | Name normalization, floor accessor, centerline anchor index, `resolveRoomRoutingTarget`. Door/centerline/boundary routing anchors are distinct from label anchors. |
| `src/hooks/useNightPreset.js`, `src/utils/nightLightingConfig.js` | Shared Architectural Night/GIS Night state, preset parameters, bounded transitions and reduced-motion handling. |
| `src/hooks/useInteriorLighting.js`, `src/utils/interiorLighting.js`, `surfaceLighting.js`, `src/layers/nightSurfaceLayer.js`, `interiorLightLayer.js` | Combined fixture loading, floor placement, cached illumination fields, shared GPU textures, surface shaders, fixture sprites. |

`Map3D` calls the named `useIndoorBuilding` hook. The default component exported by `IndoorBuilding.jsx` is not the active renderer. There is also unreachable older filtering code after the early return inside the hook's `filteredData` memo. New work should target the active path, not infer behavior from that legacy code.

The main map uses App's controlled camera, while timeline maps have their own cameras. Mapbox supplies the basemap; deck.gl owns the interactive camera and overlay layers. Preserve that ownership rather than introducing a second independently controlled zoom system.

**Dataset findings and coordinate evidence**

The counts below are features, not counts of distinct occupiable rooms. Many polygons represent structure, stair treads, floor surfaces, or pieces sharing a room name.

| Floor | Individual display file | Individual features | Combined-export features on that floor | Unnamed individual features |
| --- | --- | ---: | ---: | ---: |
| F0 | `public/rooms-basement-WGS.geojson` | 148 | 143 | 0 |
| F1 | `public/rooms-level-01-WGS.geojson` | 355 | 342 | 7 |
| F2 | `public/rooms-level-02-WGS.geojson` | 243 | 247 | 0 |
| F3 | `public/rooms-level-03-WGS.geojson` | 288 | 283 | 2 |
| F4 | `public/rooms-level-04-WGS.geojson` | 199 | 203 | 0 |
| F5 | `public/rooms-level-5-WGS.geojson` | 149 | 160 | 0 |
| F6 | `public/rooms-level-6-WGS.geojson` | 138 | 138 | 0 |
| F7 | `public/rooms-level-7-WGS.geojson` | 90 | 92 | 0 |
| Total | Combined: `public/rooms-all-WGS-v6.geojson` | **1,610** | **1,608** | **9** |

All nine room exports contain finite two-dimensional coordinates near longitude −89.22, latitude 37.715; no source coordinate Z is present. The combined bounding box is approximately `[-89.221091478, 37.714941628, -89.219842199, 37.715641340]`. The coordinate values, filenames, and renderer assumptions are consistent with geographic WGS84 longitude/latitude. Explicit CRS metadata and independent survey-registration evidence were not found in these exports; numerical consistency is not a survey certification.

Individual-floor rings were closed, had positive measured area, and contained no holes in the audited files. F3 includes one MultiPolygon; the combined file also includes one. These checks are not a comprehensive self-intersection/topological-validity audit. Future calculations still need hole and multipart support.

F1–F7 use `OBJECTID`, `level`, `base_height`, `height`, `Shape_Length`, `Shape_Area`, `name`, and `stack`; F0 additionally uses variants including `FID`, `FID_`, `base_heigh`, and `z_values`. The combined source uses `base_heigh` and source colors. Source `OBJECTID`/`FID` values are unique within their respective individual-floor files, but they are not a verified cross-export identity mapping.

Names are unsuitable as primary keys. The individual-floor counts of features sharing a duplicated name-first display identifier are F0–F7: **126, 336, 234, 263, 189, 127, 125, 76**. In the combined file, 1,535 features participate in duplicated display identifiers. Examples include `StairCase`, `Structure`, and multiple `Delytes Cafe` polygons. Duplicate names may represent either parts of one space or different spaces; merging them indiscriminately would be unsafe.

No populated `type`, `tipo`, `number`, `category`, `use`, or `department` field was found in the room exports. Room numbers are embedded in some names. `stack` values such as Stack A–H are not a validated room-use taxonomy. Name spelling/spacing varies, including `Srairs Area Upper`, `Groups Study 0580A`, and doubled spaces. Existing `normalizeRoomName` handles several normalization cases and can be shared without changing stored names.

F1–F7 have no raw color values; F0 has 16 missing colors. Running the existing repair function against the combined reference leaves missing-color counts F0–F7 of **16, 6, 1, 4, 1, 1, 7, 1**. The combined file contains 49 blank color values. The renderer supplies a fallback, so missing metadata does not necessarily mean invisible polygons. Repair uses floor-scoped rounded bounding boxes, then normalized names and heuristics; ambiguous matches are a data-quality risk.

Stored `Shape_Area` must not be presented as verified square meters. For example, F1 `Classroom 0174` has approximately 107.06 m² under a common local metric projection, versus stored `Shape_Area` 171.0817727964. F6 `Math Classroom 0654` measures approximately 215.88 m² versus stored 344.9781714344. The source units/projection responsible for the difference are undocumented in the inspected data.

Six F0 individual features and 19 combined features have nonpositive `height - base`. `computeElevation` clamps extrusion to at least 0.5, while wall generation has its own validation. Some combined `Structure` features and an F3 `Floor` feature have base zero alongside otherwise elevated floor features. These exceptions affect any minimum-base normalization; they should be investigated, not automatically rewritten.

**XY consistency and overlap feasibility.** A read-only comparison projected both source families into one local metric coordinate frame centered at `[-89.22048, 37.71532]`, using Earth radius 6,378,137 m and the same local longitude/latitude scaling approach as the routing utilities. Polygon Boolean operations used the already installed `polyclip-ts` package. For each individual feature, the best same-floor combined feature was compared by intersection-over-union (IoU), after a bounding-box prefilter.

| Floor | Best IoU ≥ 0.99 | Best IoU 0.50–<0.99 | Best IoU < 0.50 |
| --- | ---: | ---: | ---: |
| F0 | 124 | 6 | 18 |
| F1 | 336 | 7 | 12 |
| F2 | 238 | 4 | 1 |
| F3 | 226 | 50 | 12 |
| F4 | 197 | 0 | 2 |
| F5 | 146 | 2 | 1 |
| F6 | 132 | 2 | 4 |
| F7 | 87 | 1 | 2 |
| Total | **1,486** | **72** | **52** |

About 92.3% have a near-identical footprint match. This supports broadly shared XY coordinates but also demonstrates that the two source families are not interchangeable. These are best geometric matches, including structural features, not a one-to-one identity crosswalk. No Boolean-operation exceptions occurred in this comparison; that does not prove every geometry is valid.

Examples of measured cross-floor overlap from individual-floor files:

| Selected feature | Feature on another floor | Intersection | Selected footprint covered | Other footprint covered |
| --- | --- | ---: | ---: | ---: |
| F1 Classroom 0174 | F2 Information Resources Management | 107.06 m² | 100.0% | 9.9% |
| F4 Geospatial Resources | F5 Lc Books HV To PG | 63.42 m² | 98.7% | 9.4% |
| F6 Math Classroom 0654 | F7 Classroom 0754 | 210.78 m² | 97.6% | 98.0% |
| F6 Math Classroom 0654 | F5 Lc Books HV To PG | 172.21 m² | 79.8% | 25.6% |

Thus Above/Below can use footprint intersection in a common XY frame. It must report both coverage percentages: a small room inside a large book-stack area otherwise gives a misleading single percentage. Footprint overlap does not imply a staircase, accessible connection, or verified structural relationship.

**F-ALL elevation issue.** `applyBaseToGeometry` preserves longitude/latitude, so no active building transform was found that laterally shifts floors. At full reveal, however, `buildFilteredIndoorFeatureCollection` applies:

`stacked base Z = source feature base + floor number × 4.5`

Most combined source bases already increase with floor elevation:

| Floor | Most common source base | Current stacked base |
| --- | ---: | ---: |
| F0 | 0 | 0 |
| F1 | 4.5 | 9 |
| F2 | 9 | 18 |
| F3 | 13.5 | 27 |
| F4 | 17 | 35 |
| F5 | 21.5 | 44 |
| F6 | 26 | 53 |
| F7 | 30.5 | 62 |

This is extra separation added to an already elevated source. Whether that separation is intended as an exploded display is a product decision; it is not safe to silently remove it. Independently, `Map3D.routeElevation` and preview elevation use only `floor × 4.5 + offset`, which is a confirmed formula mismatch with the room bases. Fixture placement uses a source floor datum plus stack offset and local fixture height. Perimeter walls have their own source elevations, and single-floor walls use local heights. These systems need one explicit vertical convention before new analytical overlays or labels can be assumed to align.

**Confirmed causes and implementation approach**

1. **Visible map controls and responsive framing**

   The deck.gl controller already enables scrolling, pinch, double-click and keyboard zoom, with bounds 14–22. App also handles keyboard `+`, `−`, and `R`. `handleZoomIn`/`handleZoomOut` are defined but not mounted to controls and do not clamp their values. `handleViewReset` resets zoom to 17, pitch to 45, and bearing to zero while retaining the current longitude/latitude; it cannot return a panned-away camera to the building.

   On display load, App computes a bounding-box midpoint but retains the previous zoom. Map3D likewise has a fixed initial zoom. Resize observation resizes/redraws the canvas; it does not refit the building. This explains why a consistent “nearly fills the usable viewport” result is not implemented. Search and route effects already use actual container dimensions and `WebMercatorViewport.fitBounds`, making them useful starting points.

   Add compact, accessible `+`, `−`, and `Reset View` controls connected to the same controlled view state. Centralize zoom clamping and mark button zooms as manual camera interaction. Keep route recentering as a separate action. A slider is optional after the core controls; it should use the same bounds and expose its value accessibly. Define which timeline panel a control affects rather than sending every action to the main map.

   Implement a reusable building-fit function using the measured usable container and padding for overlays, drawers, and controls. For pitched F-ALL, include the projected vertical extent of the actual rendered building: a flat XY fit alone can clip upper floors. Use a planar fit as a starting point, then verify projected 3D bounds and adjust zoom/center. Do not scale or move source geometry to improve framing.

   Fit at initial data readiness and explicit Reset. Resize or floor changes may refit while the camera remains in an automatic overview state; a manual camera must not be repeatedly overwritten. Search focus, route focus, Reset, and manual interaction need a defined priority and stale-request cancellation. Preset changes and visual sliders must never trigger a fit. Review the overlapping App/deck keyboard handlers, including focus inside controls; duplicate key handling is a risk, not a reproduced runtime failure from this audit.

2. **Comprehensive F0–F7 search and shared room identity**

   `SearchBar` receives `allRooms`, which actually contains only the currently loaded display export. `RoutePlanner` separately receives `allFloorRouteRooms`, loaded from all eight floors. Search caps suggestions at eight, lacks floor badges/ranking, uses name-first IDs, and treats Enter as a display filter rather than selecting and focusing a result. Clearing search removes the filter but does not consistently clear the highlighted room. Filters can also survive a floor change. Numeric `number` values would fail the current direct `.toLowerCase()` call, although that field is absent in the audited exports.

   Create one cached, immutable floor catalog with normalized floor, original source feature, stable source/floor/feature key, display name, searchable aliases, optional extracted room number, bounds, and provenance. Retain a separate, explicit mapping to the combined display export. Individual files are a reasonable catalog starting point because routing already uses them, but do not silently replace F-ALL or claim a match where none has been verified. Do not deduplicate all features by name. Optional logical-room grouping needs an approved crosswalk.

   Feed both searches from this catalog while preserving the routing engine's current anchor resolution through an adapter. Rank exact room number/name matches before token matches; show floor and enough context to distinguish duplicates. Use a scrollable/expandable result list with keyboard navigation and combobox semantics. The initial eight visible suggestions must not become an eight-result universe. Validate room-versus-structure classification before excluding candidates; unclassified named spaces must remain discoverable.

   Separate search selection from geometry filtering. Selecting a result should resolve its stable key, load the target floor, then highlight and fit when matching data is ready. Preserve the query and active route during that sequence. Show partial catalog/load failures explicitly. Add cancellation/request-generation checks so an older floor fetch cannot overwrite a newer selection. The current display effect has no such guard.

3. **Dynamic, floor-aware room labels**

   Existing TextLayers label route endpoints, landmarks, transitions and used connectors, with `CollisionFilterExtension`, priorities and billboard text. No general room-label layer exists. `getLabelPosition` already considers polygon containment, holes, and multipart geometry, but chooses a multipart component by bounding-box area and uses a coarse interior grid fallback. Very narrow or concave shapes can defeat that fallback. The routing centroid/door anchor is not a substitute for a verified interior label point.

   Add a dedicated room-label layer using cached interior anchors keyed by source geometry. Verify the anchor lies inside the polygon; choose the largest actual-area component and use a robust interior-point fallback when necessary. Reuse the collision extension and coordinate its priorities with existing route labels.

   Filter label candidates by displayed floor, viewport, projected feature size and zoom. Prioritize selected/search/route rooms, then other confirmed rooms; limit density deterministically. Include floor context in F-ALL and define depth/occlusion behavior so labels from every hidden floor do not appear through the building. Place labels through the same vertical helper as their rooms. Provide a concise label control, such as Auto / Selected / Off, and test contrast in Day, Architectural Night and GIS Night. Labels must not interfere with room picking.

4. **Meaningful room-color modes**

   App passes `colorScheme="default"`, but Map3D does not implement a thematic selector around it. Active room colors come from source metadata/repair plus floor variation and navigation overrides. The unused `Legend.jsx` is not a semantic color legend. `FilterPanel` also expects type fields that the data does not contain. GIS Night improves color retention; it does not supply missing room classifications.

   Keep Source Colors as the compatibility default. Floor is immediately supportable from verified floor metadata. Room Function requires an explicit, reviewable classification mapping with an Unknown value and provenance; do not present guessed department, occupancy, availability, or safety attributes as data. Area could be a useful optional quantitative mode after its metric computation and legend are defined.

   Centralize the thematic color resolver so room fills, corresponding walls and the visible legend agree. Keep Night style and thematic mode as separate state dimensions, with the existing shader receiving the chosen base color. Preserve current selection, route endpoint, landmark and connector priorities. Prefer separate analysis outlines for Above/Below to avoid overwriting thematic meaning. Use readable, color-vision-conscious palettes, text legends, and documented units/class breaks. Keep original source properties intact.

5. **Rendering and loading performance**

   A confirmed high-impact lifecycle issue is `App.jsx:2240`: each floor fetch sets `isLoading`, causing the entire viewer to return a loading screen. The map and search controls unmount and later remount, resetting component-local state and repeating map-layer setup. Keep the viewer mounted during subsequent floor loads, retain the previous frame, and show a localized loading/error state. The initial empty-app loading state can remain separate.

   Share fetch/parse promises between the display catalog and routing room index, and load only missing/failed entries on retry. The current catalog's aggregate failure path retries floor loads individually. Wall hooks also load all configured floor files per Map3D mount. All eight configured `wall_room_*_stack.geojson` files are absent from the local `public` directory; the stacked-wall hook nevertheless loads its configuration. Resolve that configuration against actual assets and desired behavior before adding geometry or suppressing errors.

   `useBuildingWallLayers` defaults `floorBaseOffsets` to a new `{}` on each call; Map3D omits it, while the mesh memo depends on it. This defeats that memo on rerenders. Stabilize default arrays/objects and relevant callbacks. Map3D has unconditional render-time logging. Its route animation schedules React updates every frame while enabled, and the reveal animation regenerates transformed geometry. Perimeter mesh memoization depends on the whole presentation object. Isolate static geometry from animated uniforms/paths and avoid unrelated presentation changes rebuilding meshes.

   Wall footprints are already cached, so repeated Turf buffering is not necessarily the dominant cost. However, the global wall cache is unbounded across distinct geometries/thicknesses, and wrapper/mesh creation can still recur. Add a bounded lifetime/eviction policy if measurements show growth. Timeline panels each mount a Map3D with its own WebGL context and basemap; lazy mounting or virtualization is a candidate after measuring panel count and interaction needs.

   Establish a production-build baseline for load time, request counts, frame time, CPU work, draw calls, GPU allocations, device pixel ratio, and repeated mount/unmount behavior. Compare single-floor, F-ALL, routed, timeline and both Night views at matched cameras on representative hardware. Prioritize observed bottlenecks; do not introduce a worker, spatial-index dependency, mesh batching rewrite, or renderer upgrade without measured benefit. The large-bundle warning alone does not identify a frame-rate problem.

6. **Preserve and formalize floor superimposition**

   Retain unmodified source XY as the analytical coordinate system and make rendered Z a separate derived value. Characterize current transforms with tests before changing their convention. Define whether overview mode is physically stacked or intentionally separated, then expose one shared floor/feature elevation contract for rooms, walls, routes, markers, labels, fixtures and analysis overlays.

   Resolve source base aliases and exceptional structural features explicitly. A uniform 4.5 spacing is not equivalent to all existing source datums: for example, the common F4 source base is 17. Floor accessors currently disagree in precedence and sometimes use `||`, which is unsuitable for zero-valued floors. Standardize normalization at the catalog boundary while preserving source metadata.

   Do not apply per-floor XY centering, independent scaling, or lateral offsets. Compare cross-floor landmark coordinates and overlay snapshots at fixed bearings. The individual/combined source discrepancies require a documented crosswalk or an approved authoritative export before claiming identical room representation between single-floor and F-ALL views. A visual outline must not silently jump to a similarly named combined feature.

7. **New analytical feature: Show Rooms Above and Below**

   Add a pure analytical module operating on canonical source features, independent of camera position, rendered Z, selected display floor, lighting, and routing state. Existing `routing/geometry.ts` provides projection, bounds, point containment and segment operations. It does not calculate polygon-polygon intersection areas. `roomWallGeometry` demonstrates polygon Boolean operations through Turf buffer/difference, but it is not a room-overlap service.

   The installed dependency tree contains `polyclip-ts` through Turf; `@turf/intersect` is not currently a declared/installed direct feature dependency. Choose and explicitly declare a tested polygon-clipping dependency during implementation, rather than relying on an incidental transitive import. No dependency was installed during this audit.

   Recommended algorithm:

   - Resolve the selected stable feature key and the requested target floors. Start with the immediately adjacent floors, with an optional all-floors-above/below range, subject to product confirmation.
   - Use one common local metric projection for selected and candidate polygons. Preserve full Polygon/MultiPolygon topology, including holes. Never independently center each floor or use rendered geometries as analytical inputs.
   - Prefilter candidates using cached metric bounding boxes. For this dataset size, a simple floor bucket and bounding-box scan may suffice; add a spatial index only if measured query cost warrants it.
   - Compute intersection area, selected area and candidate area. Return square meters, percentage of the selected footprint, percentage of the candidate footprint, source keys and target floor. Exclude same-floor features and edge/point-only contact. Establish explicit numerical/sliver tolerances rather than rounding coordinates arbitrarily.
   - Sort by floor and meaningful coverage. Preserve distinct source features unless an approved logical-room grouping defines how split parts should be unioned. Do not sum overlapping parts in a way that double-counts area.
   - Cache by dataset version, feature key, target-floor range and tolerance settings. Distinguish no overlap, unavailable floor, invalid geometry, and unclassified target feature. A failed polygon operation must not silently become “no rooms above.”

   Add an action to the selected-room popup/details view after it carries a stable feature key. Show Above and Below result groups with room name, floor, overlap area and both coverage percentages. F0/F7 boundary cases should clearly indicate the absence of another supported floor in that direction. Clicking a result can reuse the corrected floor-selection/focus flow. An optional F-ALL overview can draw separate selected/above/below outlines without moving any floor, changing source colors, or clearing the current route. If a combined-source counterpart is unresolved, retain the accurate individual-floor result and state that an overview highlight is unavailable.

   Keep overlap independent of route connectivity: do not create vertical navigation edges or change route instructions from these results. Clear/close analysis should remove its overlays and respect the user's current camera/display intent. Results describe mapped footprint overlap, not structural or occupancy information.

**Night Mode and routing regression boundaries**

Both Night presets already exist in the working tree. Architectural Night and GIS Night share one renderer, the combined `interior_lights.geojson`, cached fields and GPU textures. Preserve the user's established combined-source choice, fixture coordinates/radii, and both preset behaviors. The combined source supplies 138 enabled fixtures across F0–F6; F7 currently has no fixtures and uses ambient illumination. Do not synthesize an F7 light dataset as part of these features.

`useNightPreset` shares the transition across main/timeline maps, uses a bounded 550 ms interpolation, and handles reduced motion. Camera, geometry, source fields and routing should remain independent of preset transitions. New color modes need attribute updates when the selected thematic mode actually changes; ordinary preset transitions should retain the existing geometry/texture reuse and protected navigation colors.

Routing already builds floor graphs and vertical connectors, and resolves room targets through explicit door anchors, centerline names, geometry-derived anchors and fallbacks. Changes to identifiers/search must preserve those behaviors via adapters. Existing routing projections and segment utilities can be reused for analysis, but overlap must not alter graph connectivity. Multi-floor route state and the timeline should survive ordinary search/analysis inspection.

**Safe implementation sequence and dependencies**

1. **Characterize and agree on data contracts.** Record representative fixtures and current camera/XY/Z behavior; establish stable feature identity, source provenance and missing-data handling. Decide the combined-versus-individual crosswalk and the intended vertical display convention. Keep the present appearance until an elevation change is explicitly included in implementation scope.
2. **Create the shared catalog/loading layer.** Cache floor sources, normalize floor/ID access, reject stale responses, retain the mounted viewer during loads, and fix clearly unnecessary refetch/recompute paths. Preserve routing through an adapter. This supports search, labels, colors and overlap.
3. **Implement camera controls and building fit.** Unify camera intent/clamping; add visible controls and viewport-aware initial/Reset framing. Cover pitched F-ALL before changing the launch view.
4. **Complete global search.** Use the shared catalog, accessible ranked results and data-ready cross-floor focus. This selection contract becomes the entry point for analytical results.
5. **Add labels and thematic colors.** Reuse stable keys, verified anchors, the elevation contract and confirmed metadata. Keep color modes separate from Night styles and route highlights.
6. **Implement and test overlap calculations, then the Above/Below UI.** Validate numerical behavior before wiring map overlays; preserve route and display state. Resolve uncertain cross-export highlights explicitly.
7. **Measure and tune the integrated renderer.** Compare against the initial baseline, then apply justified label culling, timeline resource management, geometry caching or batching. Complete visual/accessibility/regression review before release.

Core source data, IDs, and elevation decisions come first because later features otherwise encode incompatible interpretations. Basic camera UI can be built independently, but final framing and analytical overlays must use the settled rendered extent. Performance improvements should be incremental throughout, with final profiling after all feature layers exist.

Decisions to settle before the dependent implementation: which export is authoritative for logical spaces and how unmatched F-ALL features are handled; whether extra floor separation is intentional; the approved room-function taxonomy; Above/Below's default range and minimum meaningful overlap; and how split polygons should represent one logical room. These are explicit design choices, not findings supplied by the current datasets.

**Recommended verification**

The audit performed read-only data and overlap checks; it did not rerun the full application test suite or claim a new performance baseline. Existing `docs/night-presets/README.md` records a passing production build, 23 passing focused lighting/preset tests, and a full-suite result of 102 passed / 11 failed. Those documented failures comprise two color-restoration assertions and nine room-name lookups. Treat that as a prior result to reproduce before implementation, not a fresh clean bill of health. Establish whether each failure reflects stale expectations or an actual defect before changing it.

Use the existing Vitest and Testing Library setup, `routing/multiFloorRouter.test.ts`, and the tests under `src/utils` and `src/layers`. Add tests for observable contracts rather than duplicating implementation details:

| Area | Essential checks |
| --- | --- |
| Catalog and search | F0–F7 coverage; duplicate names on one/multiple floors; source keys; missing names; aliases and embedded numbers; exact-match ranking; result navigation; empty-query clearing; partial fetch failure; out-of-order floor loads; preserved query and active route. |
| Camera | Visible button/keyboard/touch behavior; zoom limits; panned-away Reset; usable viewport at phone/tablet/desktop sizes and resized sidebars; tall pitched F-ALL entirely inside padding; no camera jump during Night/color changes; manual interaction wins over stale automatic fits. |
| Labels | Interior anchors for concave, thin, holed and multipart polygons; correct floor/Z; deterministic zoom/collision priorities; selected/route labels retained; no structure-label flood; correct picking and contrast in all lighting modes. |
| Colors | Complete legend mapping including Unknown; unchanged source properties; valid quantitative units; matching wall/fill semantics; selection/route/analysis priority; Night shader input and Day restoration. |
| Superimposition | Unchanged XY coordinates through every render transform; floor-zero handling; characterized current Z values; tests for the approved future datum convention, including exceptional base-zero structure; all overlay types agree with room elevations. |
| Overlap | Disjoint/touching/contained/partial/identical polygons; holes and MultiPolygons; narrow slivers; invalid inputs; duplicate names; same-floor exclusion; missing target floor; F0/F7 boundaries; symmetric intersection area with intentionally asymmetric percentages; no mutation of source coordinates. |
| Real-data overlap | Approximate regression checks for the F1/F2, F4/F5 and F6/F7 examples above, using declared metric-projection tolerances; explicit unmatched-crosswalk cases. These are consistency fixtures, not independent survey truth. |
| Routing | Existing graph/anchor/connector tests; route survives floor search and analysis; timeline/main camera separation; no navigation edge introduced by footprint overlap. |
| Resources and performance | Fetch/parse counts across repeated floor switches; viewer stays mounted; bounded caches; stable static geometry/texture resources during animation/preset changes; WebGL cleanup when timeline panels close; production frame-time and memory comparisons on representative hardware. |

Run matched-camera visual comparisons for F0, F1, F7 and F-ALL, with/without a route and analysis overlays, in Day and both Night presets. Include high/low pitch, different bearings, compact drawers, resized sidebars and keyboard-only interaction. Existing Night review artifacts establish useful resource/visual checks, but their software-WebGL captures do not establish mobile GPU frame-rate performance.

The main regression risks are incorrect cross-export identity matches, inadvertent changes to vertical placement, search filters hiding context, automatic fits overriding manual navigation, labels overwhelming F-ALL, new colors masking navigation cues, numerical overlap errors on invalid/split polygons, and increased resource use from multiple timeline maps. The sequence and tests above address those risks without requiring a renderer or routing rewrite.

Stage 1 ends with this report. No application code, dependency, source dataset, or rendering behavior was changed for the audit; implementation awaits the next instruction.
