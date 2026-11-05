# Stage 1 audit: Room Classification and Space Analytics

Audited October 27, 2026. **Investigation only.** No production component, stylesheet, shader, routing logic, classification configuration, or GeoJSON was changed. The audit includes all 51 public GeoJSON files and the relevant source paths. Calculations and proposals are audit artifacts, not an implemented classifier or dashboard.

## Principal findings

1. The eight authoritative individual-floor datasets contain **1,610 polygon features**, not 1,610 physical rooms. They include **431 exact Structure/Structures-name features, 966 stair/elevator components, 27 entrance/exit features, five Floor surfaces, and nine unnamed features**. Every authoritative feature has an export identifier, but none has a verified external facilities-space ID.
2. The production room-function configuration is empty. **Zero features currently have verified functional classification through that interface.** Names and the owner's supplied knowledge support proposals, not automatic certification of room boundaries or functions.
3. All authoritative geometries passed the existing metric/topology checks. Nevertheless, **788 same-floor feature pairs overlap positively**, including **242 pairs overlapping by more than 1 m²**. Geometry validity does not imply mutually exclusive spaces.
4. F-ALL contains **1,608 display features**. Comparing full horizontal footprints at the existing nine-decimal export precision gives **1,473 unique links and 135 unmatched display features**. **137 authoritative features have no unique combined match.** Exact unrounded comparisons yield no matches. Export precision and actual geometry differences both matter; do not join by row order, name, or independent OBJECTID.
5. Stored `Shape_Area` is unsuitable as an assumed ground-area-in-m² field. The metric/source-area median ratio is approximately **0.62438 on every floor**. Its original measurement CRS and units are undocumented. Recalculate from coordinates using the existing projected geometry pipeline.
6. An honest first analytics release can show feature inventories, calculated footprints, provisional classification coverage, and data-quality issues. Reliable physical-room counts and assignable-space allocation need **geometry-role review, logical-space grouping, boundary definitions, and approved metadata** first.

## A. Source inventory and authority

`src/utils/roomCatalog.js` defines the authoritative mapping in `FLOOR_POLYGON_MAP` and the physical floor order in `ROOM_FLOORS`. F0 and the legacy `-1` alias point to the same file; count that file once.

| Floor | Authoritative room source | Features | F-ALL features on that level | Unique combined footprint links | Unmatched combined |
| --- | --- | ---: | ---: | ---: | ---: |
| F0 | `rooms-basement-WGS.geojson` | 148 | 143 | 124 | 19 |
| F1 | `rooms-level-01-WGS.geojson` | 355 | 342 | 333 | 9 |
| F2 | `rooms-level-02-WGS.geojson` | 243 | 247 | 233 | 14 |
| F3 | `rooms-level-03-WGS.geojson` | 288 | 283 | 222 | 61 |
| F4 | `rooms-level-04-WGS.geojson` | 199 | 203 | 197 | 6 |
| F5 | `rooms-level-5-WGS.geojson` | 149 | 160 | 145 | 15 |
| F6 | `rooms-level-6-WGS.geojson` | 138 | 138 | 132 | 6 |
| F7 | `rooms-level-7-WGS.geojson` | 90 | 92 | 87 | 5 |
| Total | Eight sources, counted once | **1,610** | **1,608** | **1,473** | **135** |

F-ALL uses `public/rooms-all-WGS-v6.geojson`. It is an alternative representation of the building, not another floor or another set of spaces to add to totals. The crosswalk is diagnostic: even a geometric match is not proof of an externally verified physical-space identity. Unmatched features need review rather than a nearest-name assignment.

Other inspected sources:

- Nine wall exports: `wall.geojson` contains 21 LineStrings; `wall_room_basement.geojson` and F1–F7 wall files each contain one LineString. They are rendering boundaries, not additional room-area polygons. `buildingWallLayer.js`, `perimeterWallLayer.js`, and `wallDataCache.js` load them.
- Eight walkable exports contain 12 polygon features in total; eight obstacle-buffer exports contain eight polygon features. These are routing-derived surfaces, often multipart/holed, not an approved occupiable-area schedule. For example, F5 walkable geometry measures only 59.07 m² against its 5,693.90 m² Floor surface; the files answer different questions.
- Nine centerline exports are LineStrings. Both `basement_centerlines.geojson` (66 features) and misspelled `basemment_centerlines.geojson` (83) exist. The current `FLOOR_CONFIG` in `App.jsx` selects the latter. Do not merge them into a new inferred circulation-area layer.
- Eight lighting exports are Point datasets: the combined 138-anchor source plus F0–F6 sources. Their `floor_id`, `light_id`, and `light_type` fields describe lighting, not room use. No F7 light source exists.

