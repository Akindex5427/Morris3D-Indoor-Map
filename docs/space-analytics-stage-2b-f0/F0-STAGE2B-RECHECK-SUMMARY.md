> Historical full-audit snapshot. See [LATEST-REFRESH.md](LATEST-REFRESH.md) for the latest F0 inventory and queue. This full report was not rerun.

# Corrected F0 re-audit and Stage 2B reconciliation

**F0 is not ready for Stage 2B closure.** This regenerated audit uses the corrected 149-feature individual export, not the mistaken 140-feature upload. The named collection footprints are present again. Reports only were generated; source data, existing owner records, schema, and application behavior were preserved. No F1 audit, Stage 3 area engine or dashboard was started.

## Results

| Measure | Result |
| --- | --- |
| Current F0 polygons | 149 |
| Added polygon records/footprints versus Stage 2A | 2 |
| Removed prior footprint | 1 |
| Strict predecessor matches | 147 |
| Proven FID changes | 74 |
| Changed geometry among strict predecessor matches | 0 |
| Reliably reconciled owner-verified current features | 42 |
| Owner-confirmed meaning, identity or membership pending (current) | 104 |
| Current unresolved functional classifications | 1 |
| Additional technical role/representation reviews | 2 |
| Historical identity pending | 1 |
| Unlocated owner statements | 3 |
| F0/F-ALL inconsistent source records/pairs | 58 |
| Stage 2B closure | Not ready |

The 42 reliably reconciled current features comprise 29 structural footprints, two restrooms, one floor background, and ten collection/fixture footprints. They are excluded from the owner-verification queue. “Owner verified matched” is a report reconciliation status, not a new metadata approval event.

The 104 current identity/membership cases comprise **96 stair components**, **six collection-range/grouping cases**, and **two new room bindings**. Their broad functions are already confirmed; this does not mean 104 unknown uses or 96 separate staircases. The 96 stair components need association with the owner's Stair 1 (open), Stair 2 (enclosed), and Stair 3 (enclosed). One marked plan assigning components can resolve that grouped review. Three journal-range polygons are not automatically counted as three independently verified logical zones.

The one unresolved functional/geometry-role classification is Emergency Exit, current FID 140: circulation area, door/threshold component or structural representation. Two additional technical reviews concern Structure FID 96 versus the Mechanical Room, and Elevator FID 139 (shaft versus car). The missing historical Structure and unlocated Center for Dewey Studies, Empty and distinct Journals 1995 statements remain separate from current feature totals. Verified owner functions are preserved for all three unlocated statements.

## Source provenance and change evidence

- Authoritative F0: public/rooms-basement-WGS.geojson, mapped by FLOOR_POLYGON_MAP[0] in src/utils/roomCatalog.js. Current SHA-256: 9be596896c68c09320b932f48dfd42c8880892547847967f1bca268f7b4e9011.
- F-ALL: public/rooms-all-WGS-v6.geojson. SHA-256: 31309b325db7b8e378d909ae8facfbbe0005a290021f10cc262f08fc5d2945be; unchanged from the prior conversation's audit.
- Stage 1: docs/space-analytics-stage-1/feature-inventory.csv and audit.mjs.
- Stage 2A metadata: data/space-analytics/metadata.proposals.v1.json. Its recorded F0 source hash (20b36e5d76af03730889b4fbc6f2d4b779aca17258ebdabd0dee8ce1dca11085) exactly matches the historical Git snapshot saved as baseline-F0.geojson.
- Stage 2A spatial and membership proposals: docs/space-analytics-stage-2a/spatial-relationship-review.csv, spatial-diagnostics.json, membership-proposals.json and membership-review.csv.
- Current isolated metadata pointer: data/space-analytics/current.json; metadata.f6-sync.v1.json preserves the separate F6/F4 work. Its F0 source version predates this corrected file. No F0 formal approvals were found; owner assertions for this task are preserved in OWNER-REQUEST.txt and F0-OWNER-STATEMENTS.json.
- Review/import workflow: scripts/space-analytics.cjs and src/spaceAnalytics/metadata.js; docs/space-analytics-stage-2a/approval-template.json and DATA-DICTIONARY.md. A future import needs explicit decisions, reviewer/date/evidence and a matching dataset revision. No import or schema change was performed.

