// Investigation-only inventory. Proposed labels below are analyst hypotheses,
// not a production classifier, verified room schedule, or assignable-area model.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {union} from 'polyclip-ts';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp';
import {FLOOR_POLYGON_MAP, ROOM_FLOORS, buildFloorCatalog, roomName, roomIdentifiers, normalizeSearchText} from '../../src/utils/roomCatalog.js';
import {createCorrespondenceIndex, intersectRows, OVERLAP_AREA_EPSILON} from '../../src/utils/roomCorrespondence.js';
import {footprintSignature, correspondenceFloor} from '../../src/utils/roomCorrespondenceIdentity.js';
import {routeFootprintSignature} from '../../src/utils/routeLabelIdentity.js';

const out='docs/space-analytics-stage-1', reader=new GeoJSONReader();
fs.mkdirSync(out,{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const json=(name,data)=>fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(data,null,2)+'\n');
const csv=(name,rows)=>{const fields=[...new Set(rows.flatMap(Object.keys))];const cell=v=>`"${String(v??'').replaceAll('"','""')}"`;fs.writeFileSync(`${out}/${name}.csv`,'\uFEFF'+[fields.map(cell).join(','),...rows.map(r=>fields.map(k=>cell(r[k]!=null&&typeof r[k]==='object'?JSON.stringify(r[k]):r[k])).join(','))].join('\n')+'\n');};
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(path.join(dir,d.name)):[path.join(dir,d.name).replaceAll('\\','/')]);
const protectedPaths=[...walk('src'),...walk('public'),...walk('routing'),'package.json','package-lock.json','vite.config.js'].filter(p=>fs.existsSync(p));
const hashes=()=>Object.fromEntries(protectedPaths.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const before=hashes();
const freq=values=>Object.fromEntries([...values.reduce((m,v)=>m.set(String(v),(m.get(String(v))||0)+1),new Map())].sort((a,b)=>a[0].localeCompare(b[0])));
const points=coords=>!Array.isArray(coords)?[]:typeof coords[0]==='number'?[coords]:coords.flatMap(points);
const sources=walk('public').filter(p=>p.endsWith('.geojson'));
const datasets={},catalogs={};for(const floor of ROOM_FLOORS){const c=buildFloorCatalog(read(`public${FLOOR_POLYGON_MAP[floor]}`),floor);catalogs[floor]=c;datasets[floor]=c.data;}
const index=createCorrespondenceIndex(datasets);
const norm=normalizeSearchText;
// Explicit exact-name audit annotations derived from the inspected name list.
const proposals=new Map();
function propose(names,category,subcategory,confidence,evidence,status='name_supported_unverified'){
 for(const name of names.split('|'))proposals.set(norm(name),{proposed_category:category,proposed_subcategory:subcategory,confidence,evidence,verification_status:status});
}
propose('Structure|Structures','structure_non_occupiable','modeled_structure','high','Owner guidance for exact Structure/Structures names; non-occupiable, not evidence of load-bearing function','owner_guidance_provisional');
propose('Floor','floor_background','unresolved_floor_surface','high','Exact Floor name identifies modeled surface; reading/circulation use and boundary meaning unknown','needs_manual_review');
propose('Stair Case|Stairs Case|Stairs|Stairs Area|Stairs Area Upper|Stairs Area Base|Stairs Upper Area|Stairs Area Lower','circulation_vertical_access','staircase','high','Explicit stair name; modeled components must not be counted as distinct stairwells');
propose('Srairs Area Upper','circulation_vertical_access','staircase','low','Likely source spelling error; requires confirmation','needs_manual_review');
propose('Structure Stairs Base','structure_non_occupiable','stair_base','medium','Mixed structural/stair name; not covered by exact-name owner rule','needs_manual_review');
propose('Elevator','circulation_vertical_access','elevator','high','Explicit elevator name; polygon extent and physical lift identity need verification');
propose('Emergency Exit|Emergency Exit Only|Front Entrance/Emergency Exit|Back Entrance/Emergency Exit','circulation_vertical_access','entrance_exit','high','Explicit access/exit name; modeled doorway is not a room');
propose('Rest Room Male|Rest Room Female|All Gender Restroom','restroom_facilities','restroom','high','Explicit restroom name plus owner guidance; not study-room area');
propose('Classroom 0174|Classroom 0261|Math Classroom 0654|Math Classroom 0652|Classroom 0610A|Classroom 0754|Classroom 0752|Classroom 0722|Classroom 0724','study_learning','classroom','high','Explicit classroom name and owner guidance');
propose('Group Study 0320A|Group Study 0320B|Group Study 0320C|Group Study 0420A|Group Study 0420B|Group Study 0420C|Group Study 0420D|Group Study 0510A|Group Study 0510B|Group Study 0550A|Group Study 0550B|Group Study 0540A|Group Study 0540B','study_learning','group_study','high','Explicit Group Study name; repeated names are distinct source components until reviewed');
propose('Groups Study 0580A','study_learning','group_study','medium','Plural Groups Study name; source alias needs review','needs_manual_review');
propose('Family Study 0320D','study_learning','family_study','high','Explicit Family Study name and owner guidance');
propose('Group Study Space|Collaborative Space|Browsing Room','open_reading_study','candidate_open_study','low','Suggests study/reading use but enclosure, modeled furniture, and zone extent are unknown','needs_manual_review');
propose('Faculty Research 0580B|Faculty Research 0580C','research_cultural_resources','faculty_research','high','Explicit faculty research name; preserve distinct research function');
propose('Faculty Writing 0580D','research_cultural_resources','faculty_writing','medium','Writing label; detailed function requires owner confirmation','needs_manual_review');
propose('Geospatial Resources','research_cultural_resources','geospatial_resources','medium','Owner identifies research/learning resource; repeated polygons may model fixtures rather than whole room','needs_manual_review');
propose('Special Collections Research Center Reading Room','research_cultural_resources','special_collections_reading','high','Owner-provided exact service/reading name, not generic book stacks');
propose('Dejarnett American Heritage Room|Southern Illinois African American Heritage Center 0640A','research_cultural_resources','cultural_heritage','high','Owner identifies cultural/research resource; original names retained');
propose('Computer Lab 0139|Math Lab 0677|Math Lab 0680','study_learning','laboratory','medium','Named lab; lab type and instructional/research allocation require review','needs_manual_review');
propose('John C Guyon Auditorium','auditorium_events','auditorium','high','Owner identifies auditorium; four source polygons are not four auditoria');
propose('Library Conference 0480A','auditorium_events','conference','medium','Conference label; departmental/learning/event use unresolved','needs_manual_review');
propose('Danielle C. Baker Research & Information Desk (0161)|Help Desk','library_services','service_desk','medium','Owner identifies service locations; area basis may be counter or furniture, not service-zone footprint','needs_manual_review');
propose('Access Services (0130) & Offices','library_services','mixed_service_office','medium','Owner service location and explicit mixed-use name; no defensible allocation between uses','needs_manual_review');
propose('Writing Center|Testing Services|Center For Learning Support Services|Tutoring Center','library_services','student_support','medium','Student-facing service candidate; do not silently classify as office','needs_manual_review');
propose('Information Resources Management|Library Administration|Office|Faulty And Staff Offices','offices_administration','administrative_office','medium','Office/administration candidate; Faulty source spelling preserved and department/use unverified','needs_manual_review');
propose('Southern Illinois University Press (0362)','offices_administration','publisher_office','medium','Prior project example describes SIU Press office; current name alone does not prove entire footprint use','needs_manual_review');
propose('Delytes Cafe','building_support','food_service','medium','Cafe name; sixteen modeled pieces do not establish sixteen rooms','needs_manual_review');
propose('Printers','building_support','print_equipment','high','Explicit equipment name; exclude from conventional room counts pending space-role confirmation','needs_manual_review');
propose('Lactation Room 0323','building_support','wellbeing','high','Explicit lactation room name');
propose('Lerner Music Studio','study_learning','music_studio','medium','Named studio; learning/research and actual allocation require review','needs_manual_review');
propose('dewey books 001 to 330|dewey books q001 to q998|dewey books 551 to 882|dewey books 330 to 551|dewey books 823 to 914|dewey books 914 to 999|oversized lc books a to z|imc books|lc books tx to z|lc books tk to tx|lc books r to tk|map books|lc books pg to ps|lc books hv to pg|lc books hj to jc|lc books qr to ps|lc books da to hg|lc books a to da','collections_bookshelves','book_collection','high','Explicit Books name; footprint may be collection zone, not shelf count');
propose('dewey folios 001 to 999|lc folios a to z','collections_bookshelves','folio_collection','high','Explicit Folios name');
propose('journals 1995 & older a to f|oversized journal a - f|journals 1995 & older f to i|oversized journals f - h|oversized journals i - z|journals 1995 & older j to z|journals a to e|journals f to j|journals j to n|journals n to z','collections_bookshelves','journal_collection','high','Explicit Journal/Journals name');
propose('storage 3 books','collections_bookshelves','book_storage','medium','Books and Storage mixed label; public collection versus support storage unresolved','needs_manual_review');
propose('national union catalog|indexes|dvds videos|theses & dissertations|music scores|government documents|microforms|newspaper','collections_bookshelves','special_format_materials','medium','Named material format suggests collections; owner should verify modeled footprint/use','needs_manual_review');

const inventory=[];
for(const floor of ROOM_FLOORS)for(const [i,f] of datasets[floor].features.entries()){
 const key=f.properties.__roomSearchKey,row=index.rows.get(key),name=roomName(f),proposal=proposals.get(norm(name))||{proposed_category:'unclassified',proposed_subcategory:'',confidence:'none',evidence:name?'Name alone insufficient; no exact reviewed audit proposal':'Missing source name',verification_status:'needs_manual_review'};
 const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
 inventory.push({feature_id:key,floor_id:floor,source_row:i,original_name:f.properties.name??'',source_dataset:FLOOR_POLYGON_MAP[floor],source_ids:roomIdentifiers(f),geometry_type:f.geometry.type,part_count:polygons.length,hole_count:polygons.reduce((a,p)=>a+p.length-1,0),area_m2:row?.area??null,geometry_status:row?'valid':index.rejected.get(key)?.reason??'unavailable',...proposal,existing_verified_category:null,source_level:f.properties.level,source_stack:f.properties.stack,source_color:f.properties.color??'',source_base_height:f.properties.base_height??f.properties.base_heigh,source_height:f.properties.height,source_shape_area:f.properties.Shape_Area,footprint_hash:crypto.createHash('sha256').update(footprintSignature(f.geometry)||'').digest('hex')});
}
assert.equal(new Set(inventory.map(r=>r.feature_id)).size,inventory.length);
csv('feature-inventory',inventory);
csv('manual-review',inventory.filter(row=>row.verification_status==='needs_manual_review'));
const sourceInventory=[],attributes={};
for(const source of sources){
 const d=read(source),features=d.features||[],xy=features.flatMap(f=>points(f.geometry?.coordinates));
 const fields=[...new Set(features.flatMap(f=>Object.keys(f.properties||{})))].sort();
 attributes[source]=Object.fromEntries(fields.map(field=>{const values=features.map(f=>f.properties?.[field]),present=values.filter(v=>v!==null&&v!==undefined&&(typeof v!=='string'||v.trim()!==''));return [field,{populated:present.length,missing:values.length-present.length,whitespace_only:values.filter(v=>typeof v==='string'&&v.length>0&&!v.trim()).length,types:freq(present.map(v=>typeof v)),distinct:new Set(present.map(v=>JSON.stringify(v))).size,...(new Set(present.map(v=>JSON.stringify(v))).size<=45?{values:freq(present)}:{}),...(present.every(v=>typeof v==='number')&&present.length?{min:Math.min(...present),max:Math.max(...present)}:{})}];}));
 sourceInventory.push({source,sha256:before[source],features:features.length,geometry_types:freq(features.map(f=>f.geometry?.type)),declared_crs:d.crs||null,fields,extent:xy.length?[Math.min(...xy.map(p=>p[0])),Math.min(...xy.map(p=>p[1])),Math.max(...xy.map(p=>p[0])),Math.max(...xy.map(p=>p[1]))]:null});
}
json('sources',sourceInventory);json('attributes',attributes);
// Also validate the display-export and routing-derived polygons. These are NOT
// admitted into the authoritative inventory or added to room-area totals.
const auxiliaryGeometry=[];
for(const source of sources.filter(s=>!ROOM_FLOORS.some(f=>s===`public${FLOOR_POLYGON_MAP[f]}`))){
 const data=read(source);for(const [i,f] of (data.features||[]).entries()){
  if(!['Polygon','MultiPolygon'].includes(f.geometry?.type))continue;
  const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  let area=null,issue=null;try{
   const coords=polygons.map(p=>p.map(r=>r.map(v=>index.projection(v.slice(0,2)))));
   const metric=reader.read({type:'MultiPolygon',coordinates:coords}),validity=new IsValidOp(metric);
   if(!validity.isValid())issue=validity.getValidationError()?.getMessage()||'Invalid topology';else area=metric.getArea();
  }catch(e){issue=e.message;}
  auxiliaryGeometry.push({source,row:i,name:roomName(f),level:f.properties?.level??null,geometry_type:f.geometry.type,parts:polygons.length,holes:polygons.reduce((s,p)=>s+p.length-1,0),area_m2:area,issue});
 }
}
csv('auxiliary-polygons',auxiliaryGeometry);
const overlaps=[],floorSummary=[],duplicates=[],nameRows=[],categories=[];
const areaOf=coords=>coords.length?reader.read({type:'MultiPolygon',coordinates:coords}).getArea():0;
const unionArea=rows=>rows.length?areaOf(union(...rows.map(r=>r.coordinates))):0;
for(const floor of ROOM_FLOORS){
 const rows=[...index.rows.values()].filter(r=>r.floor===floor),inv=inventory.filter(r=>r.floor_id===floor),features=datasets[floor].features;
 const names=new Map(),signatures=new Map();
 for(const r of inv){const n=norm(r.original_name);if(n){if(!names.has(n))names.set(n,[]);names.get(n).push(r);}if(!signatures.has(r.footprint_hash))signatures.set(r.footprint_hash,[]);signatures.get(r.footprint_hash).push(r);}
 for(const [name,list] of names)nameRows.push({floor,name_normalized:name,original_names:[...new Set(list.map(r=>r.original_name))],feature_count:list.length,area_sum_m2:list.reduce((a,r)=>a+(r.area_m2||0),0),distinct_footprints:new Set(list.map(r=>r.footprint_hash)).size,source_heights:[...new Set(list.map(r=>r.source_height))],source_bases:[...new Set(list.map(r=>r.source_base_height))],feature_ids:list.map(r=>r.feature_id)});
 for(const list of signatures.values())if(list.length>1)duplicates.push({floor,feature_ids:list.map(r=>r.feature_id),names:list.map(r=>r.original_name),count:list.length,area_each_m2:list[0].area_m2,heights:list.map(r=>r.source_height),bases:list.map(r=>r.source_base_height)});
 for(let a=0;a<rows.length;a++)for(let b=a+1;b<rows.length;b++){
  const x=rows[a],y=rows[b];if(x.bounds[0]>=y.bounds[2]||y.bounds[0]>=x.bounds[2]||x.bounds[1]>=y.bounds[3]||y.bounds[1]>=x.bounds[3])continue;
  try{const hit=intersectRows(x,y);if(hit)overlaps.push({floor,reference_id:x.key,candidate_id:y.key,reference_name:x.name,candidate_name:y.name,intersection_m2:hit.intersectionArea,reference_percent:hit.referencePercent,candidate_percent:hit.candidatePercent,includes_exact_floor:[x.name,y.name].some(n=>norm(n)==='floor'),exact_duplicate:footprintSignature(x.feature.geometry)===footprintSignature(y.feature.geometry)});}catch(e){overlaps.push({floor,reference_id:x.key,candidate_id:y.key,error:e.message});}
 }
 const background=rows.filter(r=>norm(r.name)==='floor'),nonBackground=rows.filter(r=>norm(r.name)!=='floor');
 const categoryMap=new Map(inv.map(r=>[r.feature_id,r.proposed_category]));
 const eligible=rows.filter(r=>!['floor_background','structure_non_occupiable','circulation_vertical_access'].includes(categoryMap.get(r.key)));
 const rawSource=read(`public${FLOOR_POLYGON_MAP[floor]}`).features;
 const ids=rawSource.map(f=>roomIdentifiers(f));
 const proportions=inv.filter(r=>r.source_shape_area>0&&r.area_m2>0).map(r=>r.area_m2/r.source_shape_area).sort((a,b)=>a-b);
 const floorPairs=overlaps.filter(r=>r.floor===floor&&!r.error);
 floorSummary.push({floor,total_features:inv.length,polygon_features:inv.filter(r=>r.geometry_type==='Polygon').length,multipolygon_features:inv.filter(r=>r.geometry_type==='MultiPolygon').length,unique_names_exact:new Set(inv.map(r=>String(r.original_name)).filter(Boolean)).size,unique_names_normalized:names.size,missing_names:inv.filter(r=>!norm(r.original_name)).length,missing_identifiers:ids.filter(v=>!v.length).length,duplicate_name_groups:[...names.values()].filter(v=>v.length>1).length,features_in_duplicate_name_groups:[...names.values()].filter(v=>v.length>1).reduce((n,v)=>n+v.length,0),structure_exact:inv.filter(r=>['structure','structures'].includes(norm(r.original_name))).length,floor_exact:background.length,named_other_features:inv.filter(r=>norm(r.original_name)&&!['structure','structures','floor'].includes(norm(r.original_name))&&r.proposed_category!=='circulation_vertical_access').length,stair_elevator_features:inv.filter(r=>['staircase','elevator'].includes(r.proposed_subcategory)).length,access_exit_features:inv.filter(r=>r.proposed_subcategory==='entrance_exit').length,collections_candidates:inv.filter(r=>r.proposed_category==='collections_bookshelves').length,manual_classification_features:inv.filter(r=>r.verification_status==='needs_manual_review').length,verified_function_features:0,unclassified_proposals:inv.filter(r=>r.proposed_category==='unclassified').length,valid_features:rows.length,geometry_issues:index.issues.filter(r=>r.floor===floor),holes:inv.reduce((a,r)=>a+r.hole_count,0),multipart_features:inv.filter(r=>r.part_count>1).length,exact_duplicate_groups:duplicates.filter(r=>r.floor===floor).length,positive_overlap_pairs:floorPairs.length,pairs_over_one_m2:floorPairs.filter(r=>r.intersection_m2>1).length,pairs_including_floor:floorPairs.filter(r=>r.includes_exact_floor).length,all_features_area_sum_m2:rows.reduce((a,r)=>a+r.area,0),all_features_union_m2:unionArea(rows),floor_surface_sum_m2:background.reduce((a,r)=>a+r.area,0),floor_surface_union_m2:unionArea(background),non_floor_area_sum_m2:nonBackground.reduce((a,r)=>a+r.area,0),non_floor_union_m2:unionArea(nonBackground),nonstructural_nonaccess_candidate_sum_m2:eligible.reduce((a,r)=>a+r.area,0),nonstructural_nonaccess_candidate_union_m2:unionArea(eligible),source_shape_area_ratio_median:proportions[Math.floor(proportions.length/2)],source_shape_area_ratio_range:[proportions[0],proportions.at(-1)]});
 console.log('Audited F'+floor,inv.length,'features,',floorPairs.length,'positive overlap pairs');
}
const combined=read(`public${FLOOR_POLYGON_MAP.all}`),crosswalk=[];
for(const [i,f] of combined.features.entries()){
 const floor=correspondenceFloor(f),exact=datasets[floor]?.features.filter(g=>footprintSignature(g.geometry)===footprintSignature(f.geometry))||[],precision=datasets[floor]?.features.filter(g=>routeFootprintSignature(g.geometry)===routeFootprintSignature(f.geometry))||[];
 crosswalk.push({combined_row:i,floor,name:roomName(f),source_ids:roomIdentifiers(f),exact_matches:exact.map(g=>g.properties.__roomSearchKey),precision_matches:precision.map(g=>g.properties.__roomSearchKey),status:precision.length===1?'unique_at_export_precision':precision.length>1?'ambiguous':'unmatched'});
}
for(const category of [...new Set(inventory.map(r=>r.proposed_category))].sort()){
 const list=inventory.filter(r=>r.proposed_category===category);
 categories.push({category,candidate_features:list.length,candidate_area_sum_m2:list.reduce((a,r)=>a+(r.area_m2||0),0),confidence:freq(list.map(r=>r.confidence)),status:freq(list.map(r=>r.verification_status)),names:[...new Set(list.map(r=>r.original_name))]});
}
csv('floor-inventory',floorSummary);json('floor-inventory',floorSummary);csv('name-inventory',nameRows);json('duplicate-footprints',duplicates);csv('same-floor-overlaps',overlaps);csv('classification-assessment',categories);json('classification-assessment',categories);csv('combined-crosswalk',crosswalk);
const matched=new Set(crosswalk.filter(r=>r.precision_matches.length===1).flatMap(r=>r.precision_matches));
json('summary',{date:'2026-10-27',source_count:sources.length,authoritative_features:inventory.length,existing_verified_functions:0,origin:index.origin,extent:index.extent,projection:'Local spherical Lambert azimuthal equal-area; R=6371008.8 m',area_epsilon_m2:OVERLAP_AREA_EPSILON,geometry_issues:index.issues,combined_count:combined.features.length,combined_status:freq(crosswalk.map(r=>r.status)),combined_exact:freq(crosswalk.map(r=>r.exact_matches.length===1?'unique':r.exact_matches.length>1?'ambiguous':'none')),authoritative_without_unique_combined_match:inventory.filter(r=>!matched.has(r.feature_id)).map(r=>({key:r.feature_id,floor:r.floor_id,name:r.original_name})),combined_per_floor:freq(crosswalk.map(r=>r.floor)),overlap_errors:overlaps.filter(r=>r.error),total_positive_pairs:overlaps.filter(r=>!r.error).length,total_duplicate_groups:duplicates.length,category_count:categories.length});
const after=hashes();assert.deepEqual(after,before,'Audit must not modify production sources/data');
json('integrity',{protected_files:protectedPaths.length,changed:[],sha256:before});
assert.equal(floorSummary.reduce((s,f)=>s+f.total_features,0),inventory.length);assert.equal(categories.reduce((s,c)=>s+c.candidate_features,0),inventory.length);
const sumInventory=inventory.reduce((s,r)=>s+(r.area_m2||0),0),sumCategories=categories.reduce((s,r)=>s+r.candidate_area_sum_m2,0);
assert(Math.abs(sumInventory-sumCategories)<1e-6);
json('verification',{authoritative_inventory_rows:inventory.length,unique_keys:new Set(inventory.map(r=>r.feature_id)).size,auxiliary_polygon_rows:auxiliaryGeometry.length,geometry_issues:index.issues.length+auxiliaryGeometry.filter(r=>r.issue).length,manual_review_rows:inventory.filter(r=>r.verification_status==='needs_manual_review').length,inventory_and_category_counts_agree:true,inventory_and_category_area_sums_agree:true,protected_files_unchanged:protectedPaths.length,changed_production_files:[]});
console.log('Audit complete. Inventory:',inventory.length,'GeoJSON sources:',sources.length,'Production files unchanged:',protectedPaths.length);
