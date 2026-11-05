import {describe,it,expect} from 'vitest';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader';
import {createMetricProjection} from '../utils/roomCorrespondence';
import {compareMetricRows,relationshipId,prepareSpatialDataset,analyzeSpatialDataset,createSpatialRelationshipService,buildRelationshipReview,investigateSameNameGroups} from './relationships';
import {createSpatialWorkerHandler} from './spatialRelationships.worker';
import {loadSpaceAnalyticsContext} from '../../scripts/spaceAnalyticsContext.mjs';
import {createMetadataSeed,proposeClassification} from './proposals';
import fs from 'node:fs';
const reader=new GeoJSONReader();
const ring=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const metric=(key,polygons,floor=1)=>{const geometry=reader.read({type:'MultiPolygon',coordinates:polygons}),points=polygons.flat(2);return {key,floor,name:key,coordinates:polygons,metric:geometry,area:geometry.getArea(),bounds:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]};};
const rect=(key,x,y,w,h,floor=1)=>metric(key,[[ring(x,y,w,h)]],floor);
const projection=createMetricProjection([-89.22,37.715]);
const feature=(key,x,y,w,h,name=key)=>({type:'Feature',properties:{name,floor:1,level:1,height:2,base_height:0,__roomSearchKey:key},geometry:{type:'Polygon',coordinates:[ring(x,y,w,h).map(p=>projection.invert(p))]}});
const dataset=features=>({1:{type:'FeatureCollection',features}});
describe('same-floor geometric relationships',()=>{
 it('reports exact containment and its inverse with directional ratios and stable pair ID',()=>{
  const a=rect('a',0,0,10,10),b=rect('b',1,1,2,2),forward=compareMetricRows(a,b),reverse=compareMetricRows(b,a);
  expect(forward).toMatchObject({relationship_type:'contains',intersection_area_m2:4,overlap_pct_a:4,overlap_pct_b:100,containment_ratio:1,intersection_over_union:.04,geometric_container_id:'a'});
  expect(reverse.relationship_type).toBe('within');expect(reverse.relationship_id).toBe(forward.relationship_id);
 });
 it('separates near containment, partial overlap, near coincidence and numerical slivers',()=>{
  const a=rect('a',0,0,10,10);
  expect(compareMetricRows(a,rect('b',-.001,1,2,2)).relationship_type).toBe('near_contains');
  expect(compareMetricRows(a,rect('b',5,5,10,10))).toMatchObject({relationship_type:'partial_overlap',intersection_area_m2:25,overlap_pct_a:25});
  expect(compareMetricRows(a,rect('b',.001,0,10,10)).relationship_type).toBe('near_coincident');
  expect(compareMetricRows(a,rect('b',9.99999999,0,10,10))).toMatchObject({relationship_type:'partial_overlap',significance:'numerical_sliver',geometric_container_id:null});
 });
 it('distinguishes shared edge, point touch, disjoint, holes and multipart geometry',()=>{
  const a=rect('a',0,0,10,10);expect(compareMetricRows(a,rect('edge',10,0,2,2)).relationship_type).toBe('boundary_touch');
  expect(compareMetricRows(a,rect('point',10,10,2,2)).relationship_type).toBe('boundary_touch');
  expect(compareMetricRows(a,rect('away',20,20,2,2)).relationship_type).toBe('disjoint');
  const hole=metric('hole',[[ring(0,0,10,10),ring(2,2,4,4)]]);
  expect(compareMetricRows(hole,rect('inside-hole',3,3,1,1)).relationship_type).toBe('disjoint');
  const multi=metric('multi',[[ring(0,0,1,1)],[ring(8,8,4,4)]]);expect(compareMetricRows(a,multi).intersection_area_m2).toBe(5);
 });
 it('rejects cross-floor and self pairs and invalid tolerances',()=>{
  expect(()=>compareMetricRows(rect('a',0,0,1,1),rect('b',0,0,1,1,2))).toThrow(/different floors/);
  expect(()=>compareMetricRows(rect('a',0,0,1,1),rect('a',0,0,1,1))).toThrow(/itself/);
  expect(()=>compareMetricRows(rect('a',0,0,1,1),rect('b',0,0,1,1),{near_containment_ratio:1.1})).toThrow();
 });
 it('caches by version and tolerances, bounds memory, rejects stale version reuse and keeps sources intact',()=>{
  const data=dataset([feature('a',0,0,10,10),feature('b',1,1,2,2),feature('c',100,100,1,1)]),snapshot=JSON.stringify(data),s=createSpatialRelationshipService({maxVersions:1});
  const r=s.analyze(data,'v1');expect(s.analyze(data,'v1')).toBe(r);expect(s.getStats()).toEqual({preparations:1,analyses:1,cached_versions:1});
  expect(r.stats.bbox_candidate_pairs).toBe(1);expect(r.stats.bbox_disjoint_pairs).toBe(2);
  expect(s.compare(data,'v1','a','c').relationship_type).toBe('disjoint');
  const changed=structuredClone(data);changed[1].features[0].properties.name='new';expect(()=>s.analyze(changed,'v1')).toThrow(/reused/);
  s.analyze(changed,'v2');expect(s.getStats().cached_versions).toBe(1);expect(JSON.stringify(data)).toBe(snapshot);
  const reversed=dataset([...data[1].features].reverse()),r2=createSpatialRelationshipService().analyze(reversed,'order2');expect(r2.relationships.map(r=>r.relationship_id)).toEqual(r.relationships.map(r=>r.relationship_id));
 });
 it('requires catalog keys, reports invalid polygons and never silently repairs them',()=>{
  const good=feature('a',0,0,2,2),bad=feature('b',1,1,2,2);bad.geometry.coordinates[0].pop();
  const index=prepareSpatialDataset(dataset([good,bad]));expect(index.issues).toHaveLength(1);
  expect(()=>prepareSpatialDataset(dataset([good,good]))).toThrow(/keys/);
 });
 it('worker handles repeated requests, clear, comparison and errors without stale fallback',()=>{
  const handle=createSpatialWorkerHandler(),data=dataset([feature('a',0,0,10,10),feature('b',1,1,2,2)]);
  const r=handle({id:1,datasets:data,dataset_version:'one'});expect(r.status).toBe('ready');expect(handle({id:2,datasets:data,dataset_version:'one'}).result).toBe(r.result);
  expect(handle({id:3,action:'compare',datasets:data,dataset_version:'one',feature_a_id:'a',feature_b_id:'b'}).status).toBe('ready');
  expect(handle({id:4,action:'bad'}).status).toBe('error');expect(handle({id:5,action:'clear'}).status).toBe('cleared');
 });
});

