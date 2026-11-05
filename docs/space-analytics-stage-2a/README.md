# Stage 2A: classification metadata and spatial relationships

**Historical dataset version:** F6 and F-ALL were subsequently re-exported. F6 inventory, classification and spatial-review records here are superseded by the [targeted synchronization report](../f6-geometry-sync/README.md) and its explicit record ledger. Original artifacts remain for audit. Use `data/space-analytics/current.json` for the current isolated sidecar. The owner's later F4 confirmations are retained there without changing any prior classification decisions. The original `generate` command intentionally rejects these changed source hashes; use `node scripts/f6-synchronize.cjs` for the targeted update.

Completed October 27, 2026. This implementation is isolated from production rendering. It adds an offline metadata pipeline, geometry analysis, review exports, a validated approval importer, and an opt-in worker entry. It does not activate classifications or build an analytics dashboard.

All 1,610 authoritative F0-F7 features have their existing floor-qualified catalog identities. **Zero classifications, logical spaces, or functional parents are approved.** Geometry roles, functional classifications, logical membership, and hierarchy remain separate concepts. Unknown information remains null or explicitly unknown/unclassified.

Start owner review with [REVIEW-SUMMARY.md](REVIEW-SUMMARY.md), [priority classifications](priority-classification-review.csv), [spatial pairs](spatial-relationship-review.csv), and [component groups](membership-review.csv). The [data dictionary](DATA-DICTIONARY.md) explains the fields and approval format.

## Source authority and preservation

Inputs are the eight individual-floor files registered by `FLOOR_POLYGON_MAP` in `src/utils/roomCatalog.js`. Counts are F0 148, F1 355, F2 243, F3 288, F4 199, F5 149, F6 138, F7 90. F-ALL's 1,608 features are display geometry, not additional room inventory.

The loader calls the existing `buildFloorCatalog`. IDs retain source path, floor, export-ID field and export-ID value; none uses a room name as identity. The dataset version hashes the authoritative source manifests plus the combined display-source hash. Metadata also retains each source SHA-256 and footprint hash. Re-exported sources require a new version and reviewed migration; this implementation does not silently migrate IDs or decisions.

The existing nine-decimal full-footprint matching produces 1,473 unique F-ALL links and **135 unresolved display features**. All unresolved rows are flagged by validation, and no authoritative metadata is assigned to them. Matching is independent of row order and name. A footprint link is not certification of a physical facilities-space identity.

[start-hashes.json](start-hashes.json) records 170 pre-existing source, public-data and configuration files at the start of Stage 2A. Generation checks their SHA-256 values before and after analysis: **zero changed**. These include all 51 public GeoJSON files. Earlier uncommitted work is preserved. No application entry point imports the new modules, and no package dependency or existing source file was edited for Stage 2A.

## Geometry method

`prepareSpatialDataset` reuses `createCorrespondenceIndex` from `src/utils/roomCorrespondence.js`: authoritative WGS84 XY coordinates are projected to the existing local spherical Lambert azimuthal equal-area plane, centered on the dataset origin. All floors share this metric plane. JSTS validates topology and measures polygon area; the existing `intersectRows` uses polyclip-ts for actual polygon intersections. No screen coordinates, extrusion heights, stack offsets, or source `Shape_Area` values enter the area calculation.

`compareMetricRows` adds JSTS DE-9IM topology predicates, intersection ratios and seven relationship types. Polygon holes and multipart geometries are handled by the libraries. Invalid or negligible geometry is excluded with explicit diagnostics; geometries are never repaired or rewritten silently. The current authoritative dataset has no geometry issues or failed pairs.

| Relationship | Rule |
| --- | --- |
| `contains` / `within` | Directional JSTS covers/covered-by; inclusive containment permits coincident boundaries. These names do not require strict interior-only containment. |
| `near_contains` | Smaller polygon coverage at least 99.5%, with uncovered area no greater than 0.05 square meters; exact coverage has already failed. |
| `partial_overlap` | Positive intersection that does not satisfy containment/coincidence. Tiny interior contacts remain diagnostic slivers. |
| `near_coincident` | Intersection-over-union at least 99.5% and symmetric difference no greater than 0.1 square meters; includes exact equality and takes precedence over containment. |
| `boundary_touch` | JSTS point/edge-only contact, with no meaningful interior intersection. |
| `disjoint` | Separated bounds or a topologically disjoint candidate. |

