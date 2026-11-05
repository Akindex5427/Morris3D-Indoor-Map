# Owner review: Stage 2A

**Historical snapshot:** F6 records in this report have been superseded by the [targeted F6 synchronization](../f6-geometry-sync/README.md), including the owner's replacement F-ALL export. See the [supersession ledger](../f6-geometry-sync/superseded-records.json); the original review rows remain preserved for audit. The current metadata is listed in `data/space-analytics/current.json`.

**Owner confirmations supplied since this snapshot:** F4 Help Desk is a physical service counter inside Geospatial Resources. F4 Group Study 0420D is one enclosed study room despite multiple modeled features. These facts are recorded in the current sidecar's `owner_confirmations`; the historical questions below are not requests to reconsider those confirmed facts.

No classifications, logical spaces or functional parents have been approved. No provisional metadata is active in the app.

Start with **priority-classification-review.csv** (127 decisions), **spatial-relationship-review.csv** (43 pairs), and **membership-review.csv** (13 same-name investigations). Classification grouping is a review shortcut, not a physical-room count. Split rows when feature roles differ.

| Floor | Priority classification | All classification | Spatial pairs | Same-name groups |
| --- | ---: | ---: | ---: | ---: |
| F0 | 18 | 26 | 0 | 0 |
| F1 | 23 | 33 | 38 | 5 |
| F2 | 9 | 15 | 0 | 0 |
| F3 | 25 | 31 | 0 | 1 |
| F4 | 15 | 22 | 4 | 6 |
| F5 | 16 | 26 | 1 | 0 |
| F6 | 12 | 19 | 0 | 1 |
| F7 | 9 | 17 | 0 | 0 |

The full diagnostic set retains 2328 bounding-box candidate pairs, including boundary-only contacts, small overlaps and disjoint candidates. 186301 additional pairs are provably disjoint by their bounds and summarized rather than materialized. Background/structural/access cases (2208) remain in a separate diagnostic file; none automatically becomes a functional parent.

## Decisions to resolve

- Help Desk versus Geospatial Resources: fixture, compartment, or separate zone; whether to approve a functional parent after assigning logical-space IDs.
- Baker desk: whether seven modeled pieces form one counter/service space; do not count seven rooms.
- Auditorium and Group Study 0420D: which pieces belong to a shared logical space and which represent ancillary modeled detail.
- Conference 0480A: why two large same-name footprints overlap; preserve both until role/grouping review.
- Floor/Structure: confirm exclusion policies without treating geometric containment as hierarchy.
- Remaining ambiguous classifications and 135 unresolved F-ALL links: keep unknown until separately reviewed.

See README.md and DATA-DICTIONARY.md for tolerances, named-example results and the validated approval/import format.