All 51 files were parsed, with source hashes, geometry types, extents and fields recorded in [sources.json](sources.json). None declares a `crs` member. The room filenames, application conventions, user-provided context and longitude/latitude extents support WGS84 input; no independent survey/georeferencing certification is present.

### Floor-by-floor feature inventory

Names below are normalized for case, punctuation and whitespace for counting only; original names remain in the inventory. F0 has 27 literal name variants but 26 normalized names because of capitalization. Missing names are not counted as unique names.

| Floor | All polygons | Unique names | Missing names | Repeated-name groups | Exact Structure | Exact Floor | Other named features¹ | Stair/elevator pieces | Collection candidates | Manual-review features² |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| F0 | 148 | 26 | 0 | 4 | 31 | 1 | 18 | 97 | 16 | 4 |
| F1 | 355 | 26 | 7 | 14 | 116 | 1 | 51 | 169 | 0 | 49 |
| F2 | 243 | 15 | 0 | 6 | 64 | 2 | 10 | 164 | 0 | 8 |
| F3 | 288 | 29 | 2 | 6 | 78 | 0 | 25 | 179 | 12 | 11 |
| F4 | 199 | 22 | 0 | 12 | 64 | 0 | 28 | 105 | 4 | 13 |
| F5 | 149 | 26 | 0 | 4 | 29 | 1 | 16 | 101 | 5 | 4 |
| F6 | 138 | 19 | 0 | 6 | 19 | 0 | 15 | 102 | 2 | 7 |
| F7 | 90 | 17 | 0 | 3 | 30 | 0 | 9 | 49 | 0 | 3 |

¹ Named features excluding exact Structure/Floor names and proposed access/circulation features. These **172 features are not confirmed rooms**; they still include furniture, departmental zones, and modeled fragments. One `Structure Stairs Base` feature is included in this descriptive name count but proposed separately as structural. Counts across these descriptive columns are not an additive partition.

² **99 features** need manual classification because of ambiguity/missing names or unresolved geometry meaning. Another 1,080 have name-supported but unverified proposals, and 431 carry the owner's provisional exact-Structure guidance. Thus 99 is the immediate ambiguity queue, **not a claim that the other features are fully verified physical spaces**.

There are **zero missing usable identifiers on every floor**, zero duplicate selected export IDs within each floor, and zero catalog search exclusions in these datasets. There are 55 repeated-name groups covering 1,476 features. A repeated name is neither proof of duplicate geometry nor permission to collapse features into one room.

Complete deliverables:

- [feature-inventory.csv](feature-inventory.csv): all 1,610 authoritative features, floor-qualified key, source IDs/row, original name/source, geometry type/parts/holes, calculated area, candidate category/subcategory, confidence, evidence, verification status, original heights/stack/color and footprint hash.
- [name-inventory.csv](name-inventory.csv): every normalized name per floor, original variants, multiplicity, IDs, footprint counts, heights and summed areas.
- [manual-review.csv](manual-review.csv): the 99 ambiguous/unresolved feature records for owner review; high-confidence proposals still require verification before use as an approved room schedule.
- [floor-inventory.csv](floor-inventory.csv) and [JSON](floor-inventory.json): counts and geometry statistics.
- [combined-crosswalk.csv](combined-crosswalk.csv): all 1,608 combined features and their exact/precision matches.

## B. Attributes, identities, and existing colors

Actual room-export fields:

| Source | Fields |
| --- | --- |
| F0 | `FID`, `FID_`, `Shape_Area`, `Shape_Leng`, `base_heigh`, `color`, `height`, `level`, `name`, `stack`, `z_values` |
| F1–F7 | `OBJECTID`, `Shape_Area`, `Shape_Length`, `base_height`, `height`, `level`, `name`, `stack` |
| F-ALL | `FID`, `OBJECTID`, `OBJECTID_1`, `Shape_Area`, `Shape_Leng`, `Shape_Length`, `base_heigh`, `color`, `height`, `level`, `name`, `stack` |

