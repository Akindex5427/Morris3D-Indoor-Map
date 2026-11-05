F0 read-only unclassified and potentially unallocated-area audit — 2026-10-29

The latest F0 export has **148 polygons**. **2 current polygons have unresolved function or geometry representation**, and **104 others have identity, range or membership questions with owner meanings retained**. Historical OBJECTID 139 is verified as **current FID 121, exact name `floor`, 5627.097546 m²**.

**Residual geometry, residual-area totals and a residual GeoJSON are withheld because the existing records do not establish a verified area-allocation mask or complete allocation rules.** This is an unknown result, not zero residual area. No existing feature is declared unallocated from its classification status. No area is automatically called circulation.

| Current FID | Temporary residual ID | Exact source name | Polygon area (m²) | Current interpretation | Reconciliation status | Unresolved reason | ArcGIS Pro inspection |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| 138 | — | <code> elevator</code> | 8.107295 | circulation_vertical_access / elevator / elevator_component | technical_review_required | Elevator identity and enclosed infrastructure use are supported; shaft versus car footprint is explicitly unverified. | Select source FID = 138 (preserve it in a separate SRC_FID field when importing; ArcGIS may generate a different ObjectID). Overlay the elevator plan and section. Check whether the boundary depicts the shaft or car, and verify its extent before any area allocation. |
| 139 | — | <code>Emergency Exit</code> | 15.857213 | circulation_vertical_access / entrance_exit / circulation_zone | unresolved_owner_review | Exact predecessor retained, but the owner statement does not resolve what this exit polygon models. | Select source FID = 139 (preserve it in a separate SRC_FID field when importing; ArcGIS may generate a different ObjectID). Compare the basement plan, doorway and threshold with the polygon extent and base_heigh/height. Determine circulation area, door/threshold component, or structural element; do not assign circulation from the label. |

The Elevator source name has a leading space, preserved in CSV/JSON. Emergency Exit's circulation category/role is only a candidate; its alternatives are circulation area, door/threshold component or structure. Elevator use is owner confirmed; shaft versus car representation remains unresolved.

The other 104 current questions comprise 96 stair components, three collection-range cases (FIDs 124, 130, 132), three journal-membership cases (129, 131, 136), Mechanical Room (146) and SCRC Stocks (147). The [full review table](F0-REVIEW.md) and [CSV](F0-REVIEW.csv) list every current case separately, with area, exact name, status, reason and ArcGIS Pro inspection action. They are not 106 unknown-use rooms. Forty-two polygons have reliably reconciled owner meanings: 29 structural polygons, two restrooms, seven collection zones, three collection fixtures and the floor background.

Footprint evidence

The complete XY boundary of F-ALL OBJECTID 139 uniquely and reciprocally matches current FID 121 using the project's established nine-decimal export precision. The individual floor's raw geometry also exactly matches Stage 2A FID 123 and preceding Stage 2B FID 122; retained secondary ID is FID_ 131. The current source bytes equal the latest inventory-refresh snapshot, and every current polygon exactly matches its retained preceding geometry. This is not a name, row-order or same-number ID join.

F-ALL calls OBJECTID 139 `Structure` with height 0.5; the authoritative individual export calls current FID 121 `floor` with height 0.2. These are known label/height discrepancies; the verified link concerns horizontal geometry. Current FID 139 is Emergency Exit. The former coincident Structure (preceding FID 96 / FID_ 105) is absent; current FID 96 is a different retained structural polygon. Full hashes and identity evidence: [FOOTPRINT-VERIFICATION.json](FOOTPRINT-VERIFICATION.json).

Potentially unallocated areas: separate assessment

The basement extent is established, but a reliable set difference requires an established allocation mask. The existing Stage 2B records explicitly mark all current count policies as `report-only owner intent; not imported or allocated`. The isolated formal metadata has zero approvals, zero approved relationships, null area-inclusion flags for all 148 historical F0 rows and an older source hash. The lack of a formal import alone does not invalidate owner testimony; the decisive gap is that the owner statements do not completely define current polygon inclusion, fixture treatment, stair projection, or overlap/allocation rules. They confirm functions and some count-once policies. Those are different from a spatial allocation mask.

