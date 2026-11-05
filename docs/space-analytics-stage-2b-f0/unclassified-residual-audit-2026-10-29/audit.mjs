// Read-only source audit. Does not import decisions or calculate residual geometry.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp';
import {intersection} from 'polyclip-ts';
import {createMetricProjection} from '../../../src/utils/roomCorrespondence';
import {routeFootprintSignature} from '../../../src/utils/routeLabelIdentity';
import {correspondenceFloor} from '../../../src/utils/roomCorrespondenceIdentity';
import {FLOOR_POLYGON_MAP} from '../../../src/utils/roomCatalog';

const base = 'docs/space-analytics-stage-2b-f0';
const out = `${base}/unclassified-residual-audit-2026-10-29`;
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const objectHash = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const write = (name, text) => fs.writeFileSync(`${out}/${name}`, text);
const json = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
const csv = (name, rows) => {
  const fields = [...new Set(rows.flatMap(Object.keys))];
  const cell = v => '"' + (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).replaceAll('"', '""') + '"';
  write(name, '\uFEFF' + [fields.map(cell).join(','), ...rows.map(r => fields.map(k => cell(r[k])).join(','))].join('\n') + '\n');
};
const protectedHashes = read(`${out}/START-HASHES.json`);
const changedProtected = () => Object.entries(protectedHashes).filter(([p, h]) => !fs.existsSync(p) || hash(p) !== h).map(([p]) => p);
assert.deepEqual(changedProtected(), [], 'Pre-existing files changed since audit start');

const sourcePath = `public${FLOOR_POLYGON_MAP[0]}`;
const combinedPath = `public${FLOOR_POLYGON_MAP.all}`;
const raw = read(sourcePath), combined = read(combinedPath);
const inventory = read(`${base}/F0-LATEST-INVENTORY.json`);
const reconciliation = read(`${base}/F0-STAGE2B-RECONCILIATION.json`);
const queue = read(`${base}/F0-UNRESOLVED-VERIFICATION.json`);
const owners = read(`${base}/F0-OWNER-STATEMENTS.json`);
const refresh = read(`${base}/inventory-refresh/SUMMARY.json`);
const diagnostics = read(`${base}/F0-GEOMETRY-DIAGNOSTICS.json`);
const pointer = read('data/space-analytics/current.json');
const metadataPath = `data/space-analytics/${pointer.metadata}`;
const metadata = read(metadataPath);
const baselinePath = `${base}/baseline-F0.geojson`;
const priorPath = `${base}/history/preceding-9be596896c68/F0-AUTHORITATIVE-SNAPSHOT.geojson`;
const baseline = read(baselinePath), prior = read(priorPath);
const sourceHash = hash(sourcePath);
const key = fid => `${FLOOR_POLYGON_MAP[0]}#F0:FID:${fid}`;
const byId = new Map(inventory.map(r => [r.source_attributes.FID, r]));
const byFeatureId = new Map(metadata.features.map(r => [r.feature_id, r]));
assert.equal(sourceHash, refresh.current_source_sha256);
assert.equal(sourceHash, hash(`${base}/inventory-refresh/F0-AUTHORITATIVE-SNAPSHOT.geojson`));
assert.equal(hash(priorPath), refresh.preceding_source_sha256);
assert.equal(hash(baselinePath), metadata.sources.find(s => s.floor_id === 0).source_sha256);
assert.equal(hash(combinedPath), diagnostics.display_hash);
assert.equal(hash(`${base}/OWNER-REQUEST.txt`), owners.source_sha256);
assert.equal(new Set(raw.features.map(f => f.properties.FID)).size, raw.features.length);
assert.equal(raw.features.length, inventory.length);
const priorBySecondary = new Map(prior.features.map(f => [f.properties.FID_, f]));
for (const f of raw.features) {
  const r = byId.get(f.properties.FID);
  assert.equal(correspondenceFloor(f), 0);
  assert.equal(r.feature_id, key(f.properties.FID));
  assert.equal(r.source_sha256, sourceHash);
  assert.deepEqual(r.source_attributes, f.properties);
  assert.deepEqual(f.geometry, priorBySecondary.get(f.properties.FID_).geometry);
  assert.deepEqual(reconciliation.find(x => x.feature_id === r.feature_id), r);
}