No room export contains `floor_id`, `room_id`, a functional category/type field, assignability, capacity, department, utilization, occupancy or verification metadata. `level` is populated and agrees with its individual source floor. `stack` is mostly a floor grouping such as Stack B; F0 even includes a `stairs` value, and F3 has three missing stacks. It is not a room-use taxonomy. Heights describe the modeled extrusions, not verified usable clearance, and they should not determine functional classification.

`buildFloorCatalog` constructs keys such as `/rooms-level-04-WGS.geojson#F4:OBJECTID:69`. Its preferred provenance order is OBJECTID, FID, FID_, top-level feature ID, then semantic ID alternatives; absent/repeated IDs receive a source-row suffix. Current files use unique OBJECTID or FID, so no row fallback is needed. Room numbers embedded in names can be retained as display/search aliases, but are incomplete and sometimes repeated among multiple components.

**Recommendation:** use the catalog key as the join key for this frozen dataset version. Also store source hash/version and footprint hash. For long-lived metadata, introduce an explicitly maintained UUID/crosswalk because export IDs, paths and row suffixes can change after a CAD/GIS re-export. Separate `feature_id` from a future reviewed `logical_space_id`; never assume one polygon or one name equals one physical room.

Color findings:

- F1–F7 have no raw `color` field. F0 has 132 nonblank colors and 16 whitespace-only values. F-ALL has 1,559 nonblank values, 49 whitespace-only values and 38 nonblank color strings.
- The application preserves Original Colors through source data plus `enrichMissingFeatureDisplayProperties`: same-floor bounding-box match, then name-frequency fallback, then legacy name rules. Those are presentation heuristics, **not verified classification evidence**. Do not use that color-enrichment path as an analytics identity join.
- `ROOM_FUNCTION_CONFIG` has `field: null`, empty provenance/categories/values. `getRoomFunction` requires an explicit field, provenance and valid mapping. Visual Controls deliberately disables Room Function when no verified categories exist; Uniform and Original are implemented.
- `IndoorBuilding.isFloorSurface` uses broad substring checks including `floor`. It therefore treats a name such as **3Rd Floor Rotunda** as a floor surface for display/legend purposes. This renderer heuristic must **not** be reused to classify open reading or background area. It was not changed during this audit.

Field completeness and values are in [attributes.json](attributes.json); whitespace-only values count as missing.

## C. Geometry and area assessment

### Existing method reused

The audit imports `createCorrespondenceIndex`, `createMetricProjection` and `intersectRows` from `src/utils/roomCorrespondence.js` without altering them.

- Authoritative room extent: longitude −89.2210913787 to −89.2198429729; latitude 37.7149416279 to 37.7156410927.
- A shared local **spherical Lambert azimuthal equal-area** projection is centered at approximately **[−89.2204671758, 37.7152913603]**, using radius 6,371,008.8 m.
- Coordinates are projected to meters before JSTS area calculations and `polyclip-ts` intersections/unions. Z and visual stack offsets are excluded. Areas are horizontal footprint m², not degrees², wall surface area, or sloping floor surface area.
- JSTS `IsValidOp` checks topology. Polygon/MultiPolygon rings and holes are retained. The existing positive-area tolerance is **1e−6 m²**. This removes numerical/boundary-only contacts; it is not a physical minimum-room-size rule.
- The audit adds same-floor bounding-box filtering and polygon union for diagnostics; it does not change the existing immediate-floor correspondence scope or caches.
- `routing/geometry.ts` also has local planar and Mercator helpers for navigation. Reuse the established correspondence equal-area path for area statistics rather than substituting routing/display projections.

This is suitable for consistent analytical footprints. It is not a survey-certified ellipsoidal measurement. Horizontal source accuracy, true boundary conventions and capture scale remain undocumented; avoid implying survey precision merely because calculations have many decimal places.

### Validity, parts, and duplicates

- Authoritative exports: **1,609 Polygons + one MultiPolygon**, all 1,610 valid, no holes, no rejected footprints. The MultiPolygon is an unnamed F3 feature with three parts.
- Combined display export: **1,607 Polygons + one MultiPolygon**, all valid, no holes.
- The 20 routing-derived polygons were also validated; together they contain 62 holes. They demonstrate why future geometry processing must retain holes even though the present room exports have none.
- No exact horizontal footprint-signature duplicates within an authoritative floor were found. This comparison ignores ring starting point/direction, part order and Z, but does not snap coordinates or remove redundant vertices.
- Three F1 Structure/Emergency Exit pairs overlap by **more than 99.99% of both footprints**, despite not being exact signature duplicates. These are near-coincident model features, not evidence that they should be silently merged.
- Across floors, equal XY footprints are legitimate stacked spaces. Deduplication must remain floor-qualified.

