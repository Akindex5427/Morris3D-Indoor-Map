# Geometry recheck in plain language

**Historical recheck:** these measurements describe the preceding exports. See [the latest replacement check](LATEST-RECHECK.md) for the current files.

**Both exports contain valid geometry. The four partitions are thin, open U-shaped/curved wall footprints, consistent with semi-private booths rather than four filled, enclosed room footprints.** Their positions are very close in the two files. No geometry was changed during this check.

The earlier overlap percentages were correct, but were insufficient to explain the practical size of the difference. A thin wall can lose a large percentage of its overlapping area when its boundary moves by only a few centimeters. A 53.82% overlap score does **not** mean half of the study area is missing or incorrectly located.

## Measured boundary differences

| Individual F6 / F-ALL ID | Largest sampled boundary separation |
| --- | ---: |
| Partition 147 / 1609 | 4.0 cm |
| Partition 148 / 1610 | 5.1 cm |
| Partition 149 / 1611 | 6.9 cm |
| Curved partition 150 / 1612 | 10.7 cm |
| Collaborative Space 146 / 1613 | 6.0 cm |

These measurements compare vertices plus 50 subdivisions per edge in both directions. They are sampled boundary distances, not a certified exact continuous maximum or real-world survey accuracy.

See the [actual polygon comparison image](geometry-comparison.png) or [zoomable SVG](geometry-comparison.svg): blue is the individual F6 file; orange is F-ALL. Each panel fits its own footprint while preserving equal horizontal and vertical scale. The outlines almost coincide; the curved partition shows the largest visible difference.

## Checks performed

- Re-read the current files: 138 individual F6 features and 139 F6 display features in F-ALL. All passed the existing JSTS polygon topology checks, including closed rings and self-intersection checks.
- Compared both exports in the same local equal-area metric projection.
- Independently recalculated all five intersections using JSTS OverlayOp, in addition to the existing polyclip-ts calculation. Areas agree to less than `1.2e-13` square meters.
- Measured boundary separation, in addition to area-overlap percentages.
- Confirmed heights agree: partitions are 2 meters high in both sources; Collaborative Space is 4 meters. F-ALL includes its existing 26-meter floor base.
- Verified that current changes since the previous build are color edits only: partition `dark purple` became `purple`, and Collaborative Space `grey` became `pink`. Coordinates are unchanged. Both new color names are supported by the existing parser.
- Checked source hashes before and after the read-only analysis. Neither GeoJSON was modified.

The latest combined-file hash is `3c24aa9b4f536fae73ec0da96350bbbe490788a5cb473ba2cc1101391d3579c4`. The earlier synchronization metadata was generated before these color edits and retains that historical source hash. This recheck writes diagnostics only; it does not silently change metadata version stamps or previous approval evidence.

## What “canonical” meant

It meant **one master drawing from which both display files are exported**. It did not mean one drawing was invalid or that the owner needed to know a special GIS concept.

The app's existing identity matching requires the same footprint in both files. Differences of a few centimeters exceed that very strict matching rule, even when the two drawings look nearly identical. That explains the unresolved identity links. It does not establish that either export is an inaccurate representation of the building.

No major misplaced shape or invalid polygon was found in these five features. Confirming their precise real-world dimensions would require a measured plan or survey. There is no basis from these checks alone to redraw the booths or automatically replace one export with the other. If exact cross-view identity is required, generate both exports from the same master geometry in a later controlled synchronization.

Reproduce the diagnostic measurements with `node scripts/f6-geometry-recheck.cjs`. Raw results and metric polygon coordinates are in [archived measurements](geometry-recheck-114a3fe7a87d.json). No application code, renderer, geometry, classification, or source data was changed; no new browser test or production build was necessary for this diagnostic-only recheck.