// Footprint gate: complete rings, unique reciprocal same-floor identity at the
// established nine-decimal export precision, plus two preserved snapshots.
const historical = combined.features.filter(f => correspondenceFloor(f) === 0 && f.properties.OBJECTID === 139);
assert.equal(historical.length, 1);
const footprintSignature = routeFootprintSignature(historical[0].geometry);
assert.ok(footprintSignature);
const matches = raw.features.filter(f => routeFootprintSignature(f.geometry) === footprintSignature);
assert.equal(matches.length, 1, 'Historical footprint has no unique current counterpart');
const floor = matches[0], floorRecord = byId.get(floor.properties.FID);
assert.equal(combined.features.filter(f => correspondenceFloor(f) === 0 && routeFootprintSignature(f.geometry) === footprintSignature).length, 1);
assert.equal(floorRecord.reconciliation_status, 'owner_verified_matched');
assert.equal(floorRecord.proposed_geometry_role, 'floor_background');
assert.equal(floorRecord.owner_statement, 'floor');
const baselineMatches = baseline.features.filter(f => routeFootprintSignature(f.geometry) === footprintSignature);
const priorMatches = prior.features.filter(f => routeFootprintSignature(f.geometry) === footprintSignature);
assert.equal(baselineMatches.length, 1);
assert.equal(priorMatches.length, 1);
assert.deepEqual(floor.geometry, baselineMatches[0].geometry);
assert.deepEqual(floor.geometry, priorMatches[0].geometry);

// Polygon areas and intersections with the footprint only; no residual mask.
// Use the prior audit's exact equal-area origin for reproducible comparisons.
const projection = createMetricProjection(diagnostics.projection.origin);
const reader = new GeoJSONReader();
const metric = new Map();
let maxAreaDelta = 0;
for (const f of raw.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) {
    assert.ok(ring.length >= 4);
    assert.deepEqual(ring[0], ring.at(-1));
    assert.ok(ring.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90));
  }
  const coordinates = polys.map(p => p.map(r => r.map(x => projection(x.slice(0, 2)))));
  const geom = reader.read({type: 'MultiPolygon', coordinates});
  assert.ok(new IsValidOp(geom).isValid(), `Invalid current geometry ${f.properties.FID}`);
  const area = geom.getArea();
  const delta = Math.abs(area - byId.get(f.properties.FID).area_m2);
  maxAreaDelta = Math.max(maxAreaDelta, delta);
  assert.ok(delta < 1e-6, 'Recomputed area differs from refreshed inventory');
  metric.set(f.properties.FID, {coordinates, area});
}
const floorMetric = metric.get(floor.properties.FID);
const areaInside = fid => {
  if (fid === floor.properties.FID) return floorMetric.area;
  const coords = intersection(metric.get(fid).coordinates, floorMetric.coordinates);
  return coords.length ? reader.read({type: 'MultiPolygon', coordinates: coords}).getArea() : 0;
};
const areaInFootprint = new Map(raw.features.map(f => [f.properties.FID, areaInside(f.properties.FID)]));

// Audit the gate rather than interpreting missing approvals as zero allocation.
const f0Metadata = metadata.features.filter(r => r.floor_id === 0);
const f0SourceVersion = metadata.sources.find(s => s.floor_id === 0).source_sha256;
assert.equal(metadata.approvals.length, 0);
assert.equal(metadata.approved_relationships.length, 0);
assert.ok(f0Metadata.every(r => r.include_in_area_total === null && r.approval_id === null));
assert.ok(inventory.every(r => r.count_status === 'report-only owner intent; not imported or allocated'));
assert.equal(owners.approval_imported, false);
const allocationGate = {
  authoritative_footprint_verified: true,
  allocation_rules_verified: false,
  status: 'withheld_missing_verified_allocation_mask',
  reason: 'Owner functions and modeled roles are recorded, but no current-version area-allocation mask or complete inclusion/overlap rules are established. Unknown allocation is not zero allocation.',
  formal_metadata_source_sha256: f0SourceVersion,
  formal_metadata_matches_current_source: f0SourceVersion === sourceHash,
  formal_f0_row_count: f0Metadata.length,
  formal_f0_verified_count: f0Metadata.filter(r => r.verification_status === 'verified').length,
  formal_f0_area_flags_non_null: f0Metadata.filter(r => r.include_in_area_total !== null).length,
  formal_approval_count: metadata.approvals.length,
  approved_relationship_count: metadata.approved_relationships.length,
  stage2b_count_statuses: [...new Set(inventory.map(r => r.count_status))],
  residual_geometry_computed: false, residual_geojson_exported: false,
  authoritative_residual_area_m2: null, residual_piece_count: null,
  temporary_residual_ids_assigned: [],
  missing_rules: [
    'Which exact current polygon footprints are approved as spatial allocations, independent of room/logical-space counts.',
    'Whether collection fixture footprints allocate floor area or only represent furniture within a zone, and how any overlap is handled.',
    'How stair treads, landings and upper components project to a single basement allocation while their numbered-stair memberships remain pending.',
    'How shaft/car extent and Emergency Exit geometry are treated.',
    'Current-polygon bindings for Mechanical Room and SCRC and collection range/grouping cases.',
    'Any missing allocations for unlocated Center for Dewey Studies, Empty and Journals 1995 owner statements.'
  ]
};