Validation of all 1,628 auxiliary polygons is recorded in [auxiliary-polygons.csv](auxiliary-polygons.csv). Pairwise intersections are in [same-floor-overlaps.csv](same-floor-overlaps.csv).

### Measured double-counting

The following are **diagnostic mapped footprints**, not gross building area, net assignable area, or approved room totals. Union is performed separately on each floor.

| Floor | Sum of all feature areas m² | Union of all footprints m² | Union of exact Floor surfaces m² | Other candidate sum³ m² | Other candidate union³ m² | Positive intersecting pairs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| F0 | 8,470.43 | 5,627.10 | 5,627.10 | 1,975.88 | 1,975.88 | 165 |
| F1 | 5,728.44 | 5,565.43 | 1,929.21 | 2,782.01 | 2,743.90 | 134 |
| F2 | 7,890.50 | 4,332.96 | 4,332.96 | 2,149.83 | 2,149.83 | 246 |
| F3 | 2,915.49 | 2,881.90 | 0.00 | 2,495.03 | 2,495.03 | 44 |
| F4 | 2,600.83 | 2,382.97 | 0.00 | 1,991.04 | 1,804.75 | 21 |
| F5 | 8,765.20 | 5,693.90 | 5,693.90 | 2,508.46 | 2,508.46 | 159 |
| F6 | 4,441.71 | 4,423.11 | 0.00 | 3,475.06 | 3,475.06 | 11 |
| F7 | 4,325.87 | 4,309.46 | 0.00 | 2,074.31 | 2,074.31 | 8 |

³ Excludes proposed structural, background and access/circulation categories. Still includes unclassified, mixed-use, equipment and unverified component footprints. These columns illustrate that those exclusions **alone do not create valid net-room totals**.

Summing every source feature gives **45,138.46 m²**; summing each floor's full-feature union gives **35,216.82 m²**. Neither is a certified building measurement. Even after the three broad category exclusions, sums remain **19,451.62 m² versus 19,227.22 m²** of union.

Important examples:

- F0 and F5 Floor surfaces contain their other mapped features. Adding them to room areas counts the same XY area again.
- F2's two Floor features sum to **5,095.76 m²** but union to **4,332.96 m²**, overlapping by **762.80 m²**.
- F4's two Library Conference 0480A polygons sum to **278.02 m²** with **136.69 m²** shared, so even identical function/name categories can double-count.
- F4 Help Desk overlaps Geospatial Resources by **37.67 m²**, almost the entire Help Desk footprint. Summing categories independently would allocate that patch twice.
- F1 has four John C Guyon Auditorium pieces totaling **254.41 m²**; F4 has three Group Study 0420D pieces of approximately **37.55, 0.26 and 0.89 m²**. Their room counts require a verified component-to-space mapping.
- Many other positive contacts are tiny numerical/sliver overlaps. The CSV preserves them; reporting should distinguish them from material overlaps rather than silently changing GIS precision.

### Definitions needed before allocation statistics

| Measure | What can be reported now | What is missing |
| --- | --- | --- |
| Gross mapped floor area | Explicitly labeled union of selected mapped footprints | Approved outer boundary, exterior-wall convention, void/shaft treatment, floor completeness |
| Net room area | Per-feature footprint area and proposed logical-space review | Verified room boundaries, component grouping, shared/overlapping room resolution |
| Assignable area | Not established | Owner-approved assignability policy and space records; restroom/circulation/structure exclusions alone are insufficient |
| Circulation area | Named access/stair/elevator footprint diagnostics | Corridor zones, stairwell grouping, floor/opening convention; route lines and buffers are not measured corridor boundaries |
| Structural/background area | Separate provisional footprints | Structural role and surface boundaries; must not be added to room totals or treated as load-bearing proof |
| Unclassified area | Count and explicitly labeled mapped footprint diagnostics | Geometry role and overlap resolution before use in an allocation denominator |