Numerical area epsilon is `max(1e-6, min(areaA, areaB) * 1e-8)` square meters. The reused intersection helper returns null for areas at or below its 1e-6 square-meter floor; topology still distinguishes tiny interior contacts from boundary-only contacts. Their reported intersection is zero, and their significance is `numerical_sliver`, not a meaningful compartment. A separate 0.05-square-meter review threshold keeps small overlaps out of the principal review queue without deleting diagnostics.

Metrics are `intersection / areaA * 100`, `intersection / areaB * 100`, smaller-footprint containment `intersection / min(areaA, areaB)`, and IoU `intersection / (areaA + areaB - intersection)`. Ratios are clamped to [0,1] against numerical overshoot. Values do not represent assignable area, occupancy, connectivity or ownership.

## Results and performance

The min-X sweep and inclusive XY bounding-box filter reduced **188,629 possible same-floor pairs to 2,328 candidates**. The other 186,301 are provably disjoint by bounds and recorded as a count rather than hundreds of thousands of rows. [spatial-diagnostics.json](spatial-diagnostics.json) retains every candidate, all tolerances, the projection origin, issues and processing statistics.

| Candidate relationship | Pairs |
| --- | ---: |
| Contains | 574 |
| Within | 122 |
| Near containment | 25 |
| Near coincidence | 3 |
| Partial overlap, including numerical contacts | 94 |
| Boundary touch | 125 |
| Disjoint after detailed test | 1,385 |

There are 788 intersections above the numerical floor: 724 material and 64 small overlaps, consistent with Stage 1. Another 30 numerical interior contacts remain diagnostic only. The review queue contains **43 pairs: 38 same-name overlaps, four substantial structural/access conflicts, and one possible functional parent**. The 2,208 background/structural/access diagnostic rows are kept separately. Floor surfaces never automatically become functional parents.

`createSpatialRelationshipService` caches prepared polygons and analyses by dataset version and tolerance configuration: at most two dataset versions and four configurations per version. It rejects reusing a version for different data. Pair identities use algorithm-version prefix plus canonical, floor-qualified feature IDs. Geographic preparation occurs only on explicit service calls, never during camera movement, animation, or Day/Night updates. `clear()` releases cached references. The opt-in worker accepts request IDs, returns explicit errors, and retains the same cache; the live application does not construct it.

The saved offline generation run measured 210.65 ms for existing-index preparation and 5,448.77 ms for pair analysis on this machine. Preparation timing is the existing helper's measurement and excludes the additional cached JSTS-object construction. These are single-run observations, not a benchmark or an improvement claim. UI frame times were not measured because no runtime behavior was changed. Dataset registration also serializes inputs to detect stale-version reuse; callers should register on source changes, not render frames.

## Named examples

Detailed feature identities, source heights, gaps and intersections are in [named-examples.json](named-examples.json).

