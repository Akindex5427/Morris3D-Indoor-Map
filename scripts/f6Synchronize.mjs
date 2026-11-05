import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadSpaceAnalyticsContext,sha256} from './spaceAnalyticsContext.mjs';
import {compareFloorExports,assessCombinedExport,migrateFloorMetadata} from '../src/spaceAnalytics/floorSynchronization';
import {prepareSpatialDataset,analyzeSpatialDataset,buildRelationshipReview,investigateSameNameGroups} from '../src/spaceAnalytics/relationships';
import {validateMetadata} from '../src/spaceAnalytics/metadata';
import {METADATA_JSON_SCHEMA} from '../src/spaceAnalytics/schema';
import {normalizeSearchText} from '../src/utils/roomCatalog';
const out='docs/f6-geometry-sync',data='data/space-analytics';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const csv=(p,rows)=>{
 const keys=[...new Set(rows.flatMap(Object.keys))],cell=v=>{let s=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 fs.writeFileSync(p,'\uFEFF'+[keys.map(cell).join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n');
};
const previous=read(`${data}/metadata.proposals.v1.json`),before=read(`${out}/f6-before.geojson`),current=read('public/rooms-level-6-WGS.geojson');
const baseline=read('docs/space-analytics-stage-2a/start-hashes.json');
assert.equal(sha256(fs.readFileSync(`${out}/f6-before.geojson`)),baseline['public/rooms-level-6-WGS.geojson']);
const combinedText=fs.readFileSync(`${out}/combined-before.geojson`,'utf8');
assert.equal(sha256(combinedText),baseline['public/rooms-all-WGS-v6.geojson']);
const delta=compareFloorExports(before,current,6),sourceHash=sha256(fs.readFileSync('public/rooms-level-6-WGS.geojson'));
assert.deepEqual(delta.removed.map(r=>r.feature.properties.OBJECTID),[137,138,139,140]);
assert.deepEqual(delta.added.map(r=>r.feature.properties.OBJECTID),[147,148,149,150]);
assert.deepEqual(delta.modified.map(r=>({id:r.before.properties.OBJECTID,fields:r.changed_properties,geometry:r.geometry_changed})),[{id:146,fields:['height'],geometry:false}]);
// The owner replaced F-ALL during this task. Assess that export as supplied;
// never overwrite it or force approximate footprint matches into identity links.
const ownerCombinedBytes=fs.readFileSync('public/rooms-all-WGS-v6.geojson');
const ownerCombined=JSON.parse(ownerCombinedBytes.toString('utf8').replace(/^\uFEFF/,''));
const assessment=assessCombinedExport(JSON.parse(combinedText),ownerCombined,current,6);
assert.deepEqual(assessment.unrelated_floor_changes,[]);assert.deepEqual(assessment.geometry_issues,[]);
assert.deepEqual(assessment.duplicate_footprints,[]);
write(`${out}/combined-assessment.json`,assessment);
const context=loadSpaceAnalyticsContext(),metadata=migrateFloorMetadata(previous,context,6,delta.added.map(r=>r.feature_id));
const allIndex=prepareSpatialDataset(context.datasets);
assert.deepEqual(allIndex.issues,[]);assert.equal(allIndex.rows.size,1610);
const floorRows=allIndex.floors.get(6),index={...allIndex,rows:new Map(floorRows.map(r=>[r.key,r])),floors:new Map([[6,floorRows]])};
const diagnostics=analyzeSpatialDataset(index,{dataset_version:context.dataset_version});assert.deepEqual(diagnostics.errors,[]);
const {review,background_diagnostics}=buildRelationshipReview(diagnostics,metadata),groups=investigateSameNameGroups(index,metadata);
metadata.proposed_relationships=[...previous.proposed_relationships.filter(r=>r.floor_id!==6),...review];
metadata.membership_proposals=[...previous.membership_proposals.filter(r=>r.floor_id!==6),...groups];
// Preserve the owner's supplied facts without fabricating dated approval events,
// new facilities IDs, per-component room counts, or overriding existing decisions.
metadata.owner_confirmations=[...(previous.owner_confirmations||[]),
 {confirmation_id:'owner-f4-help-desk-counter',floor_id:4,feature_ids:['/rooms-level-04-WGS.geojson#F4:OBJECTID:7'],statement:'Physical service counter inside Geospatial Resources.',source:'Owner instruction: Targeted F6 Geometry Synchronization After Re-Digitization',status:'owner_confirmed',verification_timestamp:null},
 {confirmation_id:'owner-f4-study-0420d-one-room',floor_id:4,feature_ids:[69,70,71].map(id=>`/rooms-level-04-WGS.geojson#F4:OBJECTID:${id}`),statement:'Group Study 0420D is one enclosed study room despite multiple modeled features.',enclosed_room_count:1,source:'Owner instruction: Targeted F6 Geometry Synchronization After Re-Digitization',status:'owner_confirmed',verification_timestamp:null}];
metadata.supersedes={dataset_version:previous.dataset_version,floor_id:6,ledger:`${out}/superseded-records.json`};
const validation=validateMetadata(metadata,context);assert(validation.valid,JSON.stringify(validation.errors));
for(const f of previous.features.filter(f=>f.floor_id!==6)){
 const next=metadata.features.find(n=>n.feature_id===f.feature_id);assert.deepEqual({...next,dataset_version:f.dataset_version},f,'Unrelated metadata fields changed');
}
assert.deepEqual(metadata.approvals,previous.approvals);assert.deepEqual(metadata.logical_spaces,previous.logical_spaces);assert.deepEqual(metadata.approved_relationships,previous.approved_relationships);
assert.equal(sha256(fs.readFileSync('public/rooms-all-WGS-v6.geojson')),sha256(ownerCombinedBytes),'Owner export changed during analysis');
write(`${data}/metadata.f6-sync.v1.json`,metadata);
write(`${data}/metadata.f6-sync.schema.json`,METADATA_JSON_SCHEMA);
write(`${data}/current.json`,{schema_version:'morris-space-metadata-pointer/v1',metadata:'metadata.f6-sync.v1.json',schema:'metadata.f6-sync.schema.json',dataset_version:context.dataset_version,production_activation:false});
const inventory=floorRows.map(r=>{const f=metadata.features.find(f=>f.feature_id===r.key);return {...f,area_m2:r.area,geometry_type:r.feature.geometry.type,source_height:r.feature.properties.height,source_base_height:r.feature.properties.base_height??r.feature.properties.base_heigh,review_status:'pending'};});
csv(`${out}/feature-inventory.csv`,inventory);csv(`${out}/classification-review.csv`,inventory.map(({area_m2,...f})=>f));
csv(`${out}/affected-classification-review.csv`,inventory.filter(f=>[...delta.added,...delta.modified].some(r=>r.feature_id===f.feature_id)));
csv(`${out}/spatial-relationship-review.csv`,review);csv(`${out}/membership-review.csv`,groups);csv(`${out}/background-diagnostics.csv`,background_diagnostics);
write(`${out}/spatial-diagnostics.json`,diagnostics);write(`${out}/membership-proposals.json`,groups);write(`${out}/changes.json`,delta);write(`${out}/validation.json`,validation);
const oldDiagnostics=read('docs/space-analytics-stage-2a/spatial-diagnostics.json');
const classificationGroups=new Map();for(const f of previous.features.filter(f=>f.floor_id===6)){
 const k=JSON.stringify([f.floor_id,normalizeSearchText(f.original_name)||f.feature_id,f.proposed_space_category,f.proposed_space_subcategory,f.proposed_geometry_role]);
 if(!classificationGroups.has(k))classificationGroups.set(k,[]);classificationGroups.get(k).push(f.feature_id);
}
const records=[
 ...[...classificationGroups.values()].map(ids=>({record_type:'grouped_classification_review',record_id:`classification-proposal-v1:${JSON.stringify([6,ids.sort()])}`,record_status:'superseded',replacement:`${out}/classification-review.csv`})),
 ...previous.display_links.filter(l=>delta.removed.some(r=>r.feature_id===l.authoritative_feature_id)).map(l=>({record_type:'removed_F_ALL_identity_link',record_id:l.display_id,record_status:'superseded',replacement:null,reason:'Owner F-ALL export removed this feature; new footprints are not exact matches'})),
 {record_type:'interim_metadata_snapshot',record_id:'rooms-sha256:0e3c7b8a710b00b42bc1d92b9981aa4588611598dca407435d33a377fff6e188',record_status:'superseded',replacement:`${data}/metadata.f6-sync.v1.json`,reason:'Owner replaced F-ALL during assessment; prior unapproved snapshot retained in superseded-interim/'},
 ...previous.features.filter(f=>f.floor_id===6).map(f=>({record_type:'feature_metadata_and_classification_review',record_id:f.feature_id,record_status:'superseded',reason:delta.removed.some(r=>r.feature_id===f.feature_id)?'feature_removed':delta.modified.some(r=>r.feature_id===f.feature_id)?'source_attributes_modified':'source_version_changed',replacement:metadata.features.some(n=>n.feature_id===f.feature_id)?`${out}/feature-inventory.csv`:null})),
 ...oldDiagnostics.relationships.filter(r=>r.floor_id===6).map(r=>({record_type:'geometric_relationship',record_id:r.relationship_id,record_status:'superseded',replacement:`${out}/spatial-diagnostics.json`})),
 ...previous.membership_proposals.filter(g=>g.floor_id===6).map(g=>({record_type:'membership_proposal',record_id:g.proposal_id,record_status:'superseded',replacement:`${out}/membership-proposals.json`}))];
write(`${out}/superseded-records.json`,{previous_dataset_version:previous.dataset_version,current_dataset_version:context.dataset_version,original_records_preserved_in:'docs/space-analytics-stage-2a and data/space-analytics/metadata.proposals.v1.json',records});csv(`${out}/superseded-records.csv`,records);
const currentLinks=context.display_links.filter(l=>delta.added.some(r=>r.feature_id===l.authoritative_feature_id));
const affected=new Set([...delta.removed,...delta.added,...delta.modified].map(r=>r.feature_id));
const summary={active_f6_source:'/rooms-level-6-WGS.geojson',new_export_active_in_repository:true,old_source_sha256:baseline['public/rooms-level-6-WGS.geojson'],new_source_sha256:sourceHash,old_dataset_version:previous.dataset_version,new_dataset_version:context.dataset_version,
 counts:{before:before.features.length,after:current.features.length,removed:delta.removed.length,added:delta.added.length,modified:delta.modified.length,unchanged:delta.unchanged.length},changed_ids:[...affected],
 f_all:{source:'owner replacement export',source_sha256:sha256(ownerCombinedBytes),modified_by_tool:false,removed_display_ids:assessment.removed_ids,added_display_ids:assessment.added_ids,before_count:1608,after_count:ownerCombined.features.length,preserved_feature_objects:assessment.preserved_objects,unrelated_floor_changes:assessment.unrelated_floor_changes,links:currentLinks,unresolved_modified_features:delta.modified.filter(r=>!context.display_links.some(l=>l.authoritative_feature_id===r.feature_id)).map(r=>r.feature_id),unresolved_F6_links:context.display_links.filter(l=>l.floor_id===6&&l.match_status!=='matched').length,approximate_comparisons:assessment.comparisons.map(c=>({display_id:c.display_id,highest_iou_feature:c.overlap_candidates[0]?.feature_b_id,intersection_over_union:c.overlap_candidates[0]?.intersection_over_union,identity_status:'unresolved'}))},
 analysis:{valid_authoritative_features:allIndex.rows.size,valid_F6_features:floorRows.length,issues:allIndex.issues,errors:diagnostics.errors,stats:diagnostics.stats,positive_area_pairs:diagnostics.relationships.filter(r=>r.intersection_area_m2>1e-6).length,review_pairs:review.length,membership_groups:groups.length,partition_area_m2:inventory.filter(r=>delta.added.some(n=>n.feature_id===r.feature_id)).reduce((s,r)=>s+r.area_m2,0)},
 preserved_approval_records:previous.approvals.length,preserved_other_floor_metadata:previous.features.filter(f=>f.floor_id!==6).length,superseded_records:records.length,metadata_valid:validation.valid,unresolved_display_warnings:validation.warnings.length};
write(`${out}/summary.json`,summary);console.log(JSON.stringify(summary,null,2));