Do not present percentages of a nominal building area until the denominator is defined. A future exclusive allocation should split geometry into disjoint patches and assign each patch once, or show unresolved overlaps separately. Category unions alone still overlap across categories. Secondary tags must not create additional additive area totals.

## D. Classification assessment and taxonomy

This table is an **audit proposal**, derived from controlled exact-name annotations and supplied owner knowledge. Areas are raw candidate-feature sums, including overlaps and components. They must not be published as verified space allocation. High confidence describes the name's semantic signal, not boundary quality or physical room count.

| Proposed primary category | Candidate features | Candidate sum m² | Confidence and principal ambiguity |
| --- | ---: | ---: | --- |
| `study_learning` | 33 | 3,247.55 | 28 high, 5 medium; classroom/group/family names; lab/studio use needs review |
| `open_reading_study` | 9 | 555.87 | All low; Browsing Room, Group Study Space and Collaborative Space do not prove open-zone boundaries |
| `research_cultural_resources` | 11 | 653.36 | 7 high, 4 medium; distinguish faculty research, cultural resources, and special-collections reading |
| `auditorium_events` | 6 | 532.42 | 4 high, 2 medium; auditorium pieces and overlapping conference features |
| `library_services` | 13 | 1,454.24 | All medium; service fixtures, mixed offices, and student-support uses |
| `offices_administration` | 5 | 1,804.71 | All medium; department labels and publisher-office interpretation require confirmation |
| `collections_bookshelves` | 39 | 7,752.02 | 30 high, 9 medium; explicit Books/Journals/Folios versus inferred material formats/storage |
| `restroom_facilities` | 18 | 766.81 | High name evidence; review component grouping; exclude from study-room totals |
| `circulation_vertical_access` | 993 | 1,670.49 | 992 high, 1 low spelling case; mostly components, not rooms or unique connectors |
| `building_support` | 21 | 97.04 | 5 high, 16 medium; printer equipment, cafe pieces, lactation room have different geometry roles |
| `structure_non_occupiable` | 432 | 5,670.38 | 431 owner-guided exact names; one medium-confidence Structure Stairs Base |
| `floor_background` | 5 | 18,345.97 | High label evidence; occupiable use/boundary meaning unresolved for all five |
| `unclassified` | 25 | 2,587.59 | No defensible primary classification yet |

The 25 retained unclassified features are: nine unnamed; six Private Room; five Staff; and one each of University Honors (0181), Center for Teaching Excellence (0110), Hall Of Presidents And Chancellors, Staff Only, and 3Rd Floor Rotunda. Their names could support later investigation, but do not establish a single use. No unmatched feature was assigned to collections by default.

Recommended hierarchy:

| Primary category | Recommended subcategories |
| --- | --- |
| study_learning | classroom, group_study, family_study, instructional_lab, computer_lab, music_studio |
| open_reading_study | open_reading, open_study, collaborative_study; activate only for reviewed space zones |
| research_cultural_resources | faculty_research, faculty_writing, geospatial_resources, special_collections_reading, cultural_heritage, research_lab |
| auditorium_events | auditorium, conference, event_space |
| library_services | research_information, access_services, service_desk, student_support, mixed_service_office |
| offices_administration | administrative_office, staff_office, publisher_office |
| collections_bookshelves | book_collection, book_stacks, journal_collection, folio_collection, archives, special_format_materials, book_storage |
| restroom_facilities | restroom; optional access/gender labels retained as attributes/tags |
| circulation_vertical_access | staircase, elevator, ramp, entrance_exit, corridor; no ramp/corridor-room proposal was established here |
| building_support | storage, mechanical, utilities, print_equipment, food_service, wellbeing; mechanical/utilities remain prospective categories |
| structure_non_occupiable | modeled_structure, stair_base; load-bearing status requires separate evidence |
| floor_background | unresolved_floor_surface; never an alias for open study |
| unclassified | null subcategory or reviewed reason code |

Use **one primary category plus secondary tags**, with independent `geometry_role`, `logical_space_id` and tri-state assignability. A service counter can be library_services function with fixture geometry role; it should not be counted as a service room. A mixed service/office polygon can retain one reviewed primary category and a secondary office tag; do not invent a percentage split without sub-boundaries or documented allocations.

### Controlled evidence tiers

