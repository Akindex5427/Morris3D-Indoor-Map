# F6 geometry synchronization and owner F-ALL assessment

**Latest replacement check:** both exports are valid and heights agree. The partitions now differ by approximately 0.13 mm, 0.13 mm, 2.8 mm and 3.8 cm; Collaborative Space differs by about 6.9 cm. This is improved, but none of the five pairs passes the existing exact-footprint identity rule. See [LATEST-RECHECK.md](LATEST-RECHECK.md). The synchronization details below and earlier images are historical snapshots.

The revised F6 file and the owner's replacement F-ALL export are the files selected by the application's current source configuration. **Both owner exports have been preserved unchanged.** Inventory, provisional metadata, spatial relationships and review status have been updated. Cross-export geometry synchronization remains unresolved for five footprints; no approximate matches were promoted to authoritative identity links.

## Active sources and changes

`src/utils/roomCatalog.js` maps F6 to `public/rooms-level-6-WGS.geojson` and F-ALL to `public/rooms-all-WGS-v6.geojson`. `App.jsx` loads those paths for individual-floor and combined views. The catalog caches parsed floors in memory, so an already-open browser tab must be refreshed after replacing a file. Repository configuration and build assets were checked; no browser rendering session is claimed.

| Dataset | Change from Stage 2A |
| --- | --- |
| F6, still 138 features | Removed OBJECTIDs **137-140**; added **147-150**, all named Group Study Space. |
| F6 Collaborative Space 146 | Footprint and other properties unchanged; **height changed from 0.3 to 4**. This additional change was detected rather than assuming only four features changed. |
| Other F6 source features | **133 unchanged**. |
| Owner F-ALL, now 1,609 features | Removed display OBJECTIDs **1508-1511**; added partitions **1609-1612** and Collaborative Space **1613**. F6 display count is now 139. |
| Retained F-ALL features | All **1,604 retained feature objects unchanged**, including every feature on unrelated floors. No retained feature was merged, deleted or recolored by the tooling. |

The old F6 snapshot was recovered from Git and its byte SHA-256 verified against Stage 2A before comparison. The complete [changes.json](changes.json) records old/new features and property differences. [summary.json](summary.json) records dataset versions and hashes:

- Old F6: `f565b07cf351558869299b2324b2703dd97d989c02e89bdf8742b10151f97a21`.
- Current F6: `114a3fe7a87dcc30cfe61e8ec4f29a4ea25082da653f96920b2079a3be3480e3`.
- Owner F-ALL: `28938d26e27e723e8d485793b729998efbe5fb526c2d74c40bcb51dd084b407b`.

## Cross-export discrepancy: synchronization still requires a decision

All five new F-ALL features fail the existing full-footprint identity test at nine decimal degrees. Geometric intersection identifies plausible corresponding features, but a plausible overlap is not an approved identity crosswalk. The comparison below ranks candidates by intersection-over-union (IoU), without using row order or name as identity.

| F-ALL ID | Highest-IoU F6 candidate | F-ALL area m2 | F6 area m2 | IoU | Current identity status |
| --- | --- | ---: | ---: | ---: | --- |
| 1609 | 147 | 4.54736 | 4.34447 | 92.85% | Unresolved |
| 1610 | 148 | 2.40783 | 2.62889 | 82.15% | Unresolved |
| 1611 | 149 | 3.25627 | 3.20551 | 77.63% | Unresolved |
| 1612 | 150 | 3.97652 | 2.73664 | 53.82% | Unresolved |
| 1613, Collaborative Space | 146 | 396.67265 | 396.62979 | 99.93% | Unresolved |

Collaborative Space is now present in F-ALL, and its 4-meter relative height agrees with current F6: combined base 26, top 30. Partition heights also agree: combined base 26, top 28 versus individual-floor base 0, top 2. The outstanding differences are XY geometry, not a missing Collaborative Space or double-applied elevation offset.

These discrepancies exceed the current identity tolerance. The partition differences are material relative to their small footprint areas. The analysis uses the existing local Lambert azimuthal equal-area projection, polyclip-ts intersections and JSTS topology/area calculations, not longitude/latitude degree areas or screen coordinates. [combined-assessment.json](combined-assessment.json) retains the three leading overlapping candidates and measurements for each new display feature.

No duplicate same-floor full footprints or duplicate display identities were found in the owner F-ALL export. There are now **11 unresolved F6 display links**, including the five new features and six previously unresolved features; **140** unresolved display links across the building. Those warnings are deliberately retained. The application can display the new geometry, but identity-dependent selection/highlight behavior across F6 and F-ALL cannot be certified for these five unmatched features. No renderer or identity tolerance was changed to hide the discrepancy.

The four old combined footprints were initially reconciled before the owner replaced F-ALL during this task. That interim metadata is explicitly superseded and archived in [superseded-interim/](superseded-interim/). The final generator only reads the owner's replacement; it does not restore the interim geometry or overwrite public data.

## Metadata and review updates

The current isolated sidecar is [metadata.f6-sync.v1.json](../../data/space-analytics/metadata.f6-sync.v1.json), selected by [current.json](../../data/space-analytics/current.json). It is not activated in rendering. All 1,610 authoritative identities remain represented, with removed F6 IDs replaced by the four new source IDs. The other **1,472 feature classifications and relationship fields are preserved**; their dataset-version stamp changes because the source set changed. Approval payloads, logical spaces and approved parent edges are preserved exactly.

