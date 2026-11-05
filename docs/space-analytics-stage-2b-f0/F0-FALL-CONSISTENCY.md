> Historical full-audit snapshot. See [LATEST-REFRESH.md](LATEST-REFRESH.md) for the latest F0 inventory and queue. This full report was not rerun.

# Corrected F0 / F-ALL consistency

Individual F0 is the classification authority. F-ALL is a separate display dataset, never an additional source of rooms for counting. No GeoJSON was modified.

Current F0 SHA-256: 9be596896c68c09320b932f48dfd42c8880892547847967f1bca268f7b4e9011

F-ALL SHA-256: 31309b325db7b8e378d909ae8facfbbe0005a290021f10cc262f08fc5d2945be

There are **149 individual F0 polygons**, **143 F0 display polygons**, and **123 unique strict correspondences**. Full horizontal rings at the application's existing nine-decimal-degree export precision establish identity; names, row order, similar numeric IDs, and high intersection-over-union do not. These F0 datasets have zero base offset; no visual stack transformation enters the comparison.

## Missing strict correspondences (26)

| Current exact ID | Exact source name | Best overlap candidate (not identity) | IoU % |
| --- | --- | --- | --- |
| /rooms-basement-WGS.geojson#F0:FID:123 | dewey books 001 to 330 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 4.761650 |
| /rooms-basement-WGS.geojson#F0:FID:124 | dewey books q001 to q998 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 2.972166 |
| /rooms-basement-WGS.geojson#F0:FID:125 | dewey books 551 to 882 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 7.407150 |
| /rooms-basement-WGS.geojson#F0:FID:126 | dewey books 330 to 551 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 5.913909 |
| /rooms-basement-WGS.geojson#F0:FID:127 | dewey books 823 to 914 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 2.788090 |
| /rooms-basement-WGS.geojson#F0:FID:128 | dewey folios 001 to 999 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 0.704555 |
| /rooms-basement-WGS.geojson#F0:FID:129 | dewey books 914 to 999 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 3.639683 |
| /rooms-basement-WGS.geojson#F0:FID:130 | journals 1995 & older a to f | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 4.305627 |
| /rooms-basement-WGS.geojson#F0:FID:131 | oversized journal a - f | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 0.064797 |
| /rooms-basement-WGS.geojson#F0:FID:132 | journals 1995 & older f to i | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 1.460668 |
| /rooms-basement-WGS.geojson#F0:FID:133 | oversized journals f - h | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 0.032179 |
| /rooms-basement-WGS.geojson#F0:FID:134 | national union catalog | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 0.302336 |
| /rooms-basement-WGS.geojson#F0:FID:135 | oversized journals i - z | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 0.509642 |
| /rooms-basement-WGS.geojson#F0:FID:136 | storage 3 books | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 0.798428 |
| /rooms-basement-WGS.geojson#F0:FID:137 | journals 1995 & older j to z | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 4.399212 |
| /rooms-basement-WGS.geojson#F0:FID:138 | indexes | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 1.463920 |
| /rooms-basement-WGS.geojson#F0:FID:139 |  elevator | /rooms-all-WGS-v6.geojson#F0:OBJECTID:24 | 46.271785 |
| /rooms-basement-WGS.geojson#F0:FID:140 | Emergency Exit | /rooms-all-WGS-v6.geojson#F0:OBJECTID:31 | 97.543526 |
| /rooms-basement-WGS.geojson#F0:FID:141 | Structure | /rooms-all-WGS-v6.geojson#F0:OBJECTID:11 | 96.158902 |
| /rooms-basement-WGS.geojson#F0:FID:142 | Structure | /rooms-all-WGS-v6.geojson#F0:OBJECTID:10 | 95.495413 |
| /rooms-basement-WGS.geojson#F0:FID:143 | Structure | /rooms-all-WGS-v6.geojson#F0:OBJECTID:84 | 92.334769 |
| /rooms-basement-WGS.geojson#F0:FID:144 | Structure | /rooms-all-WGS-v6.geojson#F0:OBJECTID:8 | 71.631866 |
| /rooms-basement-WGS.geojson#F0:FID:145 | Structure | /rooms-all-WGS-v6.geojson#F0:OBJECTID:9 | 87.996526 |
| /rooms-basement-WGS.geojson#F0:FID:146 | Structure | /rooms-all-WGS-v6.geojson#F0:OBJECTID:12 | 23.081038 |
| /rooms-basement-WGS.geojson#F0:FID:147 |  Mechanical Room (No Access) | /rooms-all-WGS-v6.geojson#F0:OBJECTID:113 | 99.999323 |
| /rooms-basement-WGS.geojson#F0:FID:148 | SCRC Stocks (Staff Only) | /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | 9.583253 |