| Case | Observed geometry | Review proposal, not approval |
| --- | --- | --- |
| F4 Help Desk / Geospatial Resources | Help Desk OBJECTID 7 is 37.671464 square meters; 37.671459 intersects Geospatial OBJECTID 4 (64.123235 square meters), covering 99.99998685% of the desk and 58.74853% of the larger polygon. Classified `near_contains`; the other two Geospatial pieces only touch the desk. | Possible functional parent: Geospatial feature 4, child feature 7. Owner must distinguish service fixture, compartment and functional zone before establishing logical spaces and approving a parent. |
| F1 Baker Research & Information Desk | Seven distinct IDs 17-23; sum of feature areas 37.62817 square meters, modeled height 2. All seven form one proximity-connected group, with pair distances ranging from zero to 6.57909 meters. | Candidate shared counter/service-space membership. Names, geometry and height do not establish whether these are counter parts, room fragments or service-zone boundaries. Never count seven service rooms. |
| F1 John C Guyon Auditorium | Four IDs 271, 273, 274, 275; summed feature area 254.40633 square meters, height 4.5. One proximity-connected group; minimum gap 0.08966 meters. ID 275 contributes 83.07% of summed area. | Candidate four-component logical space. Preserve the four source features and review ancillary pieces. |
| F4 Group Study 0420D | IDs 69/70/71 measure 37.547564 / 0.260453 / 0.890813 square meters, height 2. ID 69 supplies 97.025% of summed feature area; the three form a proximity-connected group. | Primary footprint plus two minor modeled pieces; owner decides component roles and membership. |
| F4 Library Conference 0480A | IDs 60/61 measure 136.694527 / 141.320494 square meters. Their intersection is 136.694527, 100% of the smaller and 96.72661% of the larger. | Same-name nested footprints need modeling-role review. Propose grouping only; do not merge or infer a parent. Summed feature area 278.015021 would double-count overlap. |
| F0 / F2 / F5 Floor surfaces | F0: 147 containment-direction pairs. F2: 242 containment-direction pairs plus 74 disjoint candidates; its two Floor surfaces overlap by approximately 762.804 square meters. F5: 148 containment-direction pairs. | Background geometry is retained, with no proposed functional parents. Generic Floor does not establish open study or reading use. |

Grouping uses same-floor normalized specific names, contact/proximity of at most 0.5 meters, and matching source base/height attributes. Connected groups can have distant endpoints through intermediate members. Generic names are excluded. Shared name or compatible modeled height alone never creates membership. No feature union, subtraction, deletion or physical-room count occurs.

## Classification and owner decisions

The controlled taxonomy has 11 geometry roles and 13 functional categories. Proposals use the Stage 1 exact-name rules and limited explicit room-number/name variants. All carry evidence and confidence. Actual categories remain unclassified and actual roles unknown until approval. Functional role alternatives remain visible for ambiguous fixtures/zones.

Proposed category counts: circulation/access 993, structures 432 (431 exact Structure/Structures plus stair-base structure), collections 39, study/learning 33, unclassified 25, building support 21, restrooms 18, library services 13, research/cultural resources 11, open reading/study 9, auditorium/events 6, floor background 5, offices 5. These are feature proposals, not room counts. Missing names and unmatched names remain unclassified; no books fallback exists.

The full classification review has 189 grouped rows, including 127 priority rows. Grouping by floor, normalized name and proposed role/category is a review convenience. Split a row when members require different decisions. The 13 membership investigations are separate from these classification rows.

Owner approval is required for:

- Geometry roles and all functional classifications, including high-confidence name proposals.
- Whether a feature contributes to physical-room counts, area totals, or assignable space; null means undecided, not false.
- Actual logical-space IDs and component memberships, especially the named examples above.
- The Help Desk's functional hierarchy, separately from its measured containment.
- Conference duplicate-looking footprints and structural/access conflicts.
- Floor/background exclusions and any open-reading boundaries.
- The 25 unclassified features and unresolved combined-display mappings.

Review CSVs are UTF-8 with BOM, quoted cells, JSON arrays for IDs and formula-trigger escaping for spreadsheet safety. Edits to CSVs are review notes only. Approved decisions must be expressed in the explicit JSON format below; they are not automatically scraped or activated.

## Approval import and rollback

Start from [approval-template.json](approval-template.json). It intentionally contains no decisions or invented reviewer/date. Fill it with actual owner decisions, preserving its dataset version and matching the current metadata revision. An empty batch cannot be imported.

Each decision requires a unique `approval_id`, `decision`, `target_id`, exact `approved_values`, `reviewed_by`, ISO `reviewed_at` including timezone, and written `evidence`.

- `approve_classification`: target is an existing feature ID. Values must explicitly include `geometry_role`, `space_category`, `space_subcategory`, `secondary_tags`, `assignable`, `include_in_room_count`, `include_in_area_total`. Unresolved inclusion flags may remain null.
- `approve_membership`: target is a new owner-provided logical-space ID, not an invented identifier generated by analysis. Values are `floor_ids`, `feature_ids`, `cross_floor_evidence` (null for ordinary single-floor membership). Every source feature remains intact.
- `approve_parent`: target is an already approved child logical-space ID. Values are `parent_space_id` and `cross_floor_evidence`. Membership decisions must appear before parent decisions in a combined batch. Cross-floor parentage requires explicit evidence. Geometric feature IDs in review proposals are never silently treated as logical-space IDs.

