"""Lightweight report refresh. Verifies the preceding byte snapshot before reusing geometry results."""
import copy
import csv
import hashlib
import json
import pathlib
import re
import shutil

ROOT = pathlib.Path('docs/space-analytics-stage-2b-f0')
SOURCE = pathlib.Path('public/rooms-basement-WGS.geojson')
SOURCE_KEY = '/rooms-basement-WGS.geojson#F0:FID:'
EXPECTED_PRIOR = '9be596896c68c09320b932f48dfd42c8880892547847967f1bca268f7b4e9011'
HISTORY = ROOT / 'history' / ('preceding-' + EXPECTED_PRIOR[:12])
REFRESH = ROOT / 'inventory-refresh'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def write_csv(path, rows):
    fields = list(dict.fromkeys(k for row in rows for k in row))
    with path.open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for row in rows:
            cells = {}
            for k, v in row.items():
                s = '' if v is None else json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list, bool)) else str(v)
                cells[k] = "'" + s if s.startswith(('=', '+', '-', '@', '\t', '\r')) else s
            writer.writerow(cells)


def feature_spans(path):
    text = path.read_text(encoding='utf-8')
    pos = text.index('[', text.index('"features"')) + 1
    result = []
    decoder = json.JSONDecoder()
    while text[pos] != ']':
        obj, end = decoder.raw_decode(text, pos)
        result.append((obj, text[pos:end]))
        pos = end + (text[end] == ',')
    return result


protected = {str(p): digest(p) for directory in ['src', 'public', 'data', 'docs', 'scripts', 'review']
             for p in pathlib.Path(directory).rglob('*') if p.is_file() and ROOT not in p.parents}
baseline_dir = HISTORY if HISTORY.exists() else ROOT
old_summary = read(baseline_dir / 'F0-SUMMARY.json')
assert old_summary['source_hash'] == EXPECTED_PRIOR
old_rows = read(baseline_dir / 'F0-LATEST-INVENTORY.json')
old_reconciliation = read(baseline_dir / 'F0-STAGE2B-RECONCILIATION.json')
current_spans = feature_spans(SOURCE)
current_by_secondary = {f['properties']['FID_']: (f, text) for f, text in current_spans}
assert len(current_by_secondary) == len(current_spans)
stage2a = {f['properties']['FID']: (f, text) for f, text in feature_spans(ROOT / 'baseline-F0.geojson')}

# Recover exact historical bytes, then check the independently recorded SHA-256.
# This is a proof check, not an assumption that current geometry is unchanged.
parts = []
for row in old_rows:
    props = row['source_attributes']
    item = current_by_secondary.get(props['FID_'])
    if item is None:
        item = stage2a[int(row['prior_feature_id'].split(':')[-1])]
    f, text = item
    text = re.sub(r'"id":\d+', lambda _: '"id":' + str(props['FID']), text, count=1)
    text = re.sub(r'"FID":\d+', lambda _: '"FID":' + str(props['FID']), text, count=1)
    if props['name'] != f['properties']['name']:
        text = text.replace('"name":' + json.dumps(f['properties']['name']), '"name":' + json.dumps(props['name']))
    assert json.loads(text)['properties'] == props
    parts.append(text)
prior_bytes = ('{"type":"FeatureCollection","features":[' + ','.join(parts) + ']}').encode()
assert hashlib.sha256(prior_bytes).hexdigest() == EXPECTED_PRIOR, 'Previous snapshot cannot be verified; do not reuse geometry results.'
prior_features = json.loads(prior_bytes)['features']
prior_by_secondary = {f['properties']['FID_']: f for f in prior_features}
old_by_secondary = {r['source_attributes']['FID_']: r for r in old_rows}
removed = [r for secondary, r in old_by_secondary.items() if secondary not in current_by_secondary]
added = [f for secondary, (f, _) in current_by_secondary.items() if secondary not in old_by_secondary]
assert not added, 'New features require a fresh classification audit.'
assert len(removed) == 1 and removed[0]['feature_id'] == SOURCE_KEY + '96'
mapping = {}
attribute_changes = []
for secondary, (f, _) in current_by_secondary.items():
    previous = prior_by_secondary[secondary]
    assert f['geometry'] == previous['geometry'], 'Changed geometry requires fresh spatial analysis.'
    row = old_by_secondary[secondary]
    mapping[row['feature_id']] = SOURCE_KEY + str(f['properties']['FID'])
    changed = {k: {'before': previous['properties'].get(k), 'after': f['properties'].get(k)}
               for k in previous['properties'].keys() | f['properties'].keys()
               if previous['properties'].get(k) != f['properties'].get(k)}
    if changed:
        attribute_changes.append({'preceding_id': row['feature_id'], 'current_id': mapping[row['feature_id']], 'changes': changed})

# Preserve the complete preceding report set before replacing current inventory/queue artifacts.
if not HISTORY.exists():
    HISTORY.mkdir(parents=True)
    for p in ROOT.glob('F0-*'):
        if p.is_file():
            shutil.copyfile(p, HISTORY / p.name)
    (HISTORY / 'F0-AUTHORITATIVE-SNAPSHOT.geojson').write_bytes(prior_bytes)