function issueKind(r) {
  if (r.reconciliation_status === 'unresolved_owner_review') return 'functional_classification_and_geometry_role';
  if (r.reconciliation_status === 'technical_review_required') return 'geometry_representation';
  if (r.proposed_geometry_role === 'stair_component') return 'numbered_stair_membership';
  if (r.owner_statement === 'mechanical' || r.owner_statement === 'scrc') return 'owner_to_polygon_binding';
  if (r.review_group === 'journals-1995-membership') return 'collection_logical_membership';
  if (r.reconciliation_status === 'owner_verified_identity_pending') return 'collection_range_identity';
  return 'owner_meaning_reconciled';
}
function action(r) {
  const fid = r.source_attributes.FID;
  const select = `Select source FID = ${fid} (preserve it in a separate SRC_FID field when importing; ArcGIS may generate a different ObjectID). `;
  if (fid === floor.properties.FID) return select + 'Overlay the complete boundary with historical F-ALL OBJECTID 139; use it only as the basement extent. Establish the allocation mask before Erase.';
  switch (issueKind(r)) {
    case 'functional_classification_and_geometry_role': return select + 'Compare the basement plan, doorway and threshold with the polygon extent and base_heigh/height. Determine circulation area, door/threshold component, or structural element; do not assign circulation from the label.';
    case 'geometry_representation': return select + 'Overlay the elevator plan and section. Check whether the boundary depicts the shaft or car, and verify its extent before any area allocation.';
    case 'numbered_stair_membership': return select + 'Inspect plan and 3D height; map the component to owner Stair 1, 2 or 3. Review treads/landings/upper pieces together and define one footprint allocation without summing stacked components.';
    case 'owner_to_polygon_binding': return select + (r.owner_statement === 'mechanical'
      ? 'Confirm the equipment-room boundary against the owner plan. No entrance shown is not proof of no physical entrance. The removed prior FID 96 / FID_ 105 structure is absent; do not confuse it with current FID 96.'
      : 'Confirm the staff-only stacks boundary and the source spelling Stocks versus owner Stacks; preserve the source name pending a separate correction.');
    case 'collection_logical_membership': return select + 'Overlay FIDs 129, 131 and 136 and the owner collection plan; identify shared/separate Journals 1995 & Older membership and locate distinct Journals 1995. Do not infer three logical zones.';
    case 'collection_range_identity': return select + 'Compare the source range label and boundary with the owner collection plan. ' + r.owner_question;
    default: return select + 'Retain the reconciled owner meaning. Confirm the area inclusion and overlap rule before using this footprint in an allocation mask.';
  }
}
function tableRow(r) {
  const fid = r.source_attributes.FID;
  const formal = r.prior_feature_id ? byFeatureId.get(r.prior_feature_id) : null;
  // F6 synchronization advanced the all-floor dataset version while retaining
  // each F0 source hash, footprint and classification field unchanged.
  if (formal) assert.deepEqual({...formal, dataset_version: null}, {...r.prior_metadata, dataset_version: null});
  return {
    current_fid: fid, temporary_residual_id: null, existing_source_name: r.original_name,
    polygon_area_m2: metric.get(fid).area,
    current_classification: `${r.proposed_category} / ${r.proposed_subcategory} / ${r.proposed_geometry_role}`,
    classification_basis: r.owner_semantics_confirmed ? 'Stage 2B owner meaning; reconciliation status retained; no metadata import' : 'Candidate only; owner function and role unresolved',
    reconciliation_status: r.reconciliation_status, review_kind: issueKind(r),
    reason_for_unresolved_status: r.reconciliation_status === 'owner_verified_matched' ? null : r.reason,
    suggested_arcgis_pro_inspection_action: action(r),
    current_feature_id: r.feature_id, retained_secondary_fid: r.source_attributes.FID_,
    owner_semantics_confirmed: r.owner_semantics_confirmed,
    formal_metadata_category: formal?.space_category ?? null,
    formal_metadata_geometry_role: formal?.geometry_role ?? null,
    formal_metadata_status: formal ? 'unverified historical metadata; linked by proven predecessor geometry' : 'no formal predecessor metadata row',
    formal_metadata_source_sha256: formal?.source_sha256 ?? null,
    area_within_authoritative_footprint_m2: areaInFootprint.get(fid),
    area_outside_authoritative_footprint_m2: Math.max(0, metric.get(fid).area - areaInFootprint.get(fid)),
    verified_allocation_status: 'not_established', residual_overlap_status: 'not_calculated_allocation_rules_unverified',
    count_policy: r.count_policy, source_sha256: sourceHash
  };
}
const allRows = inventory.map(tableRow).sort((a, b) => a.current_fid - b.current_fid);
const review = allRows.filter(r => r.reconciliation_status !== 'owner_verified_matched');
const direct = review.filter(r => ['functional_classification_and_geometry_role', 'geometry_representation'].includes(r.review_kind));
const identity = review.filter(r => !direct.includes(r));
assert.equal(review.length, queue.filter(r => r.feature_id).length);
assert.deepEqual(review.map(r => r.current_feature_id).sort(), queue.filter(r => r.feature_id).map(r => r.feature_id).sort());
const unlocated = reconciliation.filter(r => !r.feature_id).map(r => ({
  current_fid: null, temporary_residual_id: null, existing_source_name: r.original_name,
  owner_statement_name: r.owner_statement_name ?? null, polygon_area_m2: null,
  current_classification: `${r.proposed_category} / ${r.proposed_subcategory} / ${r.proposed_geometry_role}`,
  reconciliation_status: r.reconciliation_status, lifecycle_status: r.lifecycle_status,
  reason_for_unresolved_status: r.reason, prior_feature_id: r.prior_feature_id,
  suggested_arcgis_pro_inspection_action: r.owner_question + ' Review the owner plan; do not assign a current FID or residual ID without geometry.'
}));
const countBy = (rows, k) => Object.fromEntries([...new Set(rows.map(r => r[k]))].map(v => [v, rows.filter(r => r[k] === v).length]));
const evidence = {
  verified: true, historical_dataset: combinedPath, historical_objectid: 139,
  historical_name: historical[0].properties.name, historical_base_heigh: historical[0].properties.base_heigh,
  historical_height: historical[0].properties.height, current_source: sourcePath,
  current_fid: floor.properties.FID, current_secondary_fid: floor.properties.FID_, current_name: floor.properties.name,
  current_base_heigh: floor.properties.base_heigh, current_height: floor.properties.height,
  current_polygon_area_m2: floorMetric.area, projection: diagnostics.projection,
  evidence: 'Unique reciprocal F0 full-footprint signature at established nine-decimal XY export precision; current raw geometry also exactly equals preserved Stage 2A and preceding Stage 2B floor geometry; owner floor_background meaning reliably reconciled.',
  matching_current_fids: matches.map(f => f.properties.FID),
  baseline_fid: baselineMatches[0].properties.FID, preceding_audit_fid: priorMatches[0].properties.FID,
  current_raw_geometry_sha256: objectHash(floor.geometry),
  export_precision_signature_sha256: objectHash(footprintSignature),
  warning: 'OBJECTID 139 is a historical combined-export identity, not current FID 139. Combined name Structure and height 0.5 differ from individual floor and height 0.2; identity here is horizontal footprint only.',
  source_hashes: Object.fromEntries([sourcePath, combinedPath, baselinePath, priorPath, metadataPath,
    `${base}/F0-LATEST-INVENTORY.json`, `${base}/F0-STAGE2B-RECONCILIATION.json`,
    `${base}/F0-OWNER-STATEMENTS.json`, `${base}/OWNER-REQUEST.txt`].map(p => [p, hash(p)]))
};
const summary = {
  audit_date: '2026-10-29', scope: 'Read-only F0 source and owner-record audit; new reports only',
  current_polygon_count: allRows.length, reconciliation_counts: countBy(allRows, 'reconciliation_status'),
  direct_function_or_geometry_questions: direct.length, other_identity_or_membership_questions: identity.length,
  current_review_rows: review.length, review_kind_counts: countBy(review, 'review_kind'),
  historical_or_unlocated_rows: unlocated.length,
  authoritative_footprint: evidence, residual_assessment: allocationGate,
  area_method: 'Existing project local spherical Lambert azimuthal equal-area at recorded Stage 2B origin; full polygon rings including holes; m2, not source Shape_Area.',
  polygon_areas_are_not_additive_allocated_area: true
};
csv('F0-REVIEW.csv', review);
csv('F0-FUNCTION-ROLE-REVIEW.csv', direct);
csv('F0-IDENTITY-MEMBERSHIP-REVIEW.csv', identity);
csv('F0-ALLOCATION-READINESS.csv', allRows);
csv('F0-HISTORICAL-UNLOCATED.csv', unlocated);
json('F0-REVIEW.json', review);
json('FOOTPRINT-VERIFICATION.json', evidence);
json('RESIDUAL-LIMITATION.json', allocationGate);
json('SUMMARY.json', summary);

