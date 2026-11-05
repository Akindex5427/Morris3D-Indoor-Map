import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp';
import {createCorrespondenceIndex, intersectRows} from '../utils/roomCorrespondence';
import {normalizeSearchText} from '../utils/roomCatalog';

export const RELATIONSHIP_ALGORITHM_VERSION='same-floor-v1';
export const DEFAULT_RELATIONSHIP_TOLERANCES=Object.freeze({
 area_epsilon_m2:1e-6,relative_area_epsilon:1e-8,near_containment_ratio:0.995,
 near_outside_area_m2:0.05,near_coincident_iou:0.995,near_symmetric_difference_m2:0.1,
 review_min_area_m2:0.05,component_gap_m:0.5,
});
const reader=new GeoJSONReader();
const order=(a,b)=>a<b?-1:a>b?1:0;
export function relationshipId(floor,a,b){return `spatial-pair-v1:${JSON.stringify([floor,...[a,b].sort(order)])}`;}
const boundsMeet=(a,b)=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
const ratio=v=>Math.max(0,Math.min(1,v));

function validatedTolerances(options){
 const t={...DEFAULT_RELATIONSHIP_TOLERANCES,...options};
 for(const [k,v] of Object.entries(t))if(!Number.isFinite(v)||v<0||!(k in DEFAULT_RELATIONSHIP_TOLERANCES))throw new Error(`Invalid tolerance ${k}`);
 for(const k of ['near_containment_ratio','near_coincident_iou'])if(t[k]<=0.5||t[k]>1)throw new Error(`Invalid ratio ${k}`);
 return t;
}

export function compareMetricRows(a,b,tolerances=DEFAULT_RELATIONSHIP_TOLERANCES) {
 if(a.key===b.key)throw new Error('Cannot compare a feature with itself');
 if(a.floor!==b.floor)throw new Error('Same-floor relationships cannot compare different floors');
 const t=validatedTolerances(tolerances),epsilon=Math.max(t.area_epsilon_m2,Math.min(a.area,b.area)*t.relative_area_epsilon);
 const hit=boundsMeet(a.bounds,b.bounds)?intersectRows(a,b):null;
 const area=hit?.intersectionArea||0;
 const ma=a.metric||reader.read({type:'MultiPolygon',coordinates:a.coordinates}),mb=b.metric||reader.read({type:'MultiPolygon',coordinates:b.coordinates});
 const im=boundsMeet(a.bounds,b.bounds)?RelateOp.relate(ma,mb):null;
 const iou=ratio(area/(a.area+b.area-area)),small=a.area<b.area?a:b,large=small===a?b:a;
 let type='disjoint',container=null,contained=null;
 if(area>epsilon){
  if(iou>=t.near_coincident_iou && a.area+b.area-2*area<=t.near_symmetric_difference_m2)type='near_coincident';
  else if(im?.isCovers()){type='contains';container=a.key;contained=b.key;}
  else if(im?.isCoveredBy()){type='within';container=b.key;contained=a.key;}
  else if(ratio(area/small.area)>=t.near_containment_ratio&&small.area-area<=t.near_outside_area_m2){type='near_contains';container=large.key;contained=small.key;}
  else type='partial_overlap';
 }else if(im?.isTouches(2,2))type='boundary_touch';
 else if(area>0||im&&!im.isDisjoint())type='partial_overlap'; // retain suppressed numerical contacts diagnostically
 return {relationship_id:relationshipId(a.floor,a.key,b.key),floor_id:a.floor,feature_a_id:a.key,feature_b_id:b.key,feature_a_name:a.name,feature_b_name:b.name,relationship_type:type,
  area_a_m2:a.area,area_b_m2:b.area,intersection_area_m2:area,overlap_pct_a:100*ratio(area/a.area),overlap_pct_b:100*ratio(area/b.area),containment_ratio:ratio(area/Math.min(a.area,b.area)),intersection_over_union:iou,
  outside_smaller_area_m2:Math.max(0,Math.min(a.area,b.area)-area),symmetric_difference_area_m2:Math.max(0,a.area+b.area-2*area),
  geometric_container_id:container,geometric_contained_id:contained,topological_covers_a_b:im?.isCovers()||false,topological_covers_b_a:im?.isCoveredBy()||false,
  significance:area>epsilon?(area>=t.review_min_area_m2?'material':'small_overlap'):type==='boundary_touch'?'boundary_only':type==='disjoint'?'none':'numerical_sliver',numerical_tolerance_m2:epsilon};
}

export function prepareSpatialDataset(datasets){
 const keys=new Set();for(const data of Object.values(datasets))for(const f of data.features||[]){const key=f.properties?.__roomSearchKey;if(!key||keys.has(key))throw new Error('Unique authoritative catalog keys required');keys.add(key);}
 const index=createCorrespondenceIndex(datasets);
 const rows=new Map([...index.rows].map(([k,r])=>[k,{...r,metric:reader.read({type:'MultiPolygon',coordinates:r.coordinates})}]));
 return {...index,rows,floors:new Map([...index.floors].map(([f,list])=>[f,list.map(r=>rows.get(r.key))]))};
}

