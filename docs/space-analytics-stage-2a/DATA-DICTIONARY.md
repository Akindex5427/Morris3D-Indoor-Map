# Stage 2A metadata and review dictionary

The structural schema is [metadata.schema.json](../../data/space-analytics/metadata.schema.json); the initial sidecar is [metadata.proposals.v1.json](../../data/space-analytics/metadata.proposals.v1.json). Semantic validation additionally needs the current authoritative source context.

## Sidecar root

| Field | Meaning |
| --- | --- |
| `schema_version` | `morris-space-metadata/v1`; independent of source and algorithm versions. |
| `dataset_version` | SHA-256-derived identity of all eight floor sources and the combined display source. |
| `revision`, `previous_revision`, `history` | Nonnegative metadata revision, predecessor and import/restore audit events. Seed revision is zero. |
| `sources` | Floor, registered source path and byte-exact SHA-256 for the eight authoritative files. |
| `features` | One metadata row per authoritative catalog feature; no copied or altered polygon geometry. |
| `logical_spaces` | Explicitly approved space IDs, member feature IDs, floor IDs, approval ID and cross-floor evidence. Empty initially. |
| `proposed_relationships` | Pending geometric review pairs; never authoritative functional edges. |
| `approved_relationships` | Approved child-to-parent logical-space edges with approval IDs and evidence linkage. Empty initially. |
| `membership_proposals` | Pending same-name geometric investigations, not assigned spaces. |
| `approvals` | Exact owner decisions, values, reviewer, timestamp and evidence. Empty initially. |
| `display_links` | F-ALL source identity/hash, floor, full-footprint match status, authoritative ID/candidates and resolution. Unresolved links remain null and flagged. |

## Feature fields

| Fields | Meaning |
| --- | --- |
| `feature_id`, `floor_id` | Existing authoritative catalog key and integer floor 0-7. Names and export row positions are not identity. |
| `source_dataset`, `source_export_id` | Registered source path and original ID `{field, value}`. |
| `dataset_version`, `source_sha256`, `footprint_hash` | Version and integrity checks against loaded data; stale approvals are rejected. |
| `original_name` | Exact source name or null. No fabricated display name is persisted. |
| `geometry_role` | Approved geometry meaning; `unknown` before review. |
| `space_category`, `space_subcategory`, `secondary_tags` | Approved functional classification; initially `unclassified`, null, empty array. |
| `proposed_geometry_role`, `geometry_role_alternatives` | Candidate role and explicitly ambiguous alternatives. |
| `proposed_space_category`, `proposed_space_subcategory`, `proposed_secondary_tags` | Controlled functional proposals, separate from approved values. |
| `rule_version`, `proposal_confidence`, `proposal_needs_review` | Rule provenance, high/medium/low/none evidence confidence, and review prioritization. Even high confidence is unverified. |
| `classification_source`, `classification_evidence` | Proposal source/reason, or explicit approval reference/evidence once approved. The `proposed_*` fields retain the original candidate values. |
| `logical_space_id`, `component_of` | Both mirror approved membership in a logical space. Null until membership approval; never assigned from equal names alone. |
| `parent_space_id` | Approved functional parent of the feature's logical space. Null until separate parent approval. |
| `classification_status` | `unclassified`, `proposed`, or `approved`. |
| `relationship_status` | `unreviewed` until logical membership approval, then `approved`; does not imply a parent exists. |
| `verification_status`, `verified_by`, `last_verified`, `approval_id` | Classification verification and exact approval provenance; no dates/reviewers are fabricated. |
| `assignable`, `include_in_room_count`, `include_in_area_total` | Owner-reviewed nullable booleans. Null is unknown. They do not automatically aggregate overlapping members. |
| `proposed_assignable`, `proposed_include_in_room_count`, `proposed_include_in_area_total` | Candidate exclusion policies only. No analytics counts are activated. |

Geometry roles: `room_boundary`, `functional_zone`, `nested_compartment`, `service_fixture`, `furniture_or_equipment`, `structural_component`, `stair_component`, `elevator_component`, `circulation_zone`, `floor_background`, `unknown`.

Functional categories: `study_learning`, `open_reading_study`, `research_cultural_resources`, `auditorium_events`, `library_services`, `offices_administration`, `collections_bookshelves`, `restroom_facilities`, `circulation_vertical_access`, `building_support`, `structure_non_occupiable`, `floor_background`, `unclassified`. Category-specific subcategories are controlled in `src/spaceAnalytics/schema.js`; arbitrary category/subcategory combinations are rejected. Secondary tags are unique nonempty strings, distinct from category IDs.

