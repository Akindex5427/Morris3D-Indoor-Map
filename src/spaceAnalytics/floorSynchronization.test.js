import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {compareFloorExports,assessCombinedExport,migrateFloorMetadata} from './floorSynchronization';
import {loadSpaceAnalyticsContext,sha256} from '../../scripts/spaceAnalyticsContext.mjs';
import {validateMetadata,applyApprovalBatch} from './metadata';
import {prepareSpatialDataset} from './relationships';
import {buildFloorCatalog} from '../utils/roomCatalog';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const before=read('docs/f6-geometry-sync/f6-before.geojson'),current=read('public/rooms-level-6-WGS.geojson');
const oldCombined=read('docs/f6-geometry-sync/combined-before.geojson'),combined=read('public/rooms-all-WGS-v6.geojson');
const previous=read('data/space-analytics/metadata.proposals.v1.json'),context=loadSpaceAnalyticsContext();
const delta=compareFloorExports(before,current,6),partitions=delta.added.map(r=>r.feature_id);

describe('targeted F6 geometry synchronization',()=>{
 it('finds every removed/added feature and the separate height-only change',()=>{
  expect(delta.removed.map(r=>r.feature.properties.OBJECTID)).toEqual([137,138,139,140]);
  expect(delta.added.map(r=>r.feature.properties.OBJECTID)).toEqual([147,148,149,150]);expect(delta.unchanged).toHaveLength(133);
  expect(delta.modified).toHaveLength(1);expect(delta.modified[0]).toMatchObject({geometry_changed:false,changed_properties:['height']});
  expect(delta.modified[0].before.properties.height).toBe(.3);expect(delta.modified[0].after.properties.height).toBe(4);
 });
 it('is independent of row order and retains the verified baseline hash',()=>{
  const reversed={...current,features:[...current.features].reverse()};expect(compareFloorExports(before,reversed,6).removed).toEqual(delta.removed);
  expect(sha256(fs.readFileSync('docs/f6-geometry-sync/f6-before.geojson'))).toBe(previous.sources.find(s=>s.floor_id===6).source_sha256);
 });
 it('assesses the owner replacement without mutating either export or any unrelated floor',()=>{
  const snapshot=JSON.stringify({oldCombined,combined}),r=assessCombinedExport(oldCombined,combined,current,6);
  expect(r.removed_ids).toEqual(['6:1508','6:1509','6:1510','6:1511']);expect(r.added_ids).toEqual(['6:1609','6:1610','6:1611','6:1612','6:1613']);expect(combined.features).toHaveLength(1609);
  expect(r.preserved_objects).toBe(1604);expect(r.modified_ids).toEqual([]);expect(r.unrelated_floor_changes).toEqual([]);expect(JSON.stringify({oldCombined,combined})).toBe(snapshot);
 });
 it('confirms owner-export elevations and flags differing XY without duplicate footprints',()=>{
  const r=assessCombinedExport(oldCombined,combined,current,6);expect(r.duplicate_footprints).toEqual([]);expect(r.geometry_issues).toEqual([]);
  expect(r.comparisons).toHaveLength(5);expect(r.comparisons.every(c=>c.exact_export_precision_matches.length===0)).toBe(true);
  const best=r.comparisons.map(c=>c.overlap_candidates[0]);expect(best.map(r=>r.feature_b_id.split(':').at(-1))).toEqual(['147','148','149','150','146']);
  expect(best[4].intersection_over_union).toBeGreaterThan(.999);expect(best[3].intersection_over_union).toBeLessThan(.55);
  for(const id of [1609,1610,1611,1612])expect(combined.features.find(f=>f.properties.OBJECTID===id).properties).toMatchObject({base_heigh:26,height:28});
  expect(combined.features.find(f=>f.properties.OBJECTID===1613).properties).toMatchObject({base_heigh:26,height:30});
 });
 it('rejects duplicate identities and detects unrelated edits instead of reconciling them',()=>{
  const duplicate=structuredClone(combined);duplicate.features.push(structuredClone(duplicate.features[0]));expect(()=>assessCombinedExport(oldCombined,duplicate,current,6)).toThrow(/Duplicate/);
  const unrelated=structuredClone(combined);unrelated.features[0].properties.name='changed';expect(assessCombinedExport(oldCombined,unrelated,current,6).unrelated_floor_changes).toHaveLength(1);
 });
 it('validates all 138 F6 footprints, keeps partitions searchable, and leaves mismatched display links unresolved',()=>{
  const index=prepareSpatialDataset(context.datasets);expect(index.issues).toEqual([]);expect(index.floors.get(6)).toHaveLength(138);
  const catalog=buildFloorCatalog(current,6);expect(catalog.summary.excluded).toEqual([]);
  for(const id of partitions){expect(catalog.entries.some(e=>e.key===id)).toBe(true);expect(context.display_links.filter(l=>l.authoritative_feature_id===id&&l.match_status==='matched')).toHaveLength(0);}
  for(const id of [1609,1610,1611,1612,1613])expect(context.display_links.find(l=>l.display_id.endsWith(`:OBJECTID:${id}`)).match_status).toBe('unmatched');
 });
 it('preserves unrelated owner-approved classifications and all approval payloads during version migration',()=>{
  const oldContext={...previous},id='/rooms-level-04-WGS.geojson#F4:OBJECTID:7';
  const approval={schema_version:'morris-space-approvals/v1',dataset_version:previous.dataset_version,base_revision:previous.revision,decisions:[{approval_id:'synthetic-test-approval',decision:'approve_classification',target_id:id,approved_values:{geometry_role:'service_fixture',space_category:'library_services',space_subcategory:'service_desk',secondary_tags:[],assignable:null,include_in_room_count:false,include_in_area_total:null},reviewed_by:'Synthetic test reviewer',reviewed_at:'2026-10-27T12:00:00Z',evidence:'Synthetic approval for preservation test only'}]};
  const approved=applyApprovalBatch(previous,approval,oldContext),next=migrateFloorMetadata(approved,context,6,partitions);
  expect(next.approvals).toEqual(approved.approvals);expect({...next.features.find(f=>f.feature_id===id),dataset_version:previous.dataset_version}).toEqual(approved.features.find(f=>f.feature_id===id));
  expect(approved.features.find(f=>f.feature_id===id).geometry_role).toBe('service_fixture');
 });
 it('keeps booth metadata provisional, records zero enclosed rooms, and blocks allocated area without a zone',()=>{
  const metadata=read('data/space-analytics/metadata.f6-sync.v1.json');expect(validateMetadata(metadata,context).valid).toBe(true);
  for(const id of partitions){expect(metadata.features.find(f=>f.feature_id===id)).toMatchObject({proposed_geometry_role:'structural_component',proposed_space_category:'study_learning',proposed_space_subcategory:'semi_private_study_booths',proposed_enclosed_room_count:0,study_station_count:null,allocated_floor_area_m2:null,functional_zone_footprint_id:null,verification_status:'unverified',proposed_include_in_room_count:false});}
  const f=metadata.features.find(f=>f.feature_id===partitions[0]);f.allocated_floor_area_m2=12;expect(validateMetadata(metadata,context).valid).toBe(false);
  f.allocated_floor_area_m2=null;f.proposed_enclosed_room_count=1;expect(validateMetadata(metadata,context).valid).toBe(false);
 });
 it('rejects unrelated source changes and never silently overwrites verified changed geometry',()=>{
  const bad=structuredClone(context);bad.features.find(f=>f.floor_id===4).source_sha256='bad';expect(()=>migrateFloorMetadata(previous,bad,6,partitions)).toThrow(/Unrelated/);
  const verified=structuredClone(previous);verified.features.find(f=>f.feature_id===delta.removed[0].feature_id).verification_status='verified';expect(()=>migrateFloorMetadata(verified,context,6,partitions)).toThrow(/Verified/);
 });
 it('retains historical records with explicit supersession and owner F4 confirmations',()=>{
  const ledger=read('docs/f6-geometry-sync/superseded-records.json'),metadata=read('data/space-analytics/metadata.f6-sync.v1.json');
  for(const f of previous.features.filter(f=>f.floor_id===6))expect(ledger.records.some(r=>r.record_id===f.feature_id&&r.record_status==='superseded')).toBe(true);
  expect(metadata.owner_confirmations.find(c=>c.confirmation_id==='owner-f4-study-0420d-one-room').enclosed_room_count).toBe(1);
  expect(metadata.owner_confirmations.find(c=>c.confirmation_id==='owner-f4-help-desk-counter').statement).toContain('Physical service counter');
  expect(metadata.approvals).toEqual(previous.approvals);
 });
});