Subtracting all 147 non-background polygons would silently accept pending identities/roles and fixture rules. Subtracting only the 41 non-background `owner_verified_matched` polygons would introduce another unapproved rule and leave known stair/collection/room geometries in the difference. Treating null flags as exclusions would falsely label the whole basement unallocated. None is adopted here.

The [148-row allocation-readiness ledger](F0-ALLOCATION-READINESS.csv) separately records each current polygon's whole area, area intersecting the verified footprint, reconciled meaning, and missing allocation status. These per-polygon intersections locate candidates within the basement; they are not a residual calculation and must not be summed as allocated floor area. No definitive uncovered portions or polygon-free residuals can be identified from the established allocation evidence. The residual area and piece count remain null in [RESIDUAL-LIMITATION.json](RESIDUAL-LIMITATION.json). No temporary residual IDs or placeholder residual geometries were fabricated.

The three unlocated owner statements (Center for Dewey Studies, Empty and distinct Journals 1995), plus one older retired Structure identity, remain separate in [F0-HISTORICAL-UNLOCATED.csv](F0-HISTORICAL-UNLOCATED.csv). They have no current FID or measurable current polygon area. In particular, the absence of an Empty polygon does not identify any residual as vacant space.

ArcGIS Pro review sequence

1. Import a working copy of the current GeoJSON and preserve its source FID in SRC_FID before relying on ArcGIS-generated ObjectIDs. Keep the source GeoJSON unchanged. Use exact source FIDs from these tables for selections.
2. Inspect FID 121 against the historical OBJECTID 139 boundary and owner plan; keep it as the extent, never an additional allocation. Inspect FIDs 138/139, then the collection/room bindings and stair groups using the per-row actions.
3. Establish the explicit allocation membership and rules: room and collection boundaries, fixtures, structural occupancy, stair component projection, elevator extent, and overlaps. Confirm whether any unlocated owner statements need independent geometries. An owner-confirmed function does not by itself resolve each inclusion rule.
4. Only after those rules are evidenced, union approved footprints, clip that union to FID 121, and subtract it from the footprint on a separate review copy. Do not sum overlapping polygons or treat the floor itself as an allocation. Retain holes and slivers with explicit review tolerances.
5. Split residual review pieces as needed and overlay them with all current non-background polygons. Record every overlapping original FID and overlap area; a piece may have multiple FIDs. Exclude the enclosing floor from representational matches. Where no existing non-background polygon represents a piece, use RESIDUAL-001, RESIDUAL-002, etc. Those are temporary review identifiers, never new source FIDs. Leave residual function unclassified pending plan inspection. Export that separate review layer as WGS84 GeoJSON only when the gate is satisfied.

Classification provenance and validation

The formal metadata still says unclassified/unknown for its historical F0 rows, but its old FIDs must not be joined directly to the current export. This audit follows proven predecessor geometry for 146 retained rows; the two added room polygons have no formal predecessor metadata. Owner-confirmed meanings in the current Stage 2B records are preserved separately. Thus stale technical placeholders do not turn all 148 polygons into unresolved real-world functions.

Areas were recomputed with the existing project spherical Lambert azimuthal equal-area method at origin [-89.22042322309318,37.715287983070255], using full rings and holes. Source Shape_Area units are not assumed to be m². All 148 current geometries passed validity checks; the maximum difference from the refreshed inventory areas was 0 m². Areas in this audit are whole polygons unless a column explicitly says intersection with the footprint; no authoritative allocated or residual total is reported.

SHA-256 checks cover 1011 pre-existing workspace files, including all source GeoJSON, application code, owner records and earlier audits. They are unchanged. New files are confined to this report directory. No approvals, classifications, FIDs or application behavior were modified. No application build/browser tests were needed for this report-only task.

Reproduce from the repository root with `node docs/space-analytics-stage-2b-f0/unclassified-residual-audit-2026-10-29/run-audit.cjs`. This audit is pinned to the verified source/record snapshots and fails if they change. [SUMMARY.json](SUMMARY.json) and [VALIDATION.json](VALIDATION.json) contain machine-readable results.