1. **Explicit evidence:** verified per-feature metadata or owner-approved IDs wins; record who/what supports it. Exact Structure/Structures guidance currently supports provisional non-occupiable treatment, not structural engineering conclusions.
2. **High-confidence names:** anchored, token-aware or explicitly reviewed exact-name rules for Group Study, Family Study, Classroom, restroom variants, stairs, Books, Journals and Folios. Preserve the original name. Return a proposal with rule version and evidence, not a silent confirmed classification.
3. **Ambiguous/mixed names:** Floor, Office, Lab, Writing Center, Geospatial Resources, Staff and unnamed components enter a review queue. Owner context can guide a candidate while retaining uncertainty. Keep explicit exclusions before generic terms: Special Collections Research Center Reading Room must not become ordinary book stacks, nor Research & Information Desk a research laboratory.
4. **Unclassified:** retain unknowns, missing names and conflicting evidence. No generic “everything else is books” branch.

Known source variants needing controlled alias review include `Groups Study 0580A`, doubled whitespace in `Group  Study 0550A`, `Srairs Area Upper`, `Stairs Case`, `Faulty And Staff Offices`, leading whitespace in basement ` elevator`, and spelling/capitalization variations of cultural-room names. Do not repair source labels as a side effect of classification.

### Service desk and open-space findings

- Danielle C. Baker Research & Information Desk (0161): **seven F1 polygons, 37.63 m² summed**, with individual areas from about 0.30 to 23.30 m² and modeled height 2. These are consistent with multiple modeled pieces, but available attributes cannot establish whether they are counters, enclosure, or service zone. Do not report seven service rooms.
- Help Desk: **one F4 polygon, 37.67 m²**, almost wholly within a Geospatial Resources polygon. Its extent cannot safely be added to the research zone without role review.
- Access Services (0130) & Offices: **one F1 polygon, 270.79 m²**, explicitly mixed by name. Neither office/service proportions nor a separate counter footprint are supplied.
- Writing Center: **one F2 polygon, 85.72 m²**; proposed student support, not automatically administration.
- Browsing Room: **four F1 polygons totaling only 11.27 m²**. Group Study Space: **four F6 polygons totaling 147.97 m²**; Collaborative Space: **one F6 polygon, 396.63 m²**. Open reading/study is a review hypothesis for these, not verified geometry semantics.
- No dedicated open-reading, circulation-zone or room-purpose field distinguishes Floor surfaces from public seating. Exact Floor is absent from the authoritative room exports for F3, F4, F6 and F7, despite floor-like polygons in routing/display sources. Background surface coverage is inconsistent across the dataset family.

## E. Metadata model and gaps

Start with a separately versioned **JSON sidecar keyed by catalog feature ID**, plus CSV import/export for owner review. This fits the existing static Vite/React data architecture; no database is necessary until collaborative editing, history, or external facilities synchronization is required. Do not modify original GeoJSON colors/coordinates to store analytics decisions.

| Field | Current availability / proposed source |
| --- | --- |
| feature_id, floor_id, source_dataset, source_export_id | Derivable from authoritative catalog; floor_id is a new normalized metadata field, not an existing room property |
| dataset_version, source_sha256, footprint_hash | Derivable; version/hash guards invalidate stale joins |
| original_name, geometry_type, area_m2 | Derivable; preserve names; attach projection/method/version and validation status to computed area |
| logical_space_id, component_of | Missing; owner-approved mapping of model pieces to spaces |
| geometry_role | Missing: room_boundary, zone, fixture, structural_component, stair_component, background, unknown |
| space_category, space_subcategory, secondary_tags | Proposed in this audit; only approved metadata becomes authoritative |
| assignable, include_in_room_count, include_in_area_total | Unknown by default (`null`), explicit policy/review required; exclude provisional structural/background pieces from occupiable totals |
| capacity, department | Not supplied; external records required; do not populate from guessed names or footprint-based formulas |
| classification_source, evidence, confidence, rule_version | Audit can record proposal origin; authoritative values require a provenance record |
| verification_status, verified_by, last_verified | No existing values; date/reviewer remain null until real verification, not the audit run date |
| overlap_resolution, allocation_policy_version | Missing; required for mutually exclusive category allocation |

Store both proposal and verified classification rather than overwriting the latter on every rule run. Approval should be reversible/versioned. Reject unknown IDs, duplicate metadata keys, invalid enum values, stale geometry/source versions, invalid capacities and missing approval provenance. Preserve unmatched F-ALL mappings as unresolved.