Full-footprint matching establishes 147 predecessors; their raw geometry and non-identifier attributes are unchanged. Of these, 74 have different FIDs. The retained secondary FID_ values and full-footprint matches support the crosswalk; current FIDs must not be joined directly to old FIDs. Old FID 73 / FID_ 81 (structure) is absent; current FID 73 is a different retained staircase component. The two new footprints have FIDs 147/148 and previously absent FID_ values 156/157. They are added modeled polygons; this does not mean two newly constructed physical rooms. No edit lineage is inferred between the removed structure and the two additions.

## New rooms and important overlap

| Exact current ID | Exact source name | Area m² | Owner intent retained |
| --- | --- | --- | --- |
| /rooms-basement-WGS.geojson#F0:FID:147 |  Mechanical Room (No Access) | 397.393537 | 1 enclosed room; 1 logical space; area once |
| /rooms-basement-WGS.geojson#F0:FID:148 | SCRC Stocks (Staff Only) | 457.084198 | 1 enclosed room; 1 logical space; area once |

Mechanical FID 147 nearly coincides with existing Structure FID 96: **99.999978% IoU**, intersection **397.393452 m²**. Structure FID 96 is the unchanged predecessor of old FID 97. Both current polygons remain present and fail strict equality, so the Mechanical Room must not be described as a simple rename of a removed polygon. Resolve the modeled role of Structure before allocated area is computed; do not merge, delete or count both automatically. “No Access” retains the owner's explanation that no entrance is shown on the plan, not a claim that no physical entrance exists.

SCRC is spelled **Stocks** in the corrected source, rather than the owner's **Stacks**. The footprint and ID are reported as the candidate binding without silently correcting the label. Both new rooms lack strict F-ALL identity. Their owner-requested count policies are retained, but no production counts or allocation are activated.

## Geometry, spatial relationships and counting safeguards

All 149 current polygons, 143 F0 display polygons and the historical baseline pass topology preparation; no geometry calculation failed. Areas use the existing local spherical Lambert azimuthal equal-area projection in meters, followed by polygon area/intersection operations. The shared origin is recorded in F0-GEOMETRY-DIAGNOSTICS.json. Source Shape_Area is preserved without assuming square-meter units; some named polygons store zero there despite having positive computed area.

There are 168 positive-area same-floor pairs above 1e-6 m², including expected background containment; 1 near-coincident pair and no exact duplicate current footprints. Full material-overlap and containment diagnostics are in F0-SPATIAL-RELATIONSHIPS.csv. Inventory rows list geometric container/child candidates and pair references. Geometry containment is not an approved functional parent. logical_space_id, component_of and parent_space_id remain null. Floor FID 122 is background and must not be added to the areas it contains. No residual circulation or elevator-lobby polygon was invented, and no area engine ran.

## Taxonomy compatibility

| Requested category / subcategory | Recommendation |
| --- | --- |
| building_services / mechanical_equipment_room | Existing building_support / mechanical, preserving room_boundary and the owner meaning; alternatively an explicitly approved schema extension. |
| collections_bookshelves / restricted_collection_stacks | Existing collections_bookshelves / book_stacks with staff_only access metadata; alternatively an explicitly approved new subcategory. |
| research_special_services / specialized_research_center | Closest existing category research_cultural_resources; approve a specialized_research_center subtype. Do not silently substitute research_lab. |
| vacant_unassigned / unused_space | Explicit schema extension recommended. unclassified is only a temporary technical state, not the owner-confirmed meaning. |

All requested geometry roles exist. The unsupported owner terms remain explicitly flagged as report proposals, not silently imported enum values. Function, geometry role, physical-room count and logical membership remain separate fields. Existing owner classifications are not overwritten.

## First ten unresolved cases, ordered by priority