const clean = v => String(v ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const mdTable = rows => [
  '| Current FID | Temporary residual ID | Exact source name | Polygon area (m²) | Current interpretation | Reconciliation status | Unresolved reason | ArcGIS Pro inspection |',
  '| --- | --- | --- | ---: | --- | --- | --- | --- |',
  ...rows.map(r => `| ${r.current_fid} | — | <code>${clean(r.existing_source_name)}</code> | ${r.polygon_area_m2.toFixed(6)} | ${clean(r.current_classification)} | ${r.reconciliation_status} | ${clean(r.reason_for_unresolved_status)} | ${clean(r.suggested_arcgis_pro_inspection_action)} |`)
].join('\n');
write('F0-REVIEW.md', `F0 review table — 2026-10-29\n\nCurrent FIDs and source names are from the current 148-polygon export. Areas are whole source polygons, not residual area and not additive allocations. Blank residual IDs mean residual geometry was not calculated. Interpretations below are Stage 2B owner meanings or explicit candidates, not imported formal classifications.\n\nFunction or geometry representation questions (${direct.length})\n\n${mdTable(direct)}\n\nIdentity or membership questions with owner meaning retained (${identity.length})\n\n${mdTable(identity)}\n`);
write('README.md', `F0 read-only unclassified and potentially unallocated-area audit — 2026-10-29

The latest F0 export has **${allRows.length} polygons**. **${direct.length} current polygons have unresolved function or geometry representation**, and **${identity.length} others have identity, range or membership questions with owner meanings retained**. Historical OBJECTID 139 is verified as **current FID ${floor.properties.FID}, exact name \`floor\`, ${floorMetric.area.toFixed(6)} m²**.

**Residual geometry, residual-area totals and a residual GeoJSON are withheld because the existing records do not establish a verified area-allocation mask or complete allocation rules.** This is an unknown result, not zero residual area. No existing feature is declared unallocated from its classification status. No area is automatically called circulation.

${mdTable(direct)}

The Elevator source name has a leading space, preserved in CSV/JSON. Emergency Exit's circulation category/role is only a candidate; its alternatives are circulation area, door/threshold component or structure. Elevator use is owner confirmed; shaft versus car representation remains unresolved.

The other ${identity.length} current questions comprise 96 stair components, three collection-range cases (FIDs 124, 130, 132), three journal-membership cases (129, 131, 136), Mechanical Room (146) and SCRC Stocks (147). The [full review table](F0-REVIEW.md) and [CSV](F0-REVIEW.csv) list every current case separately, with area, exact name, status, reason and ArcGIS Pro inspection action. They are not 106 unknown-use rooms. Forty-two polygons have reliably reconciled owner meanings: 29 structural polygons, two restrooms, seven collection zones, three collection fixtures and the floor background.

Footprint evidence

The complete XY boundary of F-ALL OBJECTID 139 uniquely and reciprocally matches current FID ${floor.properties.FID} using the project's established nine-decimal export precision. The individual floor's raw geometry also exactly matches Stage 2A FID ${baselineMatches[0].properties.FID} and preceding Stage 2B FID ${priorMatches[0].properties.FID}; retained secondary ID is FID_ ${floor.properties.FID_}. The current source bytes equal the latest inventory-refresh snapshot, and every current polygon exactly matches its retained preceding geometry. This is not a name, row-order or same-number ID join.

F-ALL calls OBJECTID 139 \`Structure\` with height 0.5; the authoritative individual export calls current FID 121 \`floor\` with height 0.2. These are known label/height discrepancies; the verified link concerns horizontal geometry. Current FID 139 is Emergency Exit. The former coincident Structure (preceding FID 96 / FID_ 105) is absent; current FID 96 is a different retained structural polygon. Full hashes and identity evidence: [FOOTPRINT-VERIFICATION.json](FOOTPRINT-VERIFICATION.json).

Potentially unallocated areas: separate assessment

The basement extent is established, but a reliable set difference requires an established allocation mask. The existing Stage 2B records explicitly mark all current count policies as \`report-only owner intent; not imported or allocated\`. The isolated formal metadata has zero approvals, zero approved relationships, null area-inclusion flags for all ${f0Metadata.length} historical F0 rows and an older source hash. The lack of a formal import alone does not invalidate owner testimony; the decisive gap is that the owner statements do not completely define current polygon inclusion, fixture treatment, stair projection, or overlap/allocation rules. They confirm functions and some count-once policies. Those are different from a spatial allocation mask.

Subtracting all 147 non-background polygons would silently accept pending identities/roles and fixture rules. Subtracting only the 41 non-background \`owner_verified_matched\` polygons would introduce another unapproved rule and leave known stair/collection/room geometries in the difference. Treating null flags as exclusions would falsely label the whole basement unallocated. None is adopted here.

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

Areas were recomputed with the existing project spherical Lambert azimuthal equal-area method at origin ${JSON.stringify(diagnostics.projection.origin)}, using full rings and holes. Source Shape_Area units are not assumed to be m². All 148 current geometries passed validity checks; the maximum difference from the refreshed inventory areas was ${maxAreaDelta} m². Areas in this audit are whole polygons unless a column explicitly says intersection with the footprint; no authoritative allocated or residual total is reported.

SHA-256 checks cover ${Object.keys(protectedHashes).length} pre-existing workspace files, including all source GeoJSON, application code, owner records and earlier audits. They are unchanged. New files are confined to this report directory. No approvals, classifications, FIDs or application behavior were modified. No application build/browser tests were needed for this report-only task.

Reproduce from the repository root with \`node ${out}/run-audit.cjs\`. This audit is pinned to the verified source/record snapshots and fails if they change. [SUMMARY.json](SUMMARY.json) and [VALIDATION.json](VALIDATION.json) contain machine-readable results.
`);
assert.deepEqual(changedProtected(), [], 'Pre-existing files changed during audit');
json('VALIDATION.json', {
  current_source_matches_latest_snapshot: true, current_inventory_and_reconciliation_match_source: true,
  all_current_geometries_equal_retained_predecessors: true,
  historical_139_unique_reciprocal_current_match: true,
  footprint_matches_two_preserved_individual_snapshots: true,
  valid_current_geometries: metric.size, maximum_area_recalculation_delta_m2: maxAreaDelta,
  unresolved_queue_complete: true, direct_review_rows: direct.length, other_current_review_rows: identity.length,
  residual_gate_enforced: true, residual_geometry_computed: false,
  protected_file_count: Object.keys(protectedHashes).length, changed_protected_files: changedProtected(),
  application_build_run: false, browser_tests_run: false
});
console.log(JSON.stringify({current_polygons: allRows.length, direct_review_rows: direct.length,
  other_current_review_rows: identity.length, verified_footprint_fid: floor.properties.FID,
  footprint_area_m2: floorMetric.area, allocation_rules_verified: false, residual_geojson_exported: false,
  protected_files_unchanged: Object.keys(protectedHashes).length,
  direct_cases: direct.map(r => ({fid: r.current_fid, area_m2: r.polygon_area_m2, area_inside_footprint_m2: r.area_within_authoritative_footprint_m2}))}, null, 2));