REFRESH.mkdir(exist_ok=True)
write_json(REFRESH / 'READONLY-START-HASHES.json', protected)
shutil.copyfile(SOURCE, REFRESH / 'F0-AUTHORITATIVE-SNAPSHOT.geojson')

old_diagnostics = read(HISTORY / 'F0-GEOMETRY-DIAGNOSTICS.json')
relationships = []
pair_mapping = {}
for pair in old_diagnostics['relationships']:
    a, b = pair['feature_a_id'], pair['feature_b_id']
    if a not in mapping or b not in mapping:
        continue
    updated = copy.deepcopy(pair)
    for field in ['feature_a_id', 'feature_b_id', 'geometric_container_id', 'geometric_contained_id']:
        if updated.get(field):
            updated[field] = mapping[updated[field]]
    updated['relationship_id'] = 'spatial-pair-v1:' + json.dumps([0, *sorted([mapping[a], mapping[b]])], separators=(',', ':'))
    pair_mapping[pair['relationship_id']] = updated['relationship_id']
    relationships.append(updated)
write_json(REFRESH / 'F0-RETAINED-SPATIAL-RELATIONSHIPS.json', {
    'method': 'Retained unchanged-geometry pairs from preceding audit; deleted-feature pairs removed, IDs remapped. No new intersections computed.',
    'projection': old_diagnostics['projection'], 'relationships': relationships})

updated_rows = []
for f, _ in current_spans:
    row = copy.deepcopy(old_by_secondary[f['properties']['FID_']])
    previous_id = row['feature_id']
    row['preceding_audit_feature_id'] = previous_id
    row['feature_id'] = mapping[previous_id]
    row['source_attributes'] = f['properties']
    row['original_name'] = f['properties']['name']
    row['source_sha256'] = digest(SOURCE)
    row['geometry_evidence'] = 'Exact retained geometry; preceding complete snapshot SHA-256 verified.'
    row['stage2a_lifecycle_status'] = row['lifecycle_status']
    row['stage2a_changed_properties'] = row['changed_properties']
    row['lifecycle_status'] = 'identifier_changed' if previous_id != row['feature_id'] else 'retained_feature'
    row['changed_properties'] = next((list(r['changes']) for r in attribute_changes if r['preceding_id'] == previous_id), [])
    for field in ['geometric_container_candidates', 'geometric_child_candidates']:
        row[field] = [mapping[v] for v in row[field] if v in mapping]
    row['overlap_review_pairs'] = [pair_mapping[v] for v in row['overlap_review_pairs'] if v in pair_mapping]
    if row['review_group'] in mapping:
        row['review_group'] = mapping[row['review_group']]
    if row['owner_statement'] == 'mechanical':
        row['reason'] = 'The preceding overlapping structure was removed. The owner function/count policy is preserved; explicit current-polygon binding remains pending.'
        row['owner_question'] = 'Confirm this Mechanical Room polygon is the enclosed equipment room you described, with no entrance shown on the plan.'
    updated_rows.append(row)

historical = [copy.deepcopy(r) for r in old_reconciliation if r.get('feature_id') is None]
reconciliation = updated_rows + historical
unresolved = sorted([r for r in reconciliation if r['reconciliation_status'] != 'owner_verified_matched'],
                    key=lambda r: (r['priority'], int(r['feature_id'].split(':')[-1]) if r.get('feature_id') else float('inf'), r.get('owner_statement_name') or r.get('prior_feature_id') or ''))
for stem, rows in [('F0-LATEST-INVENTORY', updated_rows), ('F0-STAGE2B-RECONCILIATION', reconciliation), ('F0-UNRESOLVED-VERIFICATION', unresolved)]:
    write_json(ROOT / (stem + '.json'), rows)
    write_csv(ROOT / (stem + '.csv'), rows)
    with (ROOT / (stem + '.csv')).open(encoding='utf-8-sig', newline='') as stream:
        assert len(list(csv.DictReader(stream))) == len(rows)

rooms = [r for r in updated_rows if r['owner_statement'] in ['mechanical', 'scrc']]
assert len(rooms) == 2
assert len(updated_rows) == 148 and len(unresolved) == 110
assert all(r['source_attributes']['FID_'] != 105 for r in updated_rows)
assert all(r['preceding_audit_feature_id'] != SOURCE_KEY + '96' for r in updated_rows)
assert not any(p['relationship_type'] == 'near_coincident' for p in relationships)
summary = {
    'scope': 'Lightweight read-only inventory/queue refresh; not a new F-ALL or full classification audit',
    'preceding_source_sha256': EXPECTED_PRIOR, 'current_source_sha256': digest(SOURCE),
    'preceding_count': len(old_rows), 'current_count': len(updated_rows),
    'removed': [{'preceding_feature_id': r['feature_id'], 'name': r['original_name'], 'secondary_FID_': r['source_attributes']['FID_']} for r in removed],
    'added': [], 'retained_geometry_changes': 0, 'identifier_changes': sum(k != v for k, v in mapping.items()),
    'attribute_changes': attribute_changes,
    'rooms': [{'current_id': r['feature_id'], 'preceding_id': r['preceding_audit_feature_id'], 'secondary_FID_': r['source_attributes']['FID_'], 'name': r['original_name'], 'area_m2': r['area_m2']} for r in rooms],
    'current_status_counts': {s: sum(r['reconciliation_status'] == s for r in updated_rows) for s in sorted({r['reconciliation_status'] for r in updated_rows})},
    'unresolved_rows': len(unresolved), 'unresolved_current_rows': sum(r.get('feature_id') is not None for r in unresolved),
    'retained_historical_or_unlocated_rows': len(historical), 'preceding_snapshot_hash_verified': True,
    'source_geometry_modified_by_refresh': False, 'full_spatial_analysis_rerun': False, 'fall_reaudited': False}
