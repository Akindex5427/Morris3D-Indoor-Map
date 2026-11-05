// Offline, report-only audit. Never imports approvals or writes source datasets.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {buildFloorCatalog, normalizeSearchText as norm} from '../../src/utils/roomCatalog';
import {routeFootprintSignature as signature} from '../../src/utils/routeLabelIdentity';
import {correspondenceFloor} from '../../src/utils/roomCorrespondenceIdentity';
import {prepareSpatialDataset, analyzeSpatialDataset, compareMetricRows} from '../../src/spaceAnalytics/relationships';
import {proposeClassification} from '../../src/spaceAnalytics/proposals';
import {SPACE_CATEGORIES, SUBCATEGORIES, GEOMETRY_ROLES} from '../../src/spaceAnalytics/schema';

const out='docs/space-analytics-stage-2b-f0';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const json=(name,value)=>fs.writeFileSync(`${out}/${name}`,JSON.stringify(value,null,2)+'\n');
const csv=(name,rows)=>{
 const fields=[...new Set(rows.flatMap(Object.keys))];
 const cell=v=>{let s=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 fs.writeFileSync(`${out}/${name}`,'\uFEFF'+[fields.map(cell).join(','),...rows.map(r=>fields.map(k=>cell(r[k])).join(','))].join('\n')+'\n');
};
const protectedFiles=read(`${out}/READONLY-START-HASHES.json`);
const verifyUnchanged=()=>{const changed=Object.entries(protectedFiles).filter(([p,h])=>hash(p)!==h).map(([p])=>p);assert.deepEqual(changed,[]);return {protected_file_count:Object.keys(protectedFiles).length,changed};};
verifyUnchanged();
const source='/rooms-basement-WGS.geojson',displaySource='/rooms-all-WGS-v6.geojson';
const currentRaw=read(`public${source}`),priorRaw=read(`${out}/baseline-F0.geojson`),combined=read(`public${displaySource}`);
const seed=read('data/space-analytics/metadata.proposals.v1.json');
assert.equal(hash(`${out}/baseline-F0.geojson`),seed.sources.find(s=>s.floor_id===0).source_sha256);
const prior=buildFloorCatalog(priorRaw,0).data.features,current=buildFloorCatalog(currentRaw,0).data.features;
const key=f=>f.properties.__roomSearchKey;
const display=buildFloorCatalog({...combined,features:combined.features.filter(f=>correspondenceFloor(f)===0)},0,displaySource).data.features;
const grouped=rows=>{const m=new Map();for(const f of rows){const s=signature(f.geometry);if(!m.has(s))m.set(s,[]);m.get(s).push(f);}return m;};
const previousSignatures=grouped(prior),currentSignatures=grouped(current),displaySignatures=grouped(display);
const strictMatch=(f,group)=>{const m=group.get(signature(f.geometry));return m?.length===1?m[0]:null;};
const metricInput=[...current,...display,...prior.map(f=>({...f,properties:{...f.properties,__roomSearchKey:'baseline:'+key(f)}}))];
const metric=prepareSpatialDataset({0:{type:'FeatureCollection',features:metricInput}});
const currentKeys=new Set(current.map(key));
const currentMetric={...metric,rows:new Map([...metric.rows].filter(([k])=>currentKeys.has(k))),floors:new Map([[0,metric.floors.get(0).filter(r=>currentKeys.has(r.key))]])};
const sourceHash=hash(`public${source}`),displayHash=hash(`public${displaySource}`);
const diagnostics=analyzeSpatialDataset(currentMetric,{dataset_version:'f0-sha256:'+sourceHash});
const boundsMeet=(a,b)=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
const candidates=(f,others,prefix='')=>{
 const a=metric.rows.get(key(f));if(!a)return [];
 return others.flatMap(g=>{const b=metric.rows.get(prefix+key(g));if(!b||!boundsMeet(a.bounds,b.bounds))return [];const r=compareMetricRows(a,b);return r.intersection_area_m2>1e-6?[{candidate_id:key(g),name:g.properties.name,area_m2:r.intersection_area_m2,iou:r.intersection_over_union,overlap_pct_current:r.overlap_pct_a,identity:'candidate_only'}]:[];}).sort((a,b)=>b.iou-a.iou);
};
const base=f=>Number(f.properties.base_height??f.properties.base_heigh??0),top=f=>Number(f.properties.height);
const changes=current.map(f=>{
 const old=strictMatch(f,previousSignatures),d=strictMatch(f,displaySignatures);
 const changed=old?Object.keys({...old.properties,...f.properties}).filter(k=>!k.startsWith('__')&&JSON.stringify(old.properties[k])!==JSON.stringify(f.properties[k])):[];
 return {feature_id:key(f),original_name:f.properties.name,prior_id:old?key(old):null,prior_name:old?.properties.name??null,changed_properties:changed,
  raw_geometry_changed:old?JSON.stringify(old.geometry)!==JSON.stringify(f.geometry):null,display_id:d?key(d):null,display_name:d?.properties.name??null,
  height_mismatch:d?Math.abs(base(f)-base(d))>1e-6||Math.abs(top(f)-top(d))>1e-6:false,name_mismatch:d?norm(f.properties.name)!==norm(d.properties.name):false,
  base:base(f),top:top(f),display_base:d?base(d):null,display_top:d?top(d):null,area_m2:metric.rows.get(key(f))?.area??null,
  predecessor_candidates:old?[]:candidates(f,prior,'baseline:'),display_candidates:d?[]:candidates(f,display)};
});
const retired=prior.filter(f=>!strictMatch(f,currentSignatures));
const extras=display.filter(f=>!strictMatch(f,currentSignatures));
json('F0-GEOMETRY-DIAGNOSTICS.json',{source_hash:sourceHash,display_hash:displayHash,baseline_hash:hash(`${out}/baseline-F0.geojson`),metric_issues:metric.issues,changes,retired:retired.map(f=>({feature_id:key(f),name:f.properties.name})),display_extras:extras.map(f=>({feature_id:key(f),name:f.properties.name,area_m2:metric.rows.get(key(f))?.area})),...diagnostics});
// Owner assertions are report evidence, not schema-approved or imported metadata.
const ownerPrompt='C:/Users/ChristDNA/.codex/attachments/bf3d44c9-6286-4238-a562-d95b7bc3372d/Pasted text.txt';
fs.copyFileSync(ownerPrompt,`${out}/OWNER-REQUEST.txt`);
const ownerStatements={source:ownerPrompt,source_sha256:hash(ownerPrompt),approval_imported:false,
 mechanical:{category:'building_services',subcategory:'mechanical_equipment_room',role:'room_boundary',physical_rooms:1,logical_spaces:1,entrance:'No entrance shown on floor plan',area_policy:'count once'},
 scrc:{category:'collections_bookshelves',subcategory:'restricted_collection_stacks',role:'room_boundary',physical_rooms:1,logical_spaces:1,access:'staff_only',area_policy:'count once'},
 collections:{category:'collections_bookshelves',role:'functional_zone',physical_rooms:0,logical_spaces_per_verified_zone:1},
 fixtures:{names:['National Union Catalog','Storage 3 Books','Indexes'],category:'collections_bookshelves',role:'furniture_or_equipment',physical_rooms:0,logical_spaces:0},
 restrooms:{role:'room_boundary',category:'restroom_facilities',physical_rooms_per_restroom:1},
 dewey_center:{category:'research_special_services',subcategory:'specialized_research_center',role:'room_boundary',physical_rooms:1,logical_spaces:1},
 empty:{category:'vacant_unassigned',subcategory:'unused_space',role:'functional_zone',enclosure:'unverified'},
 vertical:{stair_1:'open',stair_2:'enclosed',stair_3:'enclosed',elevator:'enclosed; shaft versus car unresolved',general_room_count:0},
 structural:{role:'structural_component',physical_rooms:0},floor:{role:'floor_background',physical_rooms:0,area_policy:'Do not add to contained rooms or treat residual area as circulation'},
 horizontal:{separately_digitized_circulation_confirmed:false,separate_elevator_lobby_confirmed:false}};
json('F0-OWNER-STATEMENTS.json',ownerStatements);
const priorMetadata=new Map(seed.features.filter(f=>f.floor_id===0).map(f=>[f.feature_id,f]));
const currentMetadata=read('data/space-analytics/metadata.f6-sync.v1.json');
const fixtureNames=new Set(['national union catalog','storage 3 books','indexes']);
const rangeQuestions=new Map([
 ['dewey books 551 to 882','The source range is 551 to 882; your confirmed range is 551–823. Which range is intended for this exact footprint?'],
 ['oversized journal a f','The source range is A–F; your confirmed range is A–D. Is this the same intended zone, and which range is correct?'],
 ['oversized journals f h','The source range is F–H; your confirmed range is E–H. Is this the same intended zone, and which range is correct?']
]);
const conflicts=diagnostics.relationships.filter(r=>r.relationship_type==='near_coincident');
const changesById=new Map(changes.map(r=>[r.feature_id,r]));
const records=current.map((f,i)=>{
 const id=key(f),p=f.properties,n=norm(p.name),change=changesById.get(id),old=change.prior_id?priorMetadata.get(change.prior_id):null;
 const proposed=proposeClassification(f);
 let category=proposed.proposed_space_category,subcategory=proposed.proposed_space_subcategory,role=proposed.proposed_geometry_role;
 let status='unresolved_owner_review',question='Confirm the function and modeled geometry role of this feature.',reason='No specific owner-confirmed interpretation is reliably bound.',priority=2,group=id;
 let physical=null,logical=null,statement=null,alternatives=['room boundary','functional zone','non-room component'],policy='pending verification',ownerConfirmed=false;
 const matched=change.prior_id&&norm(change.prior_name)===n;
 if(matched&&n==='structure'){
  category='structure_non_occupiable';subcategory='modeled_structure';role='structural_component';physical=0;logical=0;statement='structural';ownerConfirmed=true;
  status='owner_verified_matched';question=null;reason='Full unchanged footprint and original structural name link to the supplied non-room decision.';policy='exclude from independently occupiable room/zone totals';
  if(conflicts.some(r=>r.feature_a_id===id||r.feature_b_id===id)){
   status='technical_review_required';priority=1;reason='This structural footprint nearly coincides with a new owner-described room.';
   question='This structure nearly covers the Mechanical Room footprint. Is it a slab/background representation or physical structural material? Confirm its role so the same area is not counted twice.';
   alternatives=['background/slab representation','structural component','obsolete or duplicate representation requiring a separate authorized correction'];
  }
 }else if(matched&&n==='floor'){
  category='floor_background';subcategory='unresolved_floor_surface';role='floor_background';physical=0;logical=0;statement='floor';ownerConfirmed=true;status='owner_verified_matched';question=null;reason='Unchanged full basement footprint, with original floor label.';policy='do not add to contained areas; do not infer circulation from residual area';
 }else if(/^stairs? (case|area)/.test(n)){
  category='circulation_vertical_access';subcategory='staircase';role='stair_component';physical=0;logical=null;statement='vertical';ownerConfirmed=true;status='owner_verified_identity_pending';priority=3;group='numbered-stair-membership';
  reason='Stair component function is supported; association with owner-numbered Stair 1/2/3 is not recorded.';
  question='Which of Stair 1 (open), Stair 2 (enclosed), or Stair 3 (enclosed) contains this component? A marked plan assigning all components is sufficient.';alternatives=['component of Stair 1','component of Stair 2','component of Stair 3'];policy='not a general-purpose room; do not count components as separate stairs';
 }else if(matched&&/^rest room (male|female)$/.test(n)){
  category='restroom_facilities';subcategory='restroom';role='room_boundary';physical=1;logical=1;statement='restrooms';ownerConfirmed=true;status='owner_verified_matched';question=null;reason='Unique full footprint and unchanged restroom name support the owner decision.';policy='count one room; internal stalls do not add rooms';
 }else if(matched&&(fixtureNames.has(n)||category==='collections_bookshelves')){
  statement=fixtureNames.has(n)?'fixtures':'collections';ownerConfirmed=true;category='collections_bookshelves';role=fixtureNames.has(n)?'furniture_or_equipment':'functional_zone';physical=0;logical=fixtureNames.has(n)?0:1;
  status='owner_verified_matched';question=null;reason='Full prior footprint and unchanged named source match the owner interpretation.';policy=fixtureNames.has(n)?'fixture, not an independent room or collection zone':'count each verified logical collection zone once; no extra shelves/aisles';
  if(rangeQuestions.has(n)){
   status='owner_verified_identity_pending';priority=1;reason='Owner/source range labels disagree; collection function is confirmed.';question=rangeQuestions.get(n);logical=null;alternatives=['same zone with a corrected label','different intended range or boundary'];
  }else if(n.startsWith('journals 1995 older')){
   status='owner_verified_identity_pending';priority=1;group='journals-1995-membership';logical=null;
   reason='Three retained ranges potentially correspond to one owner-named zone; a separate Journals 1995 statement is unlocated.';
   question='Does this journal-range footprint belong to one shared Journals 1995 & Older logical area, or a separate verified zone? Identify which footprint, if any, represents Journals 1995.';alternatives=['component of shared older-journals zone','separate verified collection zone'];
  }
 }else if(n==='elevator'&&matched){
  category='circulation_vertical_access';subcategory='elevator';role='elevator_component';physical=0;logical=null;statement='vertical';ownerConfirmed=true;status='technical_review_required';priority=1;
  reason='Elevator identity and enclosed infrastructure use are supported; shaft versus car footprint is explicitly unverified.';question='Does this polygon depict the elevator shaft or the car footprint?';alternatives=['shaft footprint','car footprint'];policy='not a general-purpose room or separate lobby';
 }else if(n.includes('mechanical room')){
  ({category,subcategory,role}=ownerStatements.mechanical);physical=1;logical=1;statement='mechanical';ownerConfirmed=true;status='owner_verified_identity_pending';priority=1;
  reason='New export IDs and footprint; label differs from owner wording. Prior structure overlap is not strict identity.';question='Confirm this new Mechanical Room polygon is the enclosed equipment room you described. Its nearly coincident Structure polygon also needs a distinct non-double-counting role.';alternatives=['owner-described equipment room bound to this footprint','different or incorrectly drawn boundary'];policy='one physical room, one logical space, area once after identity/allocation review';
 }else if(n.startsWith('scrc ')){
  ({category,subcategory,role}=ownerStatements.scrc);physical=1;logical=1;statement='scrc';ownerConfirmed=true;status='owner_verified_identity_pending';priority=1;
  reason='New footprint; source says Stocks while the owner says Stacks. No strict F-ALL counterpart.';question='Confirm SCRC Stocks (Staff Only) is the staff-only Stacks room you described, and whether Stocks is a label typo.';alternatives=['owner-described staff-only stacks room','different intended boundary or function'];policy='staff only; one physical room, one logical space, area once after identity review';
 }else if(n==='emergency exit'){
  category='circulation_vertical_access';subcategory='entrance_exit';role='circulation_zone';physical=0;logical=null;priority=2;
  reason='Exact predecessor retained, but the owner statement does not resolve what this exit polygon models.';question='Does Emergency Exit represent a circulation area, door/threshold footprint, or structural element?';alternatives=['circulation zone','door/threshold component','structural component'];policy='not assumed to be an enclosed general-purpose room';
 }
 const pairs=diagnostics.relationships.filter(r=>r.feature_a_id===id||r.feature_b_id===id);
 return {feature_id:id,original_name:currentRaw.features[i].properties.name,geometry_type:f.geometry.type,geometry_valid:metric.rows.has(id),area_m2:metric.rows.get(id)?.area??null,source_attributes:currentRaw.features[i].properties,
  prior_feature_id:change.prior_id,identity_evidence:change.prior_id?'unique full footprint at 9-decimal export precision':'no strict predecessor',prior_metadata:old??null,
  lifecycle_status:change.prior_id?(change.prior_id===id?'retained_feature':'identifier_changed'):'new_feature',changed_properties:change.changed_properties,
  proposed_category:category,proposed_subcategory:subcategory,proposed_geometry_role:role,category_supported:SPACE_CATEGORIES.includes(category),subcategory_supported:SUBCATEGORIES[category]?.includes(subcategory)??false,role_supported:GEOMETRY_ROLES.includes(role),
  reconciliation_status:status,priority:question?priority:null,reason,owner_question:question,alternatives:question?alternatives:[],review_group:group,owner_statement:statement,owner_semantics_confirmed:ownerConfirmed,
  owner_physical_room_count:physical,owner_logical_space_count:logical,count_policy:policy,count_status:'report-only owner intent; not imported or allocated',
  logical_space_id:null,parent_space_id:null,component_of:null,potential_logical_membership:group!==id?group:null,
  geometric_container_candidates:pairs.filter(r=>r.geometric_contained_id===id).map(r=>r.geometric_container_id),geometric_child_candidates:pairs.filter(r=>r.geometric_container_id===id).map(r=>r.geometric_contained_id),
  overlap_review_pairs:pairs.filter(r=>r.significance==='material').map(r=>r.relationship_id),background_containment_is_functional_parent:false,
  display_id:change.display_id,display_status:change.display_id?'strict_match':'identity_unresolved',display_height_mismatch:change.height_mismatch,display_name_mismatch:change.name_mismatch};
});
const retiredRecords=retired.map(f=>({feature_id:null,prior_feature_id:key(f),original_name:f.properties.name,lifecycle_status:'retired_feature',reconciliation_status:'owner_verified_identity_pending',proposed_category:'structure_non_occupiable',proposed_subcategory:'modeled_structure',proposed_geometry_role:'structural_component',priority:2,reason:'Old full footprint and secondary export ID are absent; reused FID does not identify a replacement.',owner_question:'Was this old structural footprint intentionally removed? If replaced, supply its explicit current counterpart; no strict match exists.',review_group:key(f),owner_semantics_confirmed:true,alternatives:['intentionally removed modeled structure','replaced geometry requiring explicit lineage']}));
const unlocated=[
 ['Center for Dewey Studies','research_special_services','specialized_research_center','room_boundary','Provide the current F0 polygon ID or a marked boundary for the confirmed Center for Dewey Studies. No exact named source feature was found.'],
 ['Empty','vacant_unassigned','unused_space','functional_zone','Identify the vacant/unassigned area on the current F0 plan and confirm its physical enclosure; no source feature named Empty was found.'],
 ['Journals 1995','collections_bookshelves','journal_collection','functional_zone','Identify the distinct Journals 1995 footprint, or clarify its membership among Journals 1995 & Older ranges.']
].map(([name,category,subcategory,role,question])=>({feature_id:null,prior_feature_id:null,original_name:null,owner_statement_name:name,lifecycle_status:'unlocated_owner_statement',reconciliation_status:'owner_verified_identity_pending',proposed_category:category,proposed_subcategory:subcategory,proposed_geometry_role:role,priority:2,reason:'No reliable source feature ID is available; owner interpretation retained without fabricated identity.',owner_question:question,owner_semantics_confirmed:true,review_group:name,alternatives:['omitted polygon','existing feature needing explicit owner crosswalk']}));
const reconciliation=[...records,...retiredRecords,...unlocated];
const unresolved=reconciliation.filter(r=>r.reconciliation_status!=='owner_verified_matched').sort((a,b)=>a.priority-b.priority||Number(a.feature_id?.split(':').at(-1)??Infinity)-Number(b.feature_id?.split(':').at(-1)??Infinity)||String(a.owner_statement_name??a.prior_feature_id).localeCompare(String(b.owner_statement_name??b.prior_feature_id)));
csv('F0-LATEST-INVENTORY.csv',records);csv('F0-STAGE2B-RECONCILIATION.csv',reconciliation);csv('F0-UNRESOLVED-VERIFICATION.csv',unresolved);
json('F0-LATEST-INVENTORY.json',records);json('F0-STAGE2B-RECONCILIATION.json',reconciliation);json('F0-UNRESOLVED-VERIFICATION.json',unresolved);
csv('F0-FALL-CROSSWALK.csv',changes);csv('F0-FALL-EXTRA-FEATURES.csv',extras.map(f=>({feature_id:key(f),original_name:f.properties.name,area_m2:metric.rows.get(key(f))?.area,candidates:candidates(f,current)})));
csv('F0-SPATIAL-RELATIONSHIPS.csv',diagnostics.relationships);
const tally=values=>values.reduce((m,v)=>(m[v]=(m[v]||0)+1,m),{});
const summary={source_hash:sourceHash,combined_hash:displayHash,total_current_F0:current.length,baseline_F0:prior.length,total_display_F0:display.length,
 added_footprints:changes.filter(r=>!r.prior_id).length,removed_footprints:retired.length,strict_prior_matches:changes.filter(r=>r.prior_id).length,
 proven_identifier_changes:changes.filter(r=>r.prior_id&&r.prior_id!==r.feature_id).length,raw_geometry_changes_on_matched_footprints:changes.filter(r=>r.raw_geometry_changed).length,
 current_status_counts:tally(records.map(r=>r.reconciliation_status)),historical_identity_pending:retiredRecords.length,unlocated_owner_statements:unlocated.length,
 current_unresolved_classifications:records.filter(r=>r.reconciliation_status==='unresolved_owner_review').length,
 display_strict_matches:changes.filter(r=>r.display_id).length,display_missing_strict_links:changes.filter(r=>!r.display_id).length,display_extra_unmatched:extras.length,
 display_height_mismatches:changes.filter(r=>r.height_mismatch).length,display_name_mismatches:changes.filter(r=>r.name_mismatch).length,
 distinct_inconsistent_source_records:changes.filter(r=>!r.display_id||r.height_mismatch||r.name_mismatch).length+extras.length,
 exact_duplicate_current_footprints:[...currentSignatures.values()].filter(v=>v.length>1).map(v=>v.map(key)),near_coincident_pairs:conflicts,
 positive_intersection_pairs:diagnostics.relationships.filter(r=>r.intersection_area_m2>1e-6).length,geometry_issues:metric.issues,spatial_errors:diagnostics.errors,
 inventory_rows:records.length,reconciliation_rows:reconciliation.length,unresolved_rows:unresolved.length,
 formal_F0_approvals_found:currentMetadata.features.filter(f=>f.floor_id===0&&f.verification_status==='verified').length,
 ready_for_stage2b_closure:false,first_ten_unresolved:unresolved.slice(0,10).map(({feature_id,prior_feature_id,original_name,priority,owner_question})=>({feature_id,prior_feature_id,original_name,priority,owner_question}))};
json('F0-SUMMARY.json',summary);
const unsupported=[
 {category:'building_services',subcategory:'mechanical_equipment_room',recommendation:'Existing building_support / mechanical, preserving room_boundary and the owner meaning; alternatively an explicitly approved schema extension.'},
 {category:'collections_bookshelves',subcategory:'restricted_collection_stacks',recommendation:'Existing collections_bookshelves / book_stacks with staff_only access metadata; alternatively an explicitly approved new subcategory.'},
 {category:'research_special_services',subcategory:'specialized_research_center',recommendation:'Closest existing category research_cultural_resources; approve a specialized_research_center subtype. Do not silently substitute research_lab.'},
 {category:'vacant_unassigned',subcategory:'unused_space',recommendation:'Explicit schema extension recommended. unclassified is only a temporary technical state, not the owner-confirmed meaning.'}
].map(r=>({...r,category_supported:SPACE_CATEGORIES.includes(r.category),subcategory_supported:SUBCATEGORIES[r.category]?.includes(r.subcategory)??false}));
csv('F0-TAXONOMY-COMPATIBILITY.csv',unsupported);
const esc=v=>String(v??'—').replaceAll('|','\\|').replaceAll('\n',' ');
const table=(headers,rows)=>[headers.map(esc).join(' | '),headers.map(()=>'---').join(' | '),...rows.map(r=>r.map(esc).join(' | '))].map(r=>'| '+r+' |').join('\n');
const write=(name,text)=>fs.writeFileSync(`${out}/${name}`,text+'\n');
const missing=changes.filter(r=>!r.display_id),heightDiffs=changes.filter(r=>r.height_mismatch),nameDiffs=changes.filter(r=>r.name_mismatch);
write('F0-FALL-CONSISTENCY.md',`# Corrected F0 / F-ALL consistency

Individual F0 is the classification authority. F-ALL is a separate display dataset, never an additional source of rooms for counting. No GeoJSON was modified.

Current F0 SHA-256: ${sourceHash}

F-ALL SHA-256: ${displayHash}

There are **${current.length} individual F0 polygons**, **${display.length} F0 display polygons**, and **${summary.display_strict_matches} unique strict correspondences**. Full horizontal rings at the application's existing nine-decimal-degree export precision establish identity; names, row order, similar numeric IDs, and high intersection-over-union do not. These F0 datasets have zero base offset; no visual stack transformation enters the comparison.

## Missing strict correspondences (${missing.length})

${table(['Current exact ID','Exact source name','Best overlap candidate (not identity)','IoU %'],missing.map(r=>[r.feature_id,r.original_name,r.display_candidates[0]?.candidate_id,r.display_candidates[0]? (r.display_candidates[0].iou*100).toFixed(6):null]))}

All 16 named collection/fixture footprints restored in corrected F0 lack strict display links. Candidate overlap with a background Floor or broad Structure polygon does not establish that these zones are represented. The new Mechanical Room has a near-coincident display Structure candidate (OBJECTID 113), but fails strict identity. The new SCRC room has only background/sliver display candidates; no distinct room counterpart is established. Geometry differences in these candidate pairs are reported, not automatically repaired or assigned.

## Extra or unmatched display footprints (${extras.length})

${table(['Display exact ID','Exact name','Area m²'],extras.map(f=>[key(f),f.properties.name,metric.rows.get(key(f))?.area.toFixed(6)]))}

“Extra” means no strict individual F0 match, not proven erroneous physical geometry. Some may be altered counterparts. Confirm export provenance before any future deletion or replacement. Candidate intersections are retained in [F0-FALL-EXTRA-FEATURES.csv](F0-FALL-EXTRA-FEATURES.csv).

## Height mismatches on proven pairs (${heightDiffs.length})

${table(['Current exact ID','F0 base / top','Display exact ID','Display base / top'],heightDiffs.map(r=>[r.feature_id,r.base+' / '+r.top,r.display_id,r.display_base+' / '+r.display_top]))}

Differences exceed 1e-6 meters. Unmatched candidate heights are not counted as proven-pair discrepancies.

## Name mismatches on proven pairs (${nameDiffs.length})

${table(['Current exact ID','Exact F0 name','Exact display name'],nameDiffs.map(r=>[r.feature_id,r.original_name,r.display_name]))}

Names are normalized only for comparison; source spelling remains unchanged. All three name mismatches are already among the height-discrepant pairs.

## Counts

**${summary.distinct_inconsistent_source_records} distinct inconsistent source records/pairs** = ${missing.length} unlinked individual records + ${extras.length} unlinked display records + ${heightDiffs.length} discrepant matched pairs. This is not a room count or a count of proven physical defects; an unlinked candidate pair can appear once on each export side. The three name issues do not add three more records. There are no duplicate current or F0 display export IDs, and no exact duplicate current footprints. Both datasets pass the reused polygon validity checks.

See [F0-FALL-CROSSWALK.csv](F0-FALL-CROSSWALK.csv) and [F0-GEOMETRY-DIAGNOSTICS.json](F0-GEOMETRY-DIAGNOSTICS.json) for complete evidence.
`);
const firstTen=table(['Priority','Exact current ID','Exact source name','Verification question'],summary.first_ten_unresolved.map(r=>[r.priority,r.feature_id??r.prior_feature_id,r.original_name,r.owner_question]));
const newRooms=records.filter(r=>['mechanical','scrc'].includes(r.owner_statement));
write('F0-STAGE2B-RECHECK-SUMMARY.md',`# Corrected F0 re-audit and Stage 2B reconciliation

**F0 is not ready for Stage 2B closure.** This regenerated audit uses the corrected 149-feature individual export, not the mistaken 140-feature upload. The named collection footprints are present again. Reports only were generated; source data, existing owner records, schema, and application behavior were preserved. No F1 audit, Stage 3 area engine or dashboard was started.

## Results

${table(['Measure','Result'],[
 ['Current F0 polygons',current.length],['Added polygon records/footprints versus Stage 2A',summary.added_footprints],['Removed prior footprint',summary.removed_footprints],
 ['Strict predecessor matches',summary.strict_prior_matches],['Proven FID changes',summary.proven_identifier_changes],['Changed geometry among strict predecessor matches',summary.raw_geometry_changes_on_matched_footprints],
 ['Reliably reconciled owner-verified current features',summary.current_status_counts.owner_verified_matched],['Owner-confirmed meaning, identity or membership pending (current)',summary.current_status_counts.owner_verified_identity_pending],
 ['Current unresolved functional classifications',summary.current_unresolved_classifications],['Additional technical role/representation reviews',summary.current_status_counts.technical_review_required],
 ['Historical identity pending',retiredRecords.length],['Unlocated owner statements',unlocated.length],['F0/F-ALL inconsistent source records/pairs',summary.distinct_inconsistent_source_records],['Stage 2B closure','Not ready']])}

The 42 reliably reconciled current features comprise 29 structural footprints, two restrooms, one floor background, and ten collection/fixture footprints. They are excluded from the owner-verification queue. “Owner verified matched” is a report reconciliation status, not a new metadata approval event.

The 104 current identity/membership cases comprise **96 stair components**, **six collection-range/grouping cases**, and **two new room bindings**. Their broad functions are already confirmed; this does not mean 104 unknown uses or 96 separate staircases. The 96 stair components need association with the owner's Stair 1 (open), Stair 2 (enclosed), and Stair 3 (enclosed). One marked plan assigning components can resolve that grouped review. Three journal-range polygons are not automatically counted as three independently verified logical zones.

The one unresolved functional/geometry-role classification is Emergency Exit, current FID 140: circulation area, door/threshold component or structural representation. Two additional technical reviews concern Structure FID 96 versus the Mechanical Room, and Elevator FID 139 (shaft versus car). The missing historical Structure and unlocated Center for Dewey Studies, Empty and distinct Journals 1995 statements remain separate from current feature totals. Verified owner functions are preserved for all three unlocated statements.

## Source provenance and change evidence

- Authoritative F0: public/rooms-basement-WGS.geojson, mapped by FLOOR_POLYGON_MAP[0] in src/utils/roomCatalog.js. Current SHA-256: ${sourceHash}.
- F-ALL: public/rooms-all-WGS-v6.geojson. SHA-256: ${displayHash}; unchanged from the prior conversation's audit.
- Stage 1: docs/space-analytics-stage-1/feature-inventory.csv and audit.mjs.
- Stage 2A metadata: data/space-analytics/metadata.proposals.v1.json. Its recorded F0 source hash (${hash(`${out}/baseline-F0.geojson`)}) exactly matches the historical Git snapshot saved as baseline-F0.geojson.
- Stage 2A spatial and membership proposals: docs/space-analytics-stage-2a/spatial-relationship-review.csv, spatial-diagnostics.json, membership-proposals.json and membership-review.csv.
- Current isolated metadata pointer: data/space-analytics/current.json; metadata.f6-sync.v1.json preserves the separate F6/F4 work. Its F0 source version predates this corrected file. No F0 formal approvals were found; owner assertions for this task are preserved in OWNER-REQUEST.txt and F0-OWNER-STATEMENTS.json.
- Review/import workflow: scripts/space-analytics.cjs and src/spaceAnalytics/metadata.js; docs/space-analytics-stage-2a/approval-template.json and DATA-DICTIONARY.md. A future import needs explicit decisions, reviewer/date/evidence and a matching dataset revision. No import or schema change was performed.

Full-footprint matching establishes 147 predecessors; their raw geometry and non-identifier attributes are unchanged. Of these, 74 have different FIDs. The retained secondary FID_ values and full-footprint matches support the crosswalk; current FIDs must not be joined directly to old FIDs. Old FID 73 / FID_ 81 (structure) is absent; current FID 73 is a different retained staircase component. The two new footprints have FIDs 147/148 and previously absent FID_ values 156/157. They are added modeled polygons; this does not mean two newly constructed physical rooms. No edit lineage is inferred between the removed structure and the two additions.

## New rooms and important overlap

${table(['Exact current ID','Exact source name','Area m²','Owner intent retained'],newRooms.map(r=>[r.feature_id,r.original_name,r.area_m2.toFixed(6),'1 enclosed room; 1 logical space; area once']))}

Mechanical FID 147 nearly coincides with existing Structure FID 96: **${(conflicts[0].intersection_over_union*100).toFixed(6)}% IoU**, intersection **${conflicts[0].intersection_area_m2.toFixed(6)} m²**. Structure FID 96 is the unchanged predecessor of old FID 97. Both current polygons remain present and fail strict equality, so the Mechanical Room must not be described as a simple rename of a removed polygon. Resolve the modeled role of Structure before allocated area is computed; do not merge, delete or count both automatically. “No Access” retains the owner's explanation that no entrance is shown on the plan, not a claim that no physical entrance exists.

SCRC is spelled **Stocks** in the corrected source, rather than the owner's **Stacks**. The footprint and ID are reported as the candidate binding without silently correcting the label. Both new rooms lack strict F-ALL identity. Their owner-requested count policies are retained, but no production counts or allocation are activated.

## Geometry, spatial relationships and counting safeguards

All ${current.length} current polygons, ${display.length} F0 display polygons and the historical baseline pass topology preparation; no geometry calculation failed. Areas use the existing local spherical Lambert azimuthal equal-area projection in meters, followed by polygon area/intersection operations. The shared origin is recorded in F0-GEOMETRY-DIAGNOSTICS.json. Source Shape_Area is preserved without assuming square-meter units; some named polygons store zero there despite having positive computed area.

There are ${summary.positive_intersection_pairs} positive-area same-floor pairs above 1e-6 m², including expected background containment; ${conflicts.length} near-coincident pair and no exact duplicate current footprints. Full material-overlap and containment diagnostics are in F0-SPATIAL-RELATIONSHIPS.csv. Inventory rows list geometric container/child candidates and pair references. Geometry containment is not an approved functional parent. logical_space_id, component_of and parent_space_id remain null. Floor FID 122 is background and must not be added to the areas it contains. No residual circulation or elevator-lobby polygon was invented, and no area engine ran.

## Taxonomy compatibility

${table(['Requested category / subcategory','Recommendation'],unsupported.map(r=>[r.category+' / '+r.subcategory,r.recommendation]))}

All requested geometry roles exist. The unsupported owner terms remain explicitly flagged as report proposals, not silently imported enum values. Function, geometry role, physical-room count and logical membership remain separate fields. Existing owner classifications are not overwritten.

## First ten unresolved cases, ordered by priority

${firstTen}

The remaining queue includes Emergency Exit, old removed Structure FID 73, three unlocated owner statements and the grouped staircase assignment. Exact raw source names, including leading spaces, are preserved in CSV/JSON. The queue has ${unresolved.length} rows (${records.filter(r=>r.reconciliation_status!=='owner_verified_matched').length} current + ${retiredRecords.length} historical + ${unlocated.length} unlocated statements).

## Deliverables and verification

- [F0-LATEST-INVENTORY.csv](F0-LATEST-INVENTORY.csv): ${records.length} current features.
- [F0-STAGE2B-RECONCILIATION.csv](F0-STAGE2B-RECONCILIATION.csv): ${reconciliation.length} records. reconciliation_status distinguishes owner_verified_matched, owner_verified_identity_pending, unresolved_owner_review and technical_review_required; lifecycle_status separately identifies new_feature and retired_feature, preserving both concepts.
- [F0-UNRESOLVED-VERIFICATION.csv](F0-UNRESOLVED-VERIFICATION.csv): ${unresolved.length} unresolved records with questions, alternatives and priorities.
- [F0-FALL-CONSISTENCY.md](F0-FALL-CONSISTENCY.md): ${missing.length} missing strict links, ${extras.length} extra/unmatched display records, ${heightDiffs.length} height-discrepant proven pairs and ${nameDiffs.length} label differences already among those pairs. These ${summary.distinct_inconsistent_source_records} source discrepancies are not ${summary.distinct_inconsistent_source_records} rooms.
- This summary, plus supporting JSON, strict crosswalk, spatial diagnostics and [F0-TAXONOMY-COMPATIBILITY.csv](F0-TAXONOMY-COMPATIBILITY.csv).

Reproduce using node docs/space-analytics-stage-2b-f0/run-audit.cjs. [F0-VALIDATION.json](F0-VALIDATION.json) records focused audit checks and hashes for all ${Object.keys(protectedFiles).length} pre-existing protected files. Browser tests and a production build were not run for this read-only report task.

The prior 140-polygon audit findings are superseded by this corrected-source report; see [SUPERSESSION.md](SUPERSESSION.md). No prior owner-verification records were removed or changed. Existing F4 decisions and separate F6 requirements are preserved.
`);
write('SUPERSESSION.md',`# Corrected-source supersession

The user explicitly identified the prior 140-feature F0 upload as the wrong file. That prior source hash, recorded in the conversation, was bfb84a74c2b64dc94f177a34e8dc26b934fbc8414cbd4202705cafd6764219ae.

This audit instead uses corrected F0 SHA-256 ${sourceHash}, with ${current.length} polygons. The earlier statements of 16 unmatched current footprints, 24 missing historical footprints, absent collection zones, and Mechanical Room OBJECTID 113 do not describe this file. The corrected export uses FID identifiers. Current Mechanical Room is FID 147 and SCRC is FID 148.

The previous docs/space-analytics-stage-2b-f0 directory was absent from this checkout at the start of the rerun, so its former artifacts could not be archived. This note preserves their superseded status from the conversation without claiming that those unavailable files were recovered. All existing Stage 1/2A and F4/F6 owner records were left unchanged.
`);
const checks=[];
const check=(name,fn)=>{fn();checks.push({name,status:'passed'});};
check('all current features inventoried with exact names and attributes',()=>{assert.equal(records.length,currentRaw.features.length);records.forEach((r,i)=>{assert.equal(r.original_name,currentRaw.features[i].properties.name);assert.deepEqual(r.source_attributes,currentRaw.features[i].properties);});});
check('unique export IDs and no accidental row identity matching',()=>{for(const list of [current,prior,display]){assert.equal(new Set(list.map(key)).size,list.length);assert.equal(new Set(list.map(f=>f.properties.OBJECTID??f.properties.FID)).size,list.length);}});
check('strict predecessor crosswalk is reciprocal',()=>{for(const r of changes.filter(r=>r.prior_id)){const f=current.find(f=>key(f)===r.feature_id),old=prior.find(f=>key(f)===r.prior_id);assert.equal(key(strictMatch(old,currentSignatures)),key(f));assert.equal(signature(old.geometry),signature(f.geometry));}});
check('added, retained and removed accounting is complete',()=>{assert.equal(summary.strict_prior_matches+summary.added_footprints,current.length);assert.equal(summary.strict_prior_matches+retired.length,prior.length);const oldSecondary=new Set(prior.map(f=>f.properties.FID_));for(const f of current.filter(f=>!strictMatch(f,previousSignatures)))assert(!oldSecondary.has(f.properties.FID_));});
check('full footprint F-ALL links are reciprocal and same-floor',()=>{for(const f of current){const d=strictMatch(f,displaySignatures);if(d){assert.equal(correspondenceFloor(d),0);assert.equal(key(strictMatch(d,currentSignatures)),key(f));}}});
check('geometry validation, intersections and areas are valid',()=>{assert.deepEqual(metric.issues,[]);assert.deepEqual(diagnostics.errors,[]);assert(records.every(r=>r.geometry_valid&&Number.isFinite(r.area_m2)&&r.area_m2>0));});
check('matched owner records excluded from unresolved queue; no invented hierarchy',()=>{assert(!unresolved.some(r=>r.reconciliation_status==='owner_verified_matched'));assert(records.every(r=>r.logical_space_id===null&&r.parent_space_id===null&&r.component_of===null));});
check('near-coincident mechanical/structure conflict remains explicit',()=>{assert.equal(conflicts.length,1);const ids=[conflicts[0].feature_a_id,conflicts[0].feature_b_id];assert(ids.every(id=>records.find(r=>r.feature_id===id).reconciliation_status!=='owner_verified_matched'));assert(newRooms.every(r=>r.owner_physical_room_count===1&&r.owner_logical_space_count===1));});
check('ambiguous journal groups do not receive per-polygon logical counts',()=>{const rows=records.filter(r=>r.review_group==='journals-1995-membership');assert.equal(rows.length,3);assert(rows.every(r=>r.owner_logical_space_count===null&&r.owner_physical_room_count===0));});
check('unsupported taxonomy flagged without production schema changes',()=>{assert.equal(unsupported.length,4);assert(unsupported.every(r=>!r.category_supported||!r.subcategory_supported));});
const integrity=verifyUnchanged();checks.push({name:'all pre-existing protected files unchanged, including F4/F6 and owner metadata',status:'passed'});
json('F0-VALIDATION.json',{checks,integrity,browser_test_run:false,application_build_run:false,source_hash:sourceHash,combined_hash:displayHash});
console.log(JSON.stringify({summary:{...summary,near_coincident_pairs:undefined,first_ten_unresolved:undefined},checks_passed:checks.length,integrity},null,2));