describe('real Morris Library cases',()=>{
 const context=loadSpaceAnalyticsContext(),index=prepareSpatialDataset(context.datasets),metadata=createMetadataSeed(context);
 const diagnostics=analyzeSpatialDataset(index,{dataset_version:context.dataset_version});
 const review=buildRelationshipReview(diagnostics,metadata),groups=investigateSameNameGroups(index,metadata);
 it('retains the authoritative inventory and reconciles positive intersections with the reviewed F6 update',()=>{
  expect(index.rows.size).toBe(1610);expect(index.issues).toEqual([]);expect(diagnostics.errors).toEqual([]);
  const baseline=JSON.parse(fs.readFileSync('docs/space-analytics-stage-2a/spatial-diagnostics.json','utf8'));
  const updated=JSON.parse(fs.readFileSync('docs/f6-geometry-sync/spatial-diagnostics.json','utf8'));
  const expected=[...baseline.relationships.filter(r=>r.floor_id!==6),...updated.relationships].filter(r=>r.intersection_area_m2>1e-6);
  expect(diagnostics.relationships.filter(r=>r.intersection_area_m2>1e-6).map(r=>r.relationship_id).sort()).toEqual(expected.map(r=>r.relationship_id).sort());
  expect(diagnostics.stats.bbox_candidate_pairs).toBeLessThan(diagnostics.stats.possible_pairs/20);
 });
 it('proposes Help Desk nesting without creating an approved functional parent',()=>{
  const p=review.review.find(r=>[r.feature_a_name,r.feature_b_name].includes('Help Desk')&&[r.feature_a_name,r.feature_b_name].includes('Geospatial Resources'));
  expect(p).toBeTruthy();expect(p.intersection_area_m2).toBeCloseTo(37.67146,4);expect(p.containment_ratio).toBeGreaterThan(.99999);expect(p.proposed_parent_id).toContain('OBJECTID:4');
  expect(metadata.features.every(f=>f.parent_space_id===null)).toBe(true);expect(metadata.approved_relationships).toEqual([]);
 });
 it('keeps all seven desk, four auditorium and three study pieces and investigates conference overlap',()=>{
  for(const [name,n] of [['Danielle C. Baker Research & Information Desk (0161)',7],['John C Guyon Auditorium',4],['Group Study 0420D',3],['Library Conference 0480A',2]]){
   const g=groups.find(g=>g.original_name===name);expect(g.feature_ids).toHaveLength(n);expect(g.logical_space_id).toBeNull();expect(g.pair_distances).toHaveLength(n*(n-1)/2);
  }
  const study=groups.find(g=>g.original_name==='Group Study 0420D');expect(study.largest_area_fraction).toBeGreaterThan(.95);
  const conference=review.review.find(r=>r.feature_a_name==='Library Conference 0480A'&&r.feature_b_name==='Library Conference 0480A');expect(conference.intersection_area_m2).toBeCloseTo(136.6945,3);expect(conference.proposed_parent_id).toBeNull();
 });
 it('never proposes Floor as a functional parent and retains suppressed diagnostics',()=>{
  const floorIds=new Set(metadata.features.filter(f=>f.proposed_geometry_role==='floor_background').map(f=>f.feature_id));
  expect(review.review.every(r=>!floorIds.has(r.proposed_parent_id))).toBe(true);
  for(const floor of [0,2,5])expect(review.background_diagnostics.some(r=>r.floor_id===floor&&(floorIds.has(r.feature_a_id)||floorIds.has(r.feature_b_id)))).toBe(true);
 });
 it('distinguishes generic Floor from Rotunda, services from research, and preserves unknown names',()=>{
  const proposal=name=>proposeClassification({properties:{name}});
  expect(proposal('Structure').proposed_geometry_role).toBe('structural_component');expect(proposal('Floor').proposed_space_category).toBe('floor_background');
  expect(proposal('3Rd Floor Rotunda').proposed_space_category).toBe('unclassified');
  expect(proposal('Special Collections Research Center Reading Room').proposed_space_category).toBe('research_cultural_resources');
  expect(proposal('Danielle C. Baker Research & Information Desk (0161)').proposed_space_category).toBe('library_services');
  expect(proposal('Unknown space').proposed_space_category).toBe('unclassified');expect(proposal('Writing Center').proposed_subcategory).toBeUndefined();
  expect(proposal('Writing Center').proposed_space_subcategory).toBe('student_support');
 });
});