export function analyzeSpatialDataset(index,{dataset_version,tolerances={}}={}){
 if(!dataset_version)throw new Error('Dataset version is required');
 const t=validatedTolerances(tolerances),relationships=[],errors=[],stats={possible_pairs:0,bbox_candidate_pairs:0,bbox_disjoint_pairs:0};
 const start=performance.now();
 // Min-X sweep includes equal bounds, so boundary-only contacts are not lost.
 for(const list of index.floors.values()){
  stats.possible_pairs+=list.length*(list.length-1)/2;
  for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length&&list[j].bounds[0]<=list[i].bounds[2];j++){
   if(!boundsMeet(list[i].bounds,list[j].bounds))continue;
   stats.bbox_candidate_pairs++;
   const [a,b]=[list[i],list[j]].sort((a,b)=>order(a.key,b.key));
   try{relationships.push(compareMetricRows(a,b,t));}catch(e){errors.push({relationship_id:relationshipId(a.floor,a.key,b.key),floor_id:a.floor,feature_a_id:a.key,feature_b_id:b.key,message:e.message});}
  }
 }
 stats.bbox_disjoint_pairs=stats.possible_pairs-stats.bbox_candidate_pairs;
 relationships.sort((a,b)=>order(a.relationship_id,b.relationship_id));
 return {algorithm_version:RELATIONSHIP_ALGORITHM_VERSION,dataset_version,tolerances:t,projection:{method:'local spherical Lambert azimuthal equal-area',origin:index.origin,units:'m2'},relationships,issues:index.issues,errors,stats,preparation_ms:index.preparationMs,analysis_ms:performance.now()-start};
}

export function createSpatialRelationshipService({maxVersions=2}={}){
 if(!Number.isInteger(maxVersions)||maxVersions<1)throw new Error('Positive cache limit required');
 const cache=new Map();let preparations=0,analyses=0;
 const entry=(datasets,version)=>{
  if(!version)throw new Error('Dataset version is required');
  // Registration is explicit, never performed by map render/camera events.
  const signature=JSON.stringify(datasets),existing=cache.get(version);
  if(existing){if(existing.signature!==signature)throw new Error('Dataset version reused for different source data');return existing;}
  const value={signature,index:prepareSpatialDataset(datasets),results:new Map()};preparations++;
  if(cache.size>=maxVersions)cache.delete(cache.keys().next().value);cache.set(version,value);return value;
 };
 return {analyze(datasets,version,tolerances={}){const e=entry(datasets,version),t=validatedTolerances(tolerances),key=JSON.stringify(t);if(!e.results.has(key)){analyses++;if(e.results.size>=4)e.results.delete(e.results.keys().next().value);e.results.set(key,analyzeSpatialDataset(e.index,{dataset_version:version,tolerances:t}));}return e.results.get(key);},
  compare(datasets,version,a,b,tolerances={}){const e=entry(datasets,version);if(!e.index.rows.has(a)||!e.index.rows.has(b))throw new Error('Unknown or invalid feature');return compareMetricRows(e.index.rows.get(a),e.index.rows.get(b),tolerances);},
  clear(){cache.clear();},getStats(){return {preparations,analyses,cached_versions:cache.size};}};
}

