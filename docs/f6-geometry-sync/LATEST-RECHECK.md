# Latest F6 / F-ALL replacement check

**The partition mismatch is substantially reduced, but strict cross-export identity is not yet resolved. Both exports contain valid geometry and matching relative heights.** No source data or application code was changed by this check.

| Individual F6 ID | F-ALL ID | Footprint overlap (IoU) | Largest sampled boundary separation | Identical under current app rule? |
| --- | --- | ---: | ---: | --- |
| 151 | 1614 | 99.9770% | 0.13 mm | No |
| 152 | 1610 | 99.9463% | 0.13 mm | No |
| 153 | 1611 | 99.9186% | 2.84 mm | No |
| 154 | 1612 | 96.0040% | 38.23 mm | No |
| 156 | 1615 | 99.9242% | 69.01 mm | No |

F6 IDs 151-154 are the partition walls; 156 is Collaborative Space. Two partition differences are now only about 0.13 millimeters, and another is about 2.8 millimeters. The curved partition differs by about 3.8 centimeters, improved from 10.7 centimeters. Collaborative Space still differs by about 6.9 centimeters, compared with about 6 centimeters previously. These are differences between drawings, not measurements of error against the real building.

The 138 individual F6 polygons and 139 F6 polygons in the combined source all pass topology validation. The partitions are 2 meters high in both exports; Collaborative Space is 4 meters high. F-ALL retains its 26-meter floor base. Five distinct candidate correspondences were found without assigning an authoritative identity based on name or overlap.

The existing app requires identical full footprints at nine decimal degrees for identity matching. All five pairs still fail that rule. The very small differences in two partitions may be consistent with export precision, but this check does not establish their cause. The curved partition and Collaborative Space still have centimeter-scale boundary differences. Geometry validity and exact cross-export identity are separate results.

Two independent intersection engines (polyclip-ts and JSTS OverlayOp) agree within 1e-9 square meters. Boundary distances use the same local metric equal-area projection and vertices plus 50 subdivisions per edge, so they are sampled estimates rather than guaranteed exact continuous maxima. Source hashes were checked before and after reading.

This was a read-only diagnostic, not a fresh application build or browser test. Earlier screenshots, metadata, and verification reports describe earlier exports. In particular, the isolated review metadata refers to the previous F6 IDs 146-150; this export now uses 151-154 and 156. Those records need a versioned refresh after the export geometry is finalized, not an automatic reassignment by row order.

Current source hashes:
- `public/rooms-level-6-WGS.geojson`: `bd72456b646ad87690dbae7bd1841a9425dd95dc2a262ad661a17bf3e4859b33`.
- `public/rooms-all-WGS-v6.geojson`: `31309b325db7b8e378d909ae8facfbbe0005a290021f10cc262f08fc5d2945be`.

Raw measurements and projected rings: [geometry-recheck.json](geometry-recheck.json). Earlier comparison image: [geometry-comparison.png](geometry-comparison.png), which is historical and does not show the latest replacement.