## Spatial pair fields

| Fields | Meaning |
| --- | --- |
| `relationship_id` | `spatial-pair-v1:` plus canonical JSON `[floor, sorted feature IDs]`; independent of iteration order. |
| `floor_id`, `feature_a_id`, `feature_b_id`, `feature_a_name`, `feature_b_name` | Pair provenance. Names are display evidence only. |
| `relationship_type` | Seven geometric types documented with thresholds in README. Contains/within are directional relative to A/B. |
| `area_a_m2`, `area_b_m2`, `intersection_area_m2` | Equal-area metric geometry calculations, not source `Shape_Area`. |
| `overlap_pct_a`, `overlap_pct_b` | Intersection as percent of each feature, range 0-100. |
| `containment_ratio`, `intersection_over_union` | Smaller-footprint coverage and IoU, range 0-1. |
| `outside_smaller_area_m2`, `symmetric_difference_area_m2` | Uncovered smaller-footprint area and total nonshared area. |
| `geometric_container_id`, `geometric_contained_id` | Topological/near-containment orientation; not functional parentage. |
| `topological_covers_a_b`, `topological_covers_b_a` | Exact projected JSTS coverage predicates, independent of near-containment tolerance. |
| `numerical_tolerance_m2`, `significance` | Explicit epsilon and material/small_overlap/numerical_sliver/boundary_only/none classification. |
| `proposed_parent_id`, `proposed_child_id` | Candidate **feature** IDs needing owner interpretation and logical-space assignment. Null for same-space overlap and background conflicts. |
| `proposed_relationship_role`, `confidence` | Review purpose and `proposal_only`; not a probability or approval. |
| `review_priority`, `review_status`, `review_notes` | Sorting urgency, pending/diagnostic-only status and interpretation guidance. |
| `decision`, `owner_notes` | Empty owner-review cells; editing them does not import approval. |

No intersection implies connectivity, a door, or ownership. Full diagnostics preserve small contacts and suppressed background cases; bbox-disjoint noncandidates are summarized by count.

## Classification and membership review fields

Classification rows collect `feature_ids`, `original_names`, `feature_count`, floor, proposed category/subcategory/role, alternatives, tags, confidence and evidence. `review_id` is a deterministic proposal-group ID, not a logical-space ID. `approved_*`, inclusion flags, reviewer/date and decision cells start empty. Split review groups when members differ. CSV rows do not substitute for explicit per-feature JSON decisions.

Membership investigations retain `feature_ids`, `feature_areas_m2`, their non-deduplicated `feature_area_sum_m2`, `largest_feature_id`, `largest_area_fraction`, compatible modeled heights, `proximity_clusters`, `pair_distances` in meters, and `proposed_membership_groups`. Largest fraction compares feature-area sum, not a union or assignable area. The JSON artifact retains pair distances; the compact CSV omits those long lists. All candidate groups have null `logical_space_id` and pending review. The 0.5-meter gap threshold and height checks support investigation, not certification.

## Approval envelope

`schema_version: "morris-space-approvals/v1"`, exact `dataset_version`, current `base_revision`, and nonempty `decisions`. Each decision contains:

```json
{
  "approval_id": "OWNER-SUPPLIED-UNIQUE-DECISION-ID",
  "decision": "approve_classification",
  "target_id": "EXISTING-AUTHORITATIVE-FEATURE-ID",
  "approved_values": {
    "geometry_role": "unknown",
    "space_category": "unclassified",
    "space_subcategory": null,
    "secondary_tags": [],
    "assignable": null,
    "include_in_room_count": null,
    "include_in_area_total": null
  },
  "reviewed_by": "ACTUAL-REVIEWER",
  "reviewed_at": "ACTUAL-ISO-TIMESTAMP-WITH-TIMEZONE",
  "evidence": "ACTUAL-REVIEW-EVIDENCE"
}
```

This example is deliberately nonimportable until its placeholders and decisions are replaced by real owner input. It is not an approval record. The other exact `approved_values` forms are:

- `approve_membership`: `{ "floor_ids": [1], "feature_ids": ["EXISTING-FEATURE-ID"], "cross_floor_evidence": null }`, target a new owner-provided logical-space ID.
- `approve_parent`: `{ "parent_space_id": "APPROVED-PARENT-SPACE-ID", "cross_floor_evidence": null }`, target an approved child logical-space ID.

All imports are isolated metadata snapshots. Application activation is outside Stage 2A.