write_json(REFRESH / 'SUMMARY.json', summary)
write_csv(REFRESH / 'F0-ID-CROSSWALK.csv', [{'preceding_id': k, 'current_id': v} for k, v in mapping.items()])
report = f'''# Latest F0 inventory refresh

**The former overlapping structure is removed. Mechanical Room and SCRC remain. F0 has 148 polygons, down from 149.**

| Feature | Current exact identifier | Preceding identifier | Retained secondary ID |
| --- | --- | --- | --- |
| Mechanical Room (No Access) | {rooms[0]['feature_id']} | {rooms[0]['preceding_audit_feature_id']} | FID_ 156 |
| SCRC Stocks (Staff Only) | {rooms[1]['feature_id']} | {rooms[1]['preceding_audit_feature_id']} | FID_ 157 |
| Removed structure | No current counterpart | {removed[0]['feature_id']} | FID_ 105 (absent) |

There are **no other additions, deletions, or retained-geometry changes** relative to the preceding corrected-file audit. Fifty-two FIDs (and matching top-level feature IDs) were renumbered. The only non-identifier attribute edit is removal of the leading space from the Mechanical Room name. SCRC still says “Stocks”; no spelling change was made by this refresh.

Current FID 96 belongs to the former FID 97 Structure (FID_ 106); its existence does not mean the deleted FID 96 footprint remains. Matching used the preserved secondary identifiers plus exact geometry, not row position or the reused FID alone. The complete preceding snapshot was reconstructed and its SHA-256 verified against the hash recorded before this edit. All 148 retained geometries match that verified snapshot exactly.

The unresolved queue now contains **110 records**: 106 current features, one older historical case, and three unlocated owner statements. The deleted structure's review row and all references to its overlap are removed. The Mechanical Room question retains the pending owner-to-polygon binding but no longer asks about the removed overlapping structure. The 104 identity/membership questions, one Elevator technical-role question, and one Emergency Exit classification question remain. Forty-two current features remain reliably reconciled. No approval was silently added; this does not close Stage 2B.

Updated artifacts:

- [Current inventory](F0-LATEST-INVENTORY.csv)
- [Current reconciliation](F0-STAGE2B-RECONCILIATION.csv)
- [Current unresolved verification queue](F0-UNRESOLVED-VERIFICATION.csv)
- [Identifier crosswalk](inventory-refresh/F0-ID-CROSSWALK.csv)
- [Refresh evidence and counts](inventory-refresh/SUMMARY.json)
- [Preserved preceding full audit](history/preceding-{EXPECTED_PRIOR[:12]}/F0-STAGE2B-RECHECK-SUMMARY.md)

Source SHA-256: {digest(SOURCE)}. Preceding source SHA-256: {EXPECTED_PRIOR}.

The original full-audit summary, F-ALL report, diagnostics and F0-SUMMARY.json describe the preceding snapshot. They are historical, not fresh results for this edit. F-ALL was not re-audited. Retained area and relationship results were reused only after proving geometry unchanged; deleted-feature relationships were filtered and current IDs remapped. No new intersections, classification import, application build or browser test was performed. Source data, application code and owner metadata were not modified.
'''
(ROOT / 'LATEST-REFRESH.md').write_text(report, encoding='utf-8')
for name in ['F0-STAGE2B-RECHECK-SUMMARY.md', 'F0-FALL-CONSISTENCY.md']:
    previous = (HISTORY / name).read_text(encoding='utf-8')
    (ROOT / name).write_text('> Historical full-audit snapshot. See [LATEST-REFRESH.md](LATEST-REFRESH.md) for the latest F0 inventory and queue. This full report was not rerun.\n\n' + previous, encoding='utf-8')
changed = [p for p, h in protected.items() if digest(pathlib.Path(p)) != h]
assert changed == []
write_json(REFRESH / 'VALIDATION.json', {
    'preceding_snapshot_sha256_matches': True, 'all_retained_geometries_equal': True,
    'removed_structure_absent': True, 'both_rooms_present': True, 'queue_deleted_row_absent': True,
    'csv_roundtrip_counts_passed': True, 'protected_files': len(protected), 'changed_protected_files': changed,
    'browser_test_run': False, 'application_build_run': False})
print(json.dumps({k: v for k, v in summary.items() if k != 'attribute_changes'}, indent=2))