Run from the repository root:

```powershell
node scripts/space-analytics.cjs generate
node scripts/space-analytics.cjs import data/space-analytics/metadata.proposals.v1.json owner-approvals.json data/space-analytics/metadata.approved.r1.json
node scripts/space-analytics.cjs restore data/space-analytics/metadata.approved.r1.json data/space-analytics/metadata.proposals.v1.json data/space-analytics/metadata.restored.r2.json restore-review.json
```

`restore-review.json` supplies the real `reviewed_by`, `reviewed_at` and `evidence`. Import validates the entire cloned result atomically before writing a **new** JSON file; existing output files and public-data output paths are refused. Invalid batches leave input metadata unchanged. Revisions and approval history support audit and reversal. Restoring an older snapshot creates a new revision and records its origin; retain prior revision files to preserve all approval records. Replacing existing memberships/parents requires an explicit reviewed restore followed by new decisions, not a silent reassignment.

The importer validates evidence and consistency; it does not authenticate reviewer identity or provide cryptographic signatures. No owner decision has been imported in this implementation. Generation refuses to replace a proposal file containing approved records. After approval, keep the approved snapshot separate; regeneration remains an unapproved draft process.

## Validation and verification

Semantic validation checks complete/unique feature inventory, enum/subcategory rules, source and footprint hashes, dataset versions, exact approval payloads and provenance, null unknowns, non-room counting contradictions, unique memberships, missing targets, parent cycles/self-links/multiple parents, unsupported cross-floor relationships, background parentage, pending proposal status, and F-ALL crosswalk integrity. The JSON Schema describes structure; `validateMetadata` with the current source context is required for referential and semantic validation.

- **38 Stage 2A tests passed**: synthetic containment, near containment, partial/coincident polygons, holes, multipart geometry, boundary contacts, disjointness, invalid polygons, cache/version behavior, worker messages, real-data examples, metadata failures, atomic approvals and restore.
- **Full suite: 311 tests, 300 passed, 11 failed.** The same 11 failures appear in `docs/workspace-layout/unit-tests.json`: nine routing-anchor/name tests and two missing-color enrichment tests. There are no new failures relative to that recorded baseline. This is not a claim that the full suite is green.
- **Production build passed**. Existing large-bundle warnings remain.
- **170 protected files unchanged**, including all 51 public GeoJSON files. The final check also found no imports of Stage 2A from existing application code and no Stage 2A modules in production source maps. See [final-integrity.json](final-integrity.json), [summary.json](summary.json), [checks.json](checks.json), [unit-tests.json](unit-tests.json), [unit-execution.log](unit-execution.log), and [build.log](build.log).
- No new browser session was used for Stage 2A; no visual/runtime behavior changes or browser-performance improvements are claimed. Worker handler logic is tested directly; actual browser worker lifecycle remains untested until integration.

Reproduce the full checks with `node review/space-analytics-stage2a-checks.cjs`. It compares exact failing test names to the saved workspace-layout baseline and returns failure for new test failures or a failed build.

## Files added

- `src/spaceAnalytics/schema.js`, `proposalRules.js`, `proposals.js`, `relationships.js`, `metadata.js`, `spatialRelationships.worker.js`, `relationships.test.js`, `metadata.test.js`.
- `scripts/spaceAnalyticsContext.mjs`, `spaceAnalyticsArtifacts.mjs`, `space-analytics.cjs`.
- `review/space-analytics-stage2a-checks.cjs`.
- `data/space-analytics/metadata.schema.json`, `metadata.proposals.v1.json`.
- This documentation directory: report/dictionary, review CSVs, detailed JSON diagnostics, snapshot hashes, approval template, test/build logs and verification results.

No existing application files were modified by this stage. Stage 2A ends here; production activation and subsequent analytics stages await owner review.