All 16 named collection/fixture footprints restored in corrected F0 lack strict display links. Candidate overlap with a background Floor or broad Structure polygon does not establish that these zones are represented. The new Mechanical Room has a near-coincident display Structure candidate (OBJECTID 113), but fails strict identity. The new SCRC room has only background/sliver display candidates; no distinct room counterpart is established. Geometry differences in these candidate pairs are reported, not automatically repaired or assigned.

## Extra or unmatched display footprints (20)

| Display exact ID | Exact name | Area m² |
| --- | --- | --- |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:1 | Floor | 4638.162366 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:7 | Stairs Area Base | 2.114736 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:8 | Structure | 16.842066 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:9 | Structure | 24.001086 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:10 | Structure | 12.799213 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:11 | Structure | 22.150547 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:12 | Structure | 3.926400 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:17 | Structure | 64.022939 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:18 | Structure | 21.745725 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:21 | Structure | 5.484320 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:22 | Structure | 6.194513 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:24 | Structure | 5.381437 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:31 | Structure | 15.973785 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:84 | Structure | 49.575406 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:85 | Structure | 0.392448 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:89 | Structure | 10.938808 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:1604 | John C Guyan Auditorium | 187.250491 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:1605 | Structure | 19.957427 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:1606 | Structure | 16.592049 |
| /rooms-all-WGS-v6.geojson#F0:OBJECTID:1607 | Structure | 5.922798 |

“Extra” means no strict individual F0 match, not proven erroneous physical geometry. Some may be altered counterparts. Confirm export provenance before any future deletion or replacement. Candidate intersections are retained in [F0-FALL-EXTRA-FEATURES.csv](F0-FALL-EXTRA-FEATURES.csv).

## Height mismatches on proven pairs (12)

| Current exact ID | F0 base / top | Display exact ID | Display base / top |
| --- | --- | --- | --- |
| /rooms-basement-WGS.geojson#F0:FID:4 | 0 / 0.2 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:6 | 0 / 2 |
| /rooms-basement-WGS.geojson#F0:FID:6 | 0 / 0 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:14 | 0 / 1 |
| /rooms-basement-WGS.geojson#F0:FID:7 | 0 / 0 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:15 | 0 / 1 |
| /rooms-basement-WGS.geojson#F0:FID:9 | 0 / 0 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:19 | 0 / 1 |
| /rooms-basement-WGS.geojson#F0:FID:10 | 0 / 0 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:20 | 0 / 1 |
| /rooms-basement-WGS.geojson#F0:FID:11 | 0 / 0 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:23 | 0 / 1 |
| /rooms-basement-WGS.geojson#F0:FID:12 | 0 / 4 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:25 | 0 / 1 |
| /rooms-basement-WGS.geojson#F0:FID:14 | 0 / 4 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:27 | 0 / 2 |
| /rooms-basement-WGS.geojson#F0:FID:70 | 0 / 2 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:86 | 0 / 1 |
| /rooms-basement-WGS.geojson#F0:FID:71 | 0 / 2 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:87 | 0 / 1 |
| /rooms-basement-WGS.geojson#F0:FID:72 | 0 / 2 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:88 | 0 / 1 |
| /rooms-basement-WGS.geojson#F0:FID:122 | 0 / 0.2 | /rooms-all-WGS-v6.geojson#F0:OBJECTID:139 | 0 / 0.5 |

Differences exceed 1e-6 meters. Unmatched candidate heights are not counted as proven-pair discrepancies.

## Name mismatches on proven pairs (3)

| Current exact ID | Exact F0 name | Exact display name |
| --- | --- | --- |
| /rooms-basement-WGS.geojson#F0:FID:12 | rest room male | Structure |
| /rooms-basement-WGS.geojson#F0:FID:14 | rest room female | Structure |
| /rooms-basement-WGS.geojson#F0:FID:122 | floor | Structure |

Names are normalized only for comparison; source spelling remains unchanged. All three name mismatches are already among the height-discrepant pairs.

## Counts

**58 distinct inconsistent source records/pairs** = 26 unlinked individual records + 20 unlinked display records + 12 discrepant matched pairs. This is not a room count or a count of proven physical defects; an unlinked candidate pair can appear once on each export side. The three name issues do not add three more records. There are no duplicate current or F0 display export IDs, and no exact duplicate current footprints. Both datasets pass the reused polygon validity checks.

See [F0-FALL-CROSSWALK.csv](F0-FALL-CROSSWALK.csv) and [F0-GEOMETRY-DIAGNOSTICS.json](F0-GEOMETRY-DIAGNOSTICS.json) for complete evidence.