const blocked=new Set(['structure_non_occupiable','floor_background','circulation_vertical_access']);
export function buildRelationshipReview(diagnostics,metadata){
 const byId=new Map(metadata.features.map(f=>[f.feature_id,f]));
 const review=[],suppressed=[];
 for(const r of diagnostics.relationships){
  const a=byId.get(r.feature_a_id),b=byId.get(r.feature_b_id);if(!a||!b)throw new Error('Missing metadata for geometric relationship');
  const same=normalizeSearchText(a.original_name)&&normalizeSearchText(a.original_name)===normalizeSearchText(b.original_name);
  const generic=blocked.has(a.proposed_space_category)||blocked.has(b.proposed_space_category);
  let priority=null,role=null,notes='',parent=null,child=null;
  if(generic){
   const isFloor=[a,b].some(f=>f.proposed_space_category==='floor_background');
   const functional=[a,b].find(f=>!blocked.has(f.proposed_space_category)&&f.proposed_space_category!=='unclassified');
   const functionalCoverage=functional?.feature_id===r.feature_a_id?r.overlap_pct_a:r.overlap_pct_b;
   if(!isFloor&&r.significance==='material'&&(r.relationship_type==='near_coincident'||functional&&functionalCoverage>=99.5&&r.intersection_area_m2>=5)){
    review.push({...r,review_priority:3,proposed_parent_id:null,proposed_child_id:null,proposed_relationship_role:'review_structural_or_access_conflict',confidence:'proposal_only',review_status:'pending',review_notes:'Nearly coincident concepts or substantial coverage of a named space by modeled structure/access. Review geometry meaning; no functional parent proposed.',decision:'',owner_notes:''});
   }else suppressed.push({...r,review_status:'diagnostic_only',review_notes:'Background, structural or access containment is not functional parentage'});
   continue;
  }
  if(r.significance==='material'&&same){
   priority=1;role='review_same_space_overlap';notes='Same-name polygons overlap or nest. Review component membership and geometry role; do not merge or assign hierarchy automatically.';
  }else if(r.significance==='material'&&r.geometric_container_id&&a.original_name&&b.original_name&&!same){
   priority=1;role='possible_functional_parent';parent=r.geometric_container_id;child=r.geometric_contained_id;notes='Geometry suggests nesting; owner must distinguish room, zone, compartment and fixture. No approved hierarchy assigned.';
  }else if(r.significance==='material'&&r.relationship_type==='near_coincident'){
   priority=1;role='review_near_coincident';notes='Nearly identical footprints may model different concepts; do not merge automatically.';
  }else if(r.significance==='material'&&r.relationship_type==='partial_overlap'){
   priority=same?1:2;role=same?'review_same_space_overlap':'review_cross_category_overlap';notes='Retain both polygons. Resolve modeling role or allocation before area totals.';
  }
  if(priority)review.push({...r,review_priority:priority,proposed_parent_id:parent,proposed_child_id:child,proposed_relationship_role:role,confidence:'proposal_only',review_status:'pending',review_notes:notes,decision:'',owner_notes:''});
 }
 return {review:review.sort((a,b)=>a.review_priority-b.review_priority||a.floor_id-b.floor_id||order(a.relationship_id,b.relationship_id)),background_diagnostics:suppressed};
}

const genericNames=new Set(['structure','structures','floor','staff','staff only','private room','stairs','stair case','stairs case','stairs area','stairs area upper','rest room male','rest room female','elevator','emergency exit','emergency exit only']);
export function investigateSameNameGroups(index,metadata,{gap_m=DEFAULT_RELATIONSHIP_TOLERANCES.component_gap_m}={}){
 const byId=new Map(metadata.features.map(f=>[f.feature_id,f])),groups=new Map();
 for(const row of index.rows.values()){
  const n=normalizeSearchText(row.name),meta=byId.get(row.key);if(!n||genericNames.has(n)||blocked.has(meta?.proposed_space_category))continue;
  const key=JSON.stringify([row.floor,n]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
 }
 const result=[];
 for(const rows of groups.values()){
  if(rows.length<2)continue;rows.sort((a,b)=>order(a.key,b.key));
  const distances=[];const adjacency=new Map(rows.map(r=>[r.key,new Set()]));
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
   const distance=DistanceOp.distance(rows[i].metric,rows[j].metric);distances.push({feature_a_id:rows[i].key,feature_b_id:rows[j].key,gap_m:distance});
   if(distance<=gap_m){adjacency.get(rows[i].key).add(rows[j].key);adjacency.get(rows[j].key).add(rows[i].key);}
  }
  const pending=new Set(rows.map(r=>r.key)),clusters=[];
  while(pending.size){const queue=[pending.values().next().value],cluster=[];pending.delete(queue[0]);while(queue.length){const k=queue.pop();cluster.push(k);for(const next of adjacency.get(k))if(pending.delete(next))queue.push(next);}clusters.push(cluster.sort(order));}
  const heights=new Set(rows.map(r=>JSON.stringify([r.feature.properties.base_height??r.feature.properties.base_heigh,r.feature.properties.height])));
  const sorted=[...rows].sort((a,b)=>b.area-a.area),sum=rows.reduce((s,r)=>s+r.area,0);
  result.push({proposal_id:`same-name-v1:${JSON.stringify([rows[0].floor,...rows.map(r=>r.key)])}`,floor_id:rows[0].floor,original_name:rows[0].name,feature_ids:rows.map(r=>r.key),feature_areas_m2:rows.map(r=>({feature_id:r.key,area_m2:r.area})),feature_area_sum_m2:sum,largest_feature_id:sorted[0].key,largest_area_fraction:sorted[0].area/sum,compatible_modeled_heights:heights.size===1,proximity_clusters:clusters,pair_distances:distances,
   proposed_membership_groups:heights.size===1?clusters.filter(c=>c.length>1):[],logical_space_id:null,review_status:'pending',review_priority:1,confidence:clusters.length===1&&heights.size===1?'medium':'low',
   review_notes:'Same name is only supporting evidence. Proposed groups additionally require geometric contact/proximity and compatible modeled heights. No physical-room count or logical-space ID has been assigned.',decision:'',owner_notes:''});
 }
 return result;
}
