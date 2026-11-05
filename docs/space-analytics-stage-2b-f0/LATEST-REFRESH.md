# Latest F0 inventory refresh

**The former overlapping structure is removed. Mechanical Room and SCRC remain. F0 has 148 polygons, down from 149.**

| Feature | Current exact identifier | Preceding identifier | Retained secondary ID |
| --- | --- | --- | --- |
| Mechanical Room (No Access) | /rooms-basement-WGS.geojson#F0:FID:146 | /rooms-basement-WGS.geojson#F0:FID:147 | FID_ 156 |
| SCRC Stocks (Staff Only) | /rooms-basement-WGS.geojson#F0:FID:147 | /rooms-basement-WGS.geojson#F0:FID:148 | FID_ 157 |
| Removed structure | No current counterpart | /rooms-basement-WGS.geojson#F0:FID:96 | FID_ 105 (absent) |

There are **no other additions, deletions, or retained-geometry changes** relative to the preceding corrected-file audit. Fifty-two FIDs (and matching top-level feature IDs) were renumbered. The only non-identifier attribute edit is removal of the leading space from the Mechanical Room name. SCRC still says “Stocks”; no spelling change was made by this refresh.

Current FID 96 belongs to the former FID 97 Structure (FID_ 106); its existence does not mean the deleted FID 96 footprint remains. Matching used the preserved secondary identifiers plus exact geometry, not row position or the reused FID alone. The complete preceding snapshot was reconstructed and its SHA-256 verified against the hash recorded before this edit. All 148 retained geometries match that verified snapshot exactly.

The unresolved queue now contains **110 records**: 106 current features, one older historical case, and three unlocated owner statements. The deleted structure's review row and all references to its overlap are removed. The Mechanical Room question retains the pending owner-to-polygon binding but no longer asks about the removed overlapping structure. The 104 identity/membership questions, one Elevator technical-role question, and one Emergency Exit classification question remain. Forty-two current features remain reliably reconciled. No approval was silently added; this does not close Stage 2B.

Updated artifacts:

- [Current inventory](F0-LATEST-INVENTORY.csv)
- [Current reconciliation](F0-STAGE2B-RECONCILIATION.csv)
- [Current unresolved verification queue](F0-UNRESOLVED-VERIFICATION.csv)
- [Identifier crosswalk](inventory-refresh/F0-ID-CROSSWALK.csv)
- [Refresh evidence and counts](inventory-refresh/SUMMARY.json)
- [Preserved preceding full audit](history/preceding-9be596896c68/F0-STAGE2B-RECHECK-SUMMARY.md)

Source SHA-256: a3de5bee376bf8cb644bcbef86464f432cdf194ed7b52f6702a55564c193fdc4. Preceding source SHA-256: 9be596896c68c09320b932f48dfd42c8880892547847967f1bca268f7b4e9011.

The original full-audit summary, F-ALL report, diagnostics and F0-SUMMARY.json describe the preceding snapshot. They are historical, not fresh results for this edit. F-ALL was not re-audited. Retained area and relationship results were reused only after proving geometry unchanged; deleted-feature relationships were filtered and current IDs remapped. No new intersections, classification import, application build or browser test was performed. Source data, application code and owner metadata were not modified.