Advanced analytics requiring additional data: actual occupancy, temporal utilization, seating capacity, departmental ownership, maintenance condition, code occupancy classification, fire capacity, and accessibility compliance. Route accessibility preferences are navigation choices, not proof of regulatory compliance. No such statistics are inferred here.

## F. Existing code to reuse and integration approach

| Source / functions | Existing capability and proposed reuse |
| --- | --- |
| `src/utils/roomCatalog.js`: FLOOR_POLYGON_MAP, buildFloorCatalog, roomIdentifiers, createRoomCatalogStore | Authoritative sources, stable keys, cached/versioned loads, errors and complete snapshots |
| `src/hooks/useRoomCatalog.js` | One shared catalog subscription; loadAll with per-floor status. Building-wide analytics must show partial-data state until all required floors load |
| `src/utils/roomCorrespondence.js`: createMetricProjection, createCorrespondenceIndex, intersectRows | Metric area, validity, multipart handling, cached coordinates and per-floor bounds filtering |
| `src/workers/roomCorrespondence.worker.js`, `src/hooks/useRoomCorrespondence.js` | Worker/message lifecycle, invalidation and error patterns. Add analytics as separate derived work without changing immediate-floor behavior |
| `src/utils/roomCorrespondenceIdentity.js`: footprintSignature, exactAuthoritativeMatches | Conservative exact geometry identity; unresolved F-ALL reference handling |
| `src/utils/routeLabelIdentity.js`: routeFootprintSignature, linkRouteFeatureIdentities | Full-footprint matching at export precision; reuse cautiously for reviewed display links, never room-name deduplication |
| `src/utils/roomColors.js`, `roomColorConfig.js`, `components/VisualControls.jsx`, `RoomColorLegend.jsx` | Existing Original/Uniform/function modes and compact view-specific legend; future verified metadata can supply enriched immutable display properties or a resolver |
| `src/components/IndoorBuilding.jsx` | Existing color/highlight priority and continuous materials; avoid its broad floor-name heuristic for analytics |
| `src/App.jsx`: handleRoomSelect, authoritativeFeatures, correspondence state | Shared selection/floor navigation and sidebar integration; keep selection and camera behavior explicit |
| `RoomCorrespondencePanel.jsx`, `RoomAnalysisNarration.jsx`, `utils/roomAnalysisSummary.js` | Existing restrained cards/bars, accessible controls and provenance-aware summaries; do not change their overlap denominator or narration scope |
| `layers/roomCorrespondenceLayers.js`: correspondenceOverlayData, createCorrespondenceLayers | Provenance-aware transient analytical overlays; category highlighting must have independent state/IDs so it cannot erase selected overlap or route highlights |
| `routing/multiFloorRouter.ts`: buildVerticalConnectors / computeMultiFloorRoute; `utils/routeAnchors.js` | Stair/elevator connector evidence from graph anchors and geometry; useful review clues, never room-area or physical-space identity authority |
| `src/App.css`: main-content, left-panel, panel-card; `components/Map3D.jsx` | Existing full-height workspace, independent sidebar scroll and resize behavior; no layout/camera changes needed for a collapsible analysis section |

Recommended UI, not implemented:

- Add one collapsed **Space Analytics** section to the existing sidebar, with selected-floor/F-ALL scope, data-completeness and verification status.
- Begin with feature count, reviewed logical-space count when available, mapped footprint area, classified coverage, unclassified count and overlap warnings. Never label feature count simply “Rooms.”
- Use compact allocation bars with an explicit denominator and unresolved/unclassified segment. Comparison across floors must use the same inclusion policy and show incomplete-boundary status.
- Offer a compact floor comparison chart and category legend inside the section, not a large floating panel or a new footer.
- Category filters/highlights should be opt-in presentation state. Keep the route graph, label candidates, source coordinates and room-selection highlights intact. Use subdued category context beneath gold selection and route colors.
- Drill-down lists should show original names, floor, verified/proposed status and feature IDs where needed. Delegate room navigation to the existing selection handler; analytics expansion/filtering alone should not refit or rotate the camera.
- Reuse existing Night-mode base-color resolution for verified functional colors. Classification updates must not mutate source colors, shader paths or interior-light resources.