| Priority | Exact current ID | Exact source name | Verification question |
| --- | --- | --- | --- |
| 1 | /rooms-basement-WGS.geojson#F0:FID:96 | structure | This structure nearly covers the Mechanical Room footprint. Is it a slab/background representation or physical structural material? Confirm its role so the same area is not counted twice. |
| 1 | /rooms-basement-WGS.geojson#F0:FID:125 | dewey books 551 to 882 | The source range is 551 to 882; your confirmed range is 551–823. Which range is intended for this exact footprint? |
| 1 | /rooms-basement-WGS.geojson#F0:FID:130 | journals 1995 & older a to f | Does this journal-range footprint belong to one shared Journals 1995 & Older logical area, or a separate verified zone? Identify which footprint, if any, represents Journals 1995. |
| 1 | /rooms-basement-WGS.geojson#F0:FID:131 | oversized journal a - f | The source range is A–F; your confirmed range is A–D. Is this the same intended zone, and which range is correct? |
| 1 | /rooms-basement-WGS.geojson#F0:FID:132 | journals 1995 & older f to i | Does this journal-range footprint belong to one shared Journals 1995 & Older logical area, or a separate verified zone? Identify which footprint, if any, represents Journals 1995. |
| 1 | /rooms-basement-WGS.geojson#F0:FID:133 | oversized journals f - h | The source range is F–H; your confirmed range is E–H. Is this the same intended zone, and which range is correct? |
| 1 | /rooms-basement-WGS.geojson#F0:FID:137 | journals 1995 & older j to z | Does this journal-range footprint belong to one shared Journals 1995 & Older logical area, or a separate verified zone? Identify which footprint, if any, represents Journals 1995. |
| 1 | /rooms-basement-WGS.geojson#F0:FID:139 |  elevator | Does this polygon depict the elevator shaft or the car footprint? |
| 1 | /rooms-basement-WGS.geojson#F0:FID:147 |  Mechanical Room (No Access) | Confirm this new Mechanical Room polygon is the enclosed equipment room you described. Its nearly coincident Structure polygon also needs a distinct non-double-counting role. |
| 1 | /rooms-basement-WGS.geojson#F0:FID:148 | SCRC Stocks (Staff Only) | Confirm SCRC Stocks (Staff Only) is the staff-only Stacks room you described, and whether Stocks is a label typo. |

The remaining queue includes Emergency Exit, old removed Structure FID 73, three unlocated owner statements and the grouped staircase assignment. Exact raw source names, including leading spaces, are preserved in CSV/JSON. The queue has 111 rows (107 current + 1 historical + 3 unlocated statements).

## Deliverables and verification

- [F0-LATEST-INVENTORY.csv](F0-LATEST-INVENTORY.csv): 149 current features.
- [F0-STAGE2B-RECONCILIATION.csv](F0-STAGE2B-RECONCILIATION.csv): 153 records. reconciliation_status distinguishes owner_verified_matched, owner_verified_identity_pending, unresolved_owner_review and technical_review_required; lifecycle_status separately identifies new_feature and retired_feature, preserving both concepts.
- [F0-UNRESOLVED-VERIFICATION.csv](F0-UNRESOLVED-VERIFICATION.csv): 111 unresolved records with questions, alternatives and priorities.
- [F0-FALL-CONSISTENCY.md](F0-FALL-CONSISTENCY.md): 26 missing strict links, 20 extra/unmatched display records, 12 height-discrepant proven pairs and 3 label differences already among those pairs. These 58 source discrepancies are not 58 rooms.
- This summary, plus supporting JSON, strict crosswalk, spatial diagnostics and [F0-TAXONOMY-COMPATIBILITY.csv](F0-TAXONOMY-COMPATIBILITY.csv).

Reproduce using node docs/space-analytics-stage-2b-f0/run-audit.cjs. [F0-VALIDATION.json](F0-VALIDATION.json) records focused audit checks and hashes for all 892 pre-existing protected files. Browser tests and a production build were not run for this read-only report task.

The prior 140-polygon audit findings are superseded by this corrected-source report; see [SUPERSESSION.md](SUPERSESSION.md). No prior owner-verification records were removed or changed. Existing F4 decisions and separate F6 requirements are preserved.

