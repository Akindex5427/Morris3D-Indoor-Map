import {describe,it,expect} from 'vitest';
import {createMetadataSeed} from './proposals';
import {applyApprovalBatch,restoreMetadataSnapshot,validateMetadata} from './metadata';

const context={dataset_version:'synthetic-v1',sources:[{floor_id:1,source_dataset:'/test.geojson',source_sha256:'a'.repeat(64)}],display_links:[{display_id:'unresolved',match_status:'unmatched',feature_id:null}],features:['Help Desk','Geospatial Resources','Floor','Other'].map((name,i)=>({feature_id:`F${i===3?2:1}:${i}`,floor_id:i===3?2:1,source_dataset:'/test.geojson',source_export_id:{field:'OBJECTID',value:String(i)},source_sha256:'a'.repeat(64),footprint_hash:'b'.repeat(64),original_name:name,feature:{properties:{name}}}))};
const seed=()=>createMetadataSeed(context);
const review={reviewed_by:'Synthetic test reviewer',reviewed_at:'2026-10-27T12:00:00Z',evidence:'Synthetic test decision, not a real owner approval'};
const event=(decision,target_id,approved_values)=>({approval_id:`test:${decision}:${target_id}`,decision,target_id,approved_values,...review});
const batch=(metadata,decisions)=>({schema_version:'morris-space-approvals/v1',dataset_version:context.dataset_version,base_revision:metadata.revision,decisions});
const apply=(metadata,...events)=>applyApprovalBatch(metadata,batch(metadata,events),context);
const member=(space,ids,floors=[1],evidence=null)=>event('approve_membership',space,{floor_ids:floors,feature_ids:ids,cross_floor_evidence:evidence});
const parent=(child,space,evidence=null)=>event('approve_parent',child,{parent_space_id:space,cross_floor_evidence:evidence});
const classification=()=>event('approve_classification','F1:0',{geometry_role:'service_fixture',space_category:'library_services',space_subcategory:'service_desk',secondary_tags:[],assignable:null,include_in_room_count:false,include_in_area_total:null});
const withSpaces=()=>apply(seed(),member('desk',['F1:0']),member('resources',['F1:1']),member('background',['F1:2']),member('upstairs',['F2:3'],[2]));