Immediate feasibility: feature counts by floor, per-feature footprint areas, feature-size ranking with role labels, provisional category counts/areas, unclassified review queue, and coverage/quality comparisons. Physical-room rankings, distribution of actual study/collection/service spaces and true function allocations become trustworthy only after identity/role and overlap review.

## G. Recommended implementation sequence and acceptance gates

1. **Approve taxonomy and metadata contract.** Confirm geometry roles, category definitions, treatment of mixed uses, denominator and what “room count” means. Review the 99 ambiguity records and the repeated-name/component cases. Obtain actual space boundaries where missing.
2. **Add sidecar metadata and validation.** Preserve source snapshots; join by catalog provenance, version and hash. Add logical-space/component mappings and reviewed F-ALL crosswalks. Keep uncertain records null/unclassified and maintain provenance/verification dates.
3. **Implement derived area service.** Reuse the metric preparation pipeline. Cache per dataset version and inclusion policy, off the main thread where needed. Separate per-feature sums, unions, disjoint category allocations and unresolved overlap area. Do not union across floor levels or silently erase invalid geometry.
4. **Build the collapsed analytics UI.** Clearly distinguish provisional versus verified figures, loaded versus missing floors, and feature versus physical-space counts. Export the same shared results shown in the UI.
5. **Integrate optional filtering and highlighting.** Connect verified categories to the existing function-color interface. Preserve original colors, search/route priorities, Above/Below selection, day/night timeline, label anchors and camera. Do not use unmatched combined geometry as an automatic metadata join.
6. **Run focused regression and performance verification.** Record real timings for preparation, per-floor aggregation, cached queries, filter interactions and memory before claiming performance gains. Expensive geometry work should run on data/policy changes, not camera frames or night-light animation.

Recommended test coverage:

- Full source/version/key coverage; duplicate names across and within floors; missing names; export reorder/re-ID migration; ambiguous/unmatched F-ALL links; stale sidecar handling.
- Controlled terms and precedence, including special-collections reading versus book stacks, service desk versus research, Office/Staff ambiguity, typos, exact Floor versus 3Rd Floor Rotunda, and no catch-all collections rule.
- Rectangle/hole/multipart/invalid-ring fixtures, edge-only contact, near-coincident footprints, tiny valid components, source immutability and area/union bounds. Compare with an independent trusted GIS calculation before claiming survey accuracy.
- Real F2 Floor/Floor, F4 conference/conference and Geospatial Resources/Help Desk overlaps; totals and denominators must not allocate shared area twice.
- Complete/partial/failed async loads and dataset replacement; invalidate analytics and matching caches without discarding active route/selection.
- F0–F7/F-ALL, room search, stair/elevator routes, preview playback, fixed-pixel labels, narration, analytical overlap highlights, Original/Uniform/function modes, both Night presets, reversible transitions, sidebar collapse and mobile workspace.
- Accessible charts/labels, keyboard drill-down, clear unknown states, no automatic camera fits on analytics filters, and attribution/control visibility.

## H. Limits and audit verification

The repository and all public GeoJSON sources were inspected. No facilities room schedule, CAD boundary specification, verified color legend, external metadata table, authoritative physical-space IDs, capacity records, or survey accuracy statement was supplied. These absences limit the meaning of otherwise valid geometry calculations.

No new production engine, metadata configuration, UI, rendering behavior or data correction was implemented. Exact-name annotations in `audit.mjs` exist solely to generate this review inventory; they are not imported by the app. The manual-review count is a triage aid, not a certification boundary.

The audit ran the real existing geometry utilities, validated all 3,238 inspected polygon features (1,610 authoritative plus 1,628 display/routing-derived), reconciled inventory/category counts, checked unique catalog keys, calculated same-floor intersections/unions, and verified SHA-256 equality for **170 protected source/data/config files** before and after execution. [integrity.json](integrity.json) records the hashes and [verification.json](verification.json) records the checks. No browser testing or production build is claimed for this inspection-only task; neither was necessary to change application behavior because none changed.

Reproduce from the repository root with `node docs/space-analytics-stage-1/run.cjs`. It bundles audit tooling into ignored `.tmp/` using the installed esbuild and writes reports only under this documentation directory. Review source hashes when comparing subsequent runs; proposed annotations and this narrative require re-review after dataset changes.

**Stage 1 is complete. Stop here and obtain approval/instructions before Stage 2 implementation.**