The saved Stage 2A file contained zero formal dated approvals. The two owner-confirmed facts supplied in this request are retained separately under `owner_confirmations`, without fabricating verification timestamps or overriding classifications:

- F4 Help Desk is a **physical service counter inside Geospatial Resources**.
- F4 Group Study 0420D is **one enclosed study room**, regardless of its three modeled features.

F6 partitions 147-150 now have provisional metadata:

| Field | Value |
| --- | --- |
| Functional category / subcategory | `study_learning` / `semi_private_study_booths` |
| Space type | Open-plan collaborative study area |
| Proposed geometry role | `structural_component`, tagged partition/open-plan/non-room |
| Enclosed-room count | **0** for the partition features; no independent booth rooms counted |
| Proposed room-count and allocated-area inclusion | `false` |
| Study-station count | `null`, pending verification |
| Functional-zone footprint / allocated floor area | `null`, requiring a separately confirmed zone footprint |

Their summed authoritative **partition footprint** is approximately **12.91552 m2**. This is not the study area's floor allocation. No zone boundary was invented from the walls. The existing Collaborative Space polygon is not silently assumed to define the booth zone; the owner must confirm whether it is the intended footprint or whether a separate zone boundary is needed.

Start with [affected-classification-review.csv](affected-classification-review.csv), which contains the five added/modified source features. Complete F6 outputs are [feature-inventory.csv](feature-inventory.csv), [classification-review.csv](classification-review.csv), [spatial-diagnostics.json](spatial-diagnostics.json), and [membership-review.csv](membership-review.csv). The one same-name grouping remains a provisional partition-component investigation, not four rooms or an approved logical space.

[superseded-records.json](superseded-records.json) and its [CSV](superseded-records.csv) mark old F6 metadata/classification rows, grouped classification decisions, geometric pairs, membership proposals, removed F-ALL links and the interim snapshot as superseded. Original Stage 2A files remain preserved for audit; their report headers point here. Old approval batches fail the new dataset-version check rather than silently applying to re-digitized features.

## Validation and tests

Geometry validation passes for all **1,610 authoritative features**, including all **138 F6 features**, and for the **139 current F6 display features**. The F6 sweep checks **51 bounding-box candidates** from 9,453 possible pairs, with **13 positive-area overlaps**, no geometry errors, and no qualifying functional-parent review pairs. Small/background overlaps remain in diagnostics. The metadata validator passes with the 140 unresolved crosswalk warnings described above.

**All 48 space-analytics tests passed, including 10 targeted synchronization tests. The production build passed.** The full suite recorded 321 tests: 310 passed and 11 failed, with no new failures compared with the saved Stage 2A baseline. The existing failures are nine routing-anchor/name tests and two color-enrichment tests; the suite is not fully green.

Automated verification and build results are recorded in [checks.json](checks.json), [unit-tests.json](unit-tests.json), and [build.log](build.log). Tests cover source change detection, owner-export preservation, unmatched identities, elevations, duplicate rejection, F6 searchability, preservation of unrelated approvals, partition counting/area safeguards, and supersession. [integrity.json](integrity.json) confirms both owner source hashes and their built GeoJSON copies, unchanged application files, and no analytics modules in the production bundle. No browser interaction or visual regression testing is claimed.

Reproduce from the repository root:

```powershell
node scripts/f6-synchronize.cjs
node review/f6-synchronization-checks.cjs
```

The targeted generator refuses unexpected source changes and writes only isolated data/review artifacts. It does not modify GeoJSON. The original Stage 2A generator is tied to its historical hashes and intentionally cannot overwrite this updated inventory.

## Remaining owner verification

1. Which export should define the canonical XY footprints for these five features? Prefer exporting individual F6 and F-ALL from the same geometry version. Until resolved, retain the actual differences and unmatched links.
2. Is Collaborative Space 146/1613 the intended functional-zone boundary for the booth area, or does that area need a separately defined zone polygon?
3. How many study stations are present? Partition count is not station count.
4. Confirm the additional Collaborative Space height change to 4 meters is intended; both current exports now agree on that height.

At synchronization time the partitions used `dark purple`, which was absent from the application's named-color table. The subsequent owner edit changed this to supported `purple`, and Collaborative Space to supported `pink`. The latest recheck confirms these were color-only changes; that earlier color issue is resolved.

No dashboard, Stage 3 work, routing graph edits, light changes, camera changes, or unrelated floor modifications were made.

## Implementation files

- Added `src/spaceAnalytics/floorSynchronization.js` and its tests; added targeted scripts `scripts/f6Synchronize.mjs` / `f6-synchronize.cjs` and `review/f6-synchronization-checks.cjs`.
- Extended the isolated taxonomy/metadata validator for semi-private booth partitions; updated the real-data test to compare the original non-F6 relationship set plus current F6 results.
- Added current metadata/schema/pointer and the reports, audit snapshots, supersession ledger and verification artifacts in this directory. Original Stage 2A report headers now identify their superseded F6 snapshot.
- No production UI, rendering, routing, lighting, camera or search implementation was edited. Both final public export files are the owner's supplied bytes.
