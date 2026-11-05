import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {loadSpaceAnalyticsContext,sha256} from './spaceAnalyticsContext.mjs';
import {createMetadataSeed} from '../src/spaceAnalytics/proposals';
import {METADATA_JSON_SCHEMA} from '../src/spaceAnalytics/schema';
import {validateMetadata,applyApprovalBatch,restoreMetadataSnapshot} from '../src/spaceAnalytics/metadata';
import {prepareSpatialDataset,analyzeSpatialDataset,buildRelationshipReview,investigateSameNameGroups} from '../src/spaceAnalytics/relationships';
import {normalizeSearchText} from '../src/utils/roomCatalog';

const out='docs/space-analytics-stage-2a',dataDir='data/space-analytics';
const json=(file,value,exclusive=false)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',exclusive?{flag:'wx'}:undefined);
const csv=(file,rows)=>{
 const fields=[...new Set(rows.flatMap(Object.keys))];
 const cell=value=>{let s=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;};
 fs.writeFileSync(file,'\uFEFF'+[fields.map(cell).join(','),...rows.map(r=>fields.map(k=>cell(r[k])).join(','))].join('\n')+'\n');
};
const context=loadSpaceAnalyticsContext();
const args=process.argv.slice(2);
if(args[0]==='import'||args[0]==='restore'){
 const [action,currentFile,decisionsFile,outputFile,reviewFile]=args;
 if(!currentFile||!decisionsFile||!outputFile||action==='restore'&&!reviewFile)throw new Error('Usage: import current.json approvals.json NEW-output.json; restore current.json snapshot.json NEW-output.json restore-review.json');
 const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 const next=action==='import'?applyApprovalBatch(read(currentFile),read(decisionsFile),context):restoreMetadataSnapshot(read(currentFile),read(decisionsFile),context,read(reviewFile));
 // Outputs are explicitly new files; prior revisions and GeoJSON are never overwritten.
 if(!/\.json$/i.test(outputFile)||path.resolve(outputFile).startsWith(path.resolve('public')+path.sep))throw new Error('Use a new JSON metadata path outside public/');
 json(outputFile,next,true);console.log(`Wrote validated isolated revision ${next.revision}: ${outputFile}`);
}else{
 if(args.length&&args[0]!=='generate')throw new Error('Unknown command');
 fs.mkdirSync(out,{recursive:true});fs.mkdirSync(dataDir,{recursive:true});
 const baseline=JSON.parse(fs.readFileSync(`${out}/start-hashes.json`));
 const verifySources=()=>{const changed=Object.entries(baseline).filter(([file,hash])=>sha256(fs.readFileSync(file))!==hash).map(([file])=>file);assert.deepEqual(changed,[],'Existing production/data files changed');return {protected_files:Object.keys(baseline).length,changed};};
 verifySources();
 const metadata=createMetadataSeed(context),index=prepareSpatialDataset(context.datasets);
 console.log('Prepared',index.rows.size,'valid authoritative footprints');
 const diagnostics=analyzeSpatialDataset(index,{dataset_version:context.dataset_version});
 const {review,background_diagnostics}=buildRelationshipReview(diagnostics,metadata);
 const groups=investigateSameNameGroups(index,metadata);
 metadata.proposed_relationships=review;metadata.membership_proposals=groups;
 const validation=validateMetadata(metadata,context);assert(validation.valid,JSON.stringify(validation.errors));
 assert.equal(metadata.features.length,1610);assert.equal(new Set(metadata.features.map(f=>f.feature_id)).size,1610);
 const seedPath=`${dataDir}/metadata.proposals.v1.json`;
 if(fs.existsSync(seedPath)){const old=JSON.parse(fs.readFileSync(seedPath));if(old.revision!==0||old.approvals?.length)throw new Error('Refusing to replace approved metadata');}
 json(seedPath,metadata);json(`${dataDir}/metadata.schema.json`,METADATA_JSON_SCHEMA);
 json(`${out}/spatial-diagnostics.json`,diagnostics);json(`${out}/membership-proposals.json`,groups);
 csv(`${out}/spatial-relationship-review.csv`,review);csv(`${out}/background-diagnostics.csv`,background_diagnostics);
 csv(`${out}/membership-review.csv`,groups.map(g=>({...g,pair_distances:undefined,feature_areas_m2:g.feature_areas_m2})));
 const classes=new Map();for(const f of metadata.features){
  // Aggregation is only a review convenience, never approved space membership.
  const key=JSON.stringify([f.floor_id,normalizeSearchText(f.original_name)||f.feature_id,f.proposed_space_category,f.proposed_space_subcategory,f.proposed_geometry_role]);
  if(!classes.has(key))classes.set(key,[]);classes.get(key).push(f);
 }
 const classificationReview=[...classes.values()].map(list=>{
  const f=list[0],ids=list.map(f=>f.feature_id).sort(),generic=['floor_background','structure_non_occupiable','circulation_vertical_access'].includes(f.proposed_space_category);
  return {review_id:`classification-proposal-v1:${JSON.stringify([f.floor_id,ids])}`,dataset_version:context.dataset_version,floor_id:f.floor_id,original_names:[...new Set(list.map(f=>f.original_name))],feature_ids:ids,feature_count:ids.length,
   proposed_category:f.proposed_space_category,proposed_subcategory:f.proposed_space_subcategory,proposed_geometry_role:f.proposed_geometry_role,geometry_role_alternatives:f.geometry_role_alternatives,secondary_tags:f.proposed_secondary_tags,
   confidence:f.proposal_confidence,review_priority:generic?4:f.proposal_needs_review?1:2,review_status:'pending',evidence:f.classification_evidence,
   decision:'',approved_category:'',approved_subcategory:'',approved_geometry_role:'',assignable:'',include_in_room_count:'',include_in_area_total:'',reviewed_by:'',reviewed_at:'',owner_notes:''};
 }).sort((a,b)=>a.review_priority-b.review_priority||a.floor_id-b.floor_id||a.review_id.localeCompare(b.review_id));
 csv(`${out}/classification-review.csv`,classificationReview);
 csv(`${out}/priority-classification-review.csv`,classificationReview.filter(r=>r.review_priority<4));
 const tally=values=>Object.fromEntries([...values.reduce((m,v)=>m.set(v,(m.get(v)||0)+1),new Map())]);
 const named=[['help-desk-geospatial',4,['Help Desk','Geospatial Resources']],['baker-desk',1,['Danielle C. Baker Research & Information Desk (0161)']],['auditorium',1,['John C Guyon Auditorium']],['group-study-0420d',4,['Group Study 0420D']],['conference-0480a',4,['Library Conference 0480A']]];
 const examples=named.map(([example,floor,names])=>{
  const rows=[...index.rows.values()].filter(r=>r.floor===floor&&names.some(n=>normalizeSearchText(n)===normalizeSearchText(r.name))),ids=new Set(rows.map(r=>r.key));
  return {example,floor,features:rows.map(r=>({feature_id:r.key,name:r.name,area_m2:r.area,base_height:r.feature.properties.base_height??r.feature.properties.base_heigh,height:r.feature.properties.height})),relationships:diagnostics.relationships.filter(r=>ids.has(r.feature_a_id)&&ids.has(r.feature_b_id)),groups:groups.filter(g=>g.floor_id===floor&&g.feature_ids.every(id=>ids.has(id)))};
 });
 for(const floor of [0,2,5]){
  const ids=new Set([...index.rows.values()].filter(r=>r.floor===floor&&normalizeSearchText(r.name)==='floor').map(r=>r.key));
  examples.push({example:'floor-background',floor,background_feature_ids:[...ids],relationship_counts:tally(diagnostics.relationships.filter(r=>r.floor_id===floor&&(ids.has(r.feature_a_id)||ids.has(r.feature_b_id))).map(r=>r.relationship_type)),proposed_functional_parents:review.filter(r=>ids.has(r.proposed_parent_id)).length});
 }
 json(`${out}/named-examples.json`,examples);
 const summary={dataset_version:context.dataset_version,authoritative_features:metadata.features.length,approved_classifications:metadata.features.filter(f=>f.verification_status==='verified').length,approved_logical_spaces:metadata.logical_spaces.length,approved_parents:metadata.approved_relationships.length,
  geometry_issues:diagnostics.issues,geometry_errors:diagnostics.errors,relationship_counts:tally(diagnostics.relationships.map(r=>r.relationship_type)),significance_counts:tally(diagnostics.relationships.map(r=>r.significance)),stats:diagnostics.stats,
  preparation_ms:diagnostics.preparation_ms,analysis_ms:diagnostics.analysis_ms,classification_review_rows:classificationReview.length,priority_classification_rows:classificationReview.filter(r=>r.review_priority<4).length,relationship_review_rows:review.length,background_diagnostic_rows:background_diagnostics.length,membership_review_rows:groups.length,
  review_by_floor:Array.from({length:8},(_,floor)=>({floor,classification:classificationReview.filter(r=>r.floor_id===floor).length,priority_classification:classificationReview.filter(r=>r.floor_id===floor&&r.review_priority<4).length,spatial:review.filter(r=>r.floor_id===floor).length,membership:groups.filter(r=>r.floor_id===floor).length})),validation:{valid:validation.valid,error_count:validation.errors.length,warning_count:validation.warnings.length,warning_codes:tally(validation.warnings.map(w=>w.code))},integrity:verifySources()};
 json(`${out}/summary.json`,summary);json(`${out}/validation.json`,validation);
 json(`${out}/approval-template.json`,{schema_version:'morris-space-approvals/v1',dataset_version:context.dataset_version,base_revision:0,decisions:[]});
 const table=summary.review_by_floor.map(r=>`| F${r.floor} | ${r.priority_classification} | ${r.classification} | ${r.spatial} | ${r.membership} |`).join('\n');
 fs.writeFileSync(`${out}/REVIEW-SUMMARY.md`,`# Owner review: Stage 2A\n\nNo classifications, logical spaces or functional parents have been approved. No provisional metadata is active in the app.\n\nStart with **priority-classification-review.csv** (${summary.priority_classification_rows} decisions), **spatial-relationship-review.csv** (${review.length} pairs), and **membership-review.csv** (${groups.length} same-name investigations). Classification grouping is a review shortcut, not a physical-room count. Split rows when feature roles differ.\n\n| Floor | Priority classification | All classification | Spatial pairs | Same-name groups |\n| --- | ---: | ---: | ---: | ---: |\n${table}\n\nThe full diagnostic set retains ${diagnostics.relationships.length} bounding-box candidate pairs, including boundary-only contacts, small overlaps and disjoint candidates. ${diagnostics.stats.bbox_disjoint_pairs} additional pairs are provably disjoint by their bounds and summarized rather than materialized. Background/structural/access cases (${background_diagnostics.length}) remain in a separate diagnostic file; none automatically becomes a functional parent.\n\n## Decisions to resolve\n\n- Help Desk versus Geospatial Resources: fixture, compartment, or separate zone; whether to approve a functional parent after assigning logical-space IDs.\n- Baker desk: whether seven modeled pieces form one counter/service space; do not count seven rooms.\n- Auditorium and Group Study 0420D: which pieces belong to a shared logical space and which represent ancillary modeled detail.\n- Conference 0480A: why two large same-name footprints overlap; preserve both until role/grouping review.\n- Floor/Structure: confirm exclusion policies without treating geometric containment as hierarchy.\n- Remaining ambiguous classifications and 135 unresolved F-ALL links: keep unknown until separately reviewed.\n\nSee README.md and DATA-DICTIONARY.md for tolerances, named-example results and the validated approval/import format.\n`);
 console.log(JSON.stringify(summary,null,2));
}
