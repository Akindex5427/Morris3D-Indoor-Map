import {buildFloorCatalog} from '../utils/roomCatalog';
import {routeFootprintSignature} from '../utils/routeLabelIdentity';
import {correspondenceFloor} from '../utils/roomCorrespondenceIdentity';
import {createMetadataSeed} from './proposals';
import {prepareSpatialDataset,compareMetricRows} from './relationships';

const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function compareFloorExports(before,after,floor){
 const rows=data=>new Map(buildFloorCatalog(data,floor).data.features.map(f=>[f.properties.__roomSearchKey,f]));
 const a=rows(before),b=rows(after),added=[],removed=[],modified=[],unchanged=[];
 for(const [id,f] of a){
  const next=b.get(id);if(!next){removed.push({feature_id:id,feature:f});continue;}
  const geometry_changed=canonical(f.geometry)!==canonical(next.geometry);
  const changed_properties=[...new Set([...Object.keys(f.properties),...Object.keys(next.properties)])].filter(k=>canonical(f.properties[k])!==canonical(next.properties[k]));
  if(geometry_changed||changed_properties.length)modified.push({feature_id:id,geometry_changed,changed_properties,before:f,after:next});else unchanged.push(id);
 }
 for(const [id,f] of b)if(!a.has(id))added.push({feature_id:id,feature:f});
 return {floor,added,removed,modified,unchanged};
}

export function assessCombinedExport(before,current,authoritative,floor){
 const key=f=>`${correspondenceFloor(f)}:${f.properties.OBJECTID??f.id}`;
 const old=new Map(before.features.map(f=>[key(f),f])),next=new Map(current.features.map(f=>[key(f),f]));
 if(old.size!==before.features.length||next.size!==current.features.length)throw new Error('Duplicate combined display identities');
 const removed=[...old].filter(([k])=>!next.has(k)).map(([,f])=>f),added=[...next].filter(([k])=>!old.has(k)).map(([,f])=>f);
 const modified=[...next].filter(([k,f])=>old.has(k)&&canonical(f)!==canonical(old.get(k))).map(([,f])=>f);
 const authoritativeRows=buildFloorCatalog(authoritative,floor).data.features;
 const displayRows=current.features.filter(f=>correspondenceFloor(f)===floor).map(f=>({...f,properties:{...f.properties,__roomSearchKey:`display:${key(f)}`}}));
 const index=prepareSpatialDataset({[floor]:{type:'FeatureCollection',features:[...authoritativeRows,...displayRows]}});
 const comparisons=added.filter(f=>correspondenceFloor(f)===floor).map(f=>{
  const a=index.rows.get(`display:${key(f)}`);if(!a)return {display_id:key(f),invalid_geometry:true};
  const overlaps=authoritativeRows.flatMap(g=>{const b=index.rows.get(g.properties.__roomSearchKey);if(!b)return [];const r=compareMetricRows(a,b);return r.intersection_area_m2>1e-6?[r]:[];}).sort((a,b)=>b.intersection_over_union-a.intersection_over_union);
  return {display_id:key(f),name:f.properties.name,display_area_m2:a.area,exact_export_precision_matches:authoritativeRows.filter(g=>routeFootprintSignature(g.geometry)===routeFootprintSignature(f.geometry)).map(g=>g.properties.__roomSearchKey),overlap_candidates:overlaps.slice(0,3),status:'geometry_comparison_only_not_an_identity_assignment'};
 });
 const signatures=new Map();for(const f of current.features){const signature=`${correspondenceFloor(f)}:${routeFootprintSignature(f.geometry)}`;if(!signatures.has(signature))signatures.set(signature,[]);signatures.get(signature).push(key(f));}
 return {removed_ids:removed.map(key),added_ids:added.map(key),modified_ids:modified.map(key),preserved_objects:current.features.length-added.length-modified.length,unrelated_floor_changes:[...removed,...added,...modified].filter(f=>correspondenceFloor(f)!==floor).map(key),geometry_issues:index.issues,comparisons,duplicate_footprints:[...signatures.values()].filter(ids=>ids.length>1)};
}

export function migrateFloorMetadata(previous,context,floor,partitionIds){
 const seed=createMetadataSeed(context),before=new Map(previous.features.map(f=>[f.feature_id,f]));
 const after=new Map(context.features.map(f=>[f.feature_id,f]));
 for(const old of previous.features){
  if(old.floor_id===floor&&old.verification_status==='verified'&&(!after.has(old.feature_id)||after.get(old.feature_id).footprint_hash!==old.footprint_hash))throw new Error('Verified changed/removed geometry requires explicit approval migration');
 }
 const features=seed.features.map(f=>{
  const old=before.get(f.feature_id);
  if(old){
   if(f.floor_id!==floor&&(f.source_sha256!==old.source_sha256||f.footprint_hash!==old.footprint_hash))throw new Error('Unrelated floor source changed');
   const preserved={...structuredClone(old),dataset_version:context.dataset_version,source_sha256:f.source_sha256,footprint_hash:f.footprint_hash};return preserved;
  }
  if(f.floor_id!==floor)throw new Error('Unrelated floor changed during targeted migration');
  return f;
 });
 for(const id of partitionIds){
  const f=features.find(f=>f.feature_id===id);if(!f||f.floor_id!==floor)throw new Error('Unknown partition feature');
  if(f.verification_status==='verified')throw new Error('Do not overwrite a verified classification');
  Object.assign(f,{proposed_geometry_role:'structural_component',geometry_role_alternatives:[],proposed_space_category:'study_learning',proposed_space_subcategory:'semi_private_study_booths',proposed_secondary_tags:['partition','open_plan','non_room'],proposal_confidence:'high',proposal_needs_review:true,classification_source:'Owner-confirmed F6 re-digitization; provisional metadata',classification_evidence:'Partition walls define an open-plan collaborative study area with semi-private booths, not independent enclosed study rooms.',proposed_assignable:false,proposed_include_in_room_count:false,proposed_include_in_area_total:false,proposed_space_type:'open-plan collaborative study area',proposed_enclosed_room_count:0,study_station_count:null,functional_zone_footprint_id:null,allocated_floor_area_m2:null,area_allocation_status:'requires_separately_verified_functional_zone_footprint'});
 }
 return {...structuredClone(previous),dataset_version:context.dataset_version,previous_dataset_version:previous.dataset_version,revision:previous.revision+1,previous_revision:previous.revision,sources:structuredClone(context.sources),features,display_links:structuredClone(context.display_links),history:[...structuredClone(previous.history),{action:'targeted_floor_source_migration',floor_id:floor,revision:previous.revision+1,from_dataset_version:previous.dataset_version,to_dataset_version:context.dataset_version}]};
}