describe('isolated metadata validation',()=>{
 it('keeps all approvals and memberships empty and flags unresolved F-ALL',()=>{
  const m=seed(),result=validateMetadata(m,context);expect(result.valid).toBe(true);expect(result.warnings).toHaveLength(1);
  expect(m.approvals).toEqual([]);expect(m.features.every(f=>f.geometry_role==='unknown'&&f.logical_space_id===null&&f.parent_space_id===null&&f.include_in_room_count===null)).toBe(true);
 });
 it.each([
  ['unknown feature',m=>m.features[0].feature_id='unknown'],
  ['duplicate feature',m=>m.features.push(structuredClone(m.features[0]))],
  ['missing feature',m=>m.features.pop()],
  ['invalid role',m=>m.features[0].geometry_role='invented'],
  ['invalid category',m=>m.features[0].space_category='invented'],
  ['invalid subcategory',m=>m.features[0].proposed_space_subcategory='invented'],
  ['stale source',m=>m.sources[0].source_sha256='0'.repeat(64)],
  ['stale feature hash',m=>m.features[0].source_sha256='0'.repeat(64)],
  ['stale footprint',m=>m.features[0].footprint_hash='0'.repeat(64)],
  ['stale dataset',m=>m.dataset_version='old'],
  ['unapproved verified',m=>m.features[0].verification_status='verified'],
  ['unapproved actual category',m=>m.features[0].space_category='library_services'],
  ['invented verification date',m=>m.features[0].last_verified=review.reviewed_at],
  ['forged F-ALL mapping',m=>m.display_links[0].feature_id='F1:0'],
  ['malformed array',m=>m.features=null],
  ['unapproved membership',m=>m.features[0].logical_space_id='invented'],
  ['unknown approval target',m=>m.approvals.push(event('approve_classification','missing',classification().approved_values))],
 ])('rejects %s',(_name,mutate)=>{const m=seed();mutate(m);expect(validateMetadata(m,context).valid).toBe(false);});
 it('imports explicit classification atomically without changing source or proposal evidence',()=>{
  const m=seed(),before=JSON.stringify({m,context}),next=apply(m,classification());
  expect(next.features[0].verification_status).toBe('verified');expect(next.features[0].proposed_geometry_role).toBe('unknown');
  expect(next.revision).toBe(1);expect(validateMetadata(next,context).valid).toBe(true);expect(JSON.stringify({m,context})).toBe(before);
  next.features[0].include_in_room_count=true;expect(validateMetadata(next,context).valid).toBe(false);
 });
 it('rejects stale/empty imports, incomplete values and conflicting decisions',()=>{
  const m=seed();expect(()=>applyApprovalBatch(m,{...batch(m,[classification()]),base_revision:1},context)).toThrow();
  expect(()=>applyApprovalBatch(m,{...batch(m,[classification()]),dataset_version:'old'},context)).toThrow();
  expect(()=>apply(m)).toThrow();expect(()=>apply(m,classification(),{...classification(),approval_id:'different'})).toThrow();
  const bad=classification();delete bad.approved_values.assignable;expect(()=>apply(m,bad)).toThrow();
 });
 it('keeps membership independent from classification and counts',()=>{
  const m=withSpaces();expect(m.logical_spaces).toHaveLength(4);expect(m.features[0].component_of).toBe('desk');
  expect(m.features[0].verification_status).toBe('unverified');expect(m.features[0].include_in_room_count).toBeNull();
  const next=apply(m,parent('desk','resources'));expect(next.features[0].parent_space_id).toBe('resources');expect(m.features[0].parent_space_id).toBeNull();
 });
 it('rejects duplicate, missing and unsupported cross-floor membership',()=>{
  expect(()=>apply(seed(),member('bad',['F1:0','F1:0']))).toThrow();expect(()=>apply(seed(),member('bad',['missing']))).toThrow();
  expect(()=>apply(withSpaces(),member('duplicate',['F1:0']))).toThrow();
  expect(()=>apply(seed(),member('cross',['F1:0','F2:3'],[1,2]))).toThrow();
  expect(apply(seed(),member('cross',['F1:0','F2:3'],[1,2],'Synthetic documented multi-floor space')).logical_spaces).toHaveLength(1);
 });
 it('rejects missing parents, self-parent, cycles and contradictory parents',()=>{
  const m=withSpaces(),before=JSON.stringify(m);
  expect(()=>apply(m,parent('desk','missing'))).toThrow();expect(()=>apply(m,parent('desk','desk'))).toThrow();
  expect(()=>apply(m,parent('desk','resources'),parent('resources','desk'))).toThrow();
  expect(()=>apply(apply(m,parent('desk','resources')),parent('desk','upstairs','test support'))).toThrow();expect(JSON.stringify(m)).toBe(before);
 });
 it('requires cross-floor support and never treats a Floor surface as a functional parent',()=>{
  const m=withSpaces();expect(()=>apply(m,parent('desk','upstairs'))).toThrow();
  expect(apply(m,parent('desk','upstairs','Synthetic verified functional relationship')).approved_relationships).toHaveLength(1);
  expect(()=>apply(m,parent('desk','background'))).toThrow();
 });
 it('rejects tampered approval provenance and contradictory counting',()=>{
  const m=apply(seed(),classification());m.features[0].verified_by='another reviewer';expect(validateMetadata(m,context).valid).toBe(false);
  const e=classification();Object.assign(e.approved_values,{geometry_role:'structural_component',space_category:'structure_non_occupiable',space_subcategory:'modeled_structure',include_in_room_count:true});expect(()=>apply(seed(),e)).toThrow();
 });
 it('restores older snapshots as new auditable revisions',()=>{
  const original=seed(),current=apply(original,classification()),restored=restoreMetadataSnapshot(current,original,context,review);
  expect(restored.revision).toBe(2);expect(restored.features[0].verification_status).toBe('unverified');expect(restored.history.at(-1).action).toBe('restore_snapshot');expect(current.features[0].verification_status).toBe('verified');
  expect(()=>restoreMetadataSnapshot(current,current,context,review)).toThrow();expect(()=>restoreMetadataSnapshot(current,original,context,{})).toThrow();
 });
});
