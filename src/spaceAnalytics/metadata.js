import {SCHEMA_VERSION,GEOMETRY_ROLES,SPACE_CATEGORIES,SUBCATEGORIES,CLASSIFICATION_FIELDS,RELATIONSHIP_TYPES} from './schema';
import {relationshipId} from './relationships';
const text=v=>typeof v==='string'&&v.trim().length>0;
const isoDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const equal=(a,b)=>canonical(a)===canonical(b);
const fields=(value,keys)=>Object.fromEntries(keys.map(k=>[k,value[k]]));
const membershipFields=['floor_ids','feature_ids','cross_floor_evidence'];

export function validateMetadata(metadata,context){
 try{return validateMetadataRecords(metadata,context);}catch(error){return {valid:false,errors:[{code:'malformed_record',message:`Invalid metadata structure: ${error.message}`}],warnings:[]};}
}
function validateMetadataRecords(metadata,context){
 const errors=[],warnings=[];const fail=(code,id,message)=>errors.push({code,id,message});
 if(!metadata||typeof metadata!=='object')return {valid:false,errors:[{code:'schema',message:'Metadata object required'}],warnings};
 if(metadata.schema_version!==SCHEMA_VERSION)fail('schema',null,'Unsupported metadata schema');
 if(metadata.dataset_version!==context.dataset_version)fail('dataset_version',null,'Source-version mismatch');
 if(!Number.isInteger(metadata.revision)||metadata.revision<0)fail('revision',null,'Nonnegative integer revision required');
 for(const key of ['features','sources','logical_spaces','approvals','approved_relationships','proposed_relationships','membership_proposals','display_links','history'])if(!Array.isArray(metadata[key]))fail('schema',key,'Array required');
 if(errors.some(e=>e.code==='schema'))return {valid:false,errors,warnings};
 const originals=new Map(context.features.map(f=>[f.feature_id,f]));
 const approvals=new Map();for(const a of metadata.approvals){
  if(!a||!text(a.approval_id)||approvals.has(a.approval_id)){fail('approval_id',a?.approval_id,'Missing/duplicate approval ID');continue;}
  if(!['approve_classification','approve_membership','approve_parent'].includes(a.decision)||!text(a.target_id)||!text(a.reviewed_by)||!isoDate(a.reviewed_at)||!text(a.evidence)||!a.approved_values||typeof a.approved_values!=='object')fail('approval_evidence',a.approval_id,'Explicit decision, target, reviewer, ISO timestamp, evidence and values required');
  approvals.set(a.approval_id,a);
 }
 function approvalMatches(id,decision,target,values){const a=approvals.get(id);return !!a&&a.decision===decision&&a.target_id===target&&equal(a.approved_values,values);}
 const sourceMap=new Map();for(const source of metadata.sources){if(sourceMap.has(source.source_dataset))fail('duplicate_source',source.source_dataset,'Duplicate source');sourceMap.set(source.source_dataset,source);}
 for(const original of context.sources){const row=sourceMap.get(original.source_dataset);if(!equal(row,original))fail('source_hash',original.source_dataset,'Missing/stale source manifest');}
 if(sourceMap.size!==context.sources.length)fail('source_hash',null,'Unexpected source manifest entries');
 const byId=new Map();
 const required=['feature_id','floor_id','source_dataset','source_export_id','dataset_version','source_sha256','footprint_hash','original_name','geometry_role','proposed_geometry_role','space_category','space_subcategory','secondary_tags','logical_space_id','component_of','parent_space_id','relationship_status','classification_status','classification_source','classification_evidence','verification_status','verified_by','last_verified','assignable','include_in_room_count','include_in_area_total'];
 for(const f of metadata.features){
  if(!f||typeof f!=='object'){fail('schema',null,'Feature record required');continue;}
  const id=f.feature_id;for(const k of required)if(!Object.hasOwn(f,k))fail('required_field',id,`Missing ${k}`);
  if(byId.has(id))fail('duplicate_metadata',id,'Duplicate feature metadata');byId.set(id,f);
  const original=originals.get(id);if(!original){fail('unknown_feature',id,'Not an authoritative feature');continue;}
  for(const key of ['floor_id','source_dataset','source_export_id','source_sha256','footprint_hash','original_name'])if(!equal(f[key],original[key]))fail('source_identity',id,`Source mismatch: ${key}`);
  if(f.dataset_version!==context.dataset_version)fail('dataset_version',id,'Stale dataset version');
  for(const k of ['geometry_role','proposed_geometry_role'])if(!GEOMETRY_ROLES.includes(f[k]))fail('geometry_role',id,`Invalid ${k}`);
  for(const [category,subcategory] of [['space_category','space_subcategory'],['proposed_space_category','proposed_space_subcategory']]){
   if(!SPACE_CATEGORIES.includes(f[category]))fail('category',id,`Invalid ${category}`);
   else if(f[subcategory]!==null&&!SUBCATEGORIES[f[category]].includes(f[subcategory]))fail('subcategory',id,`Invalid ${subcategory}`);
  }
  for(const k of ['secondary_tags','proposed_secondary_tags','geometry_role_alternatives']){
   if(!Array.isArray(f[k])||f[k].some(v=>!text(v))||new Set(f[k]).size!==f[k].length)fail('tags',id,`Invalid ${k}`);
  }
  if(f.geometry_role_alternatives?.some(r=>!GEOMETRY_ROLES.includes(r)))fail('geometry_role',id,'Invalid alternative role');
  for(const k of ['assignable','include_in_room_count','include_in_area_total','proposed_assignable','proposed_include_in_room_count','proposed_include_in_area_total'])if(f[k]!==null&&typeof f[k]!=='boolean')fail('boolean',id,`Invalid ${k}`);
  if(!['high','medium','low','none'].includes(f.proposal_confidence))fail('confidence',id,'Invalid proposal confidence');
  if(!text(f.classification_source)||!text(f.classification_evidence))fail('classification_evidence',id,'Classification evidence required');
  if(!['unclassified','proposed','approved'].includes(f.classification_status)||!['unverified','verified'].includes(f.verification_status)||!['unreviewed','approved'].includes(f.relationship_status))fail('status',id,'Invalid status');
  const hasApprovedValues=f.geometry_role!=='unknown'||f.space_category!=='unclassified'||f.space_subcategory!==null||f.secondary_tags?.length||[f.assignable,f.include_in_room_count,f.include_in_area_total].some(v=>v!==null);
  if(f.classification_status==='approved'||f.verification_status==='verified'||hasApprovedValues){
   if(f.classification_status!=='approved'||f.verification_status!=='verified'||!approvalMatches(f.approval_id,'approve_classification',id,fields(f,CLASSIFICATION_FIELDS)))fail('unapproved_classification',id,'Approved values must exactly match an explicit approval');
   const a=approvals.get(f.approval_id);if(f.verified_by!==a?.reviewed_by||f.last_verified!==a?.reviewed_at)fail('verification_provenance',id,'Reviewer/date must match approval');
  }else if(f.verified_by!==null||f.last_verified!==null||f.approval_id!==null)fail('verification_provenance',id,'Unverified proposals cannot carry approval dates/IDs');
  if((['structural_component','floor_background','stair_component','elevator_component'].includes(f.geometry_role)||f.space_category==='structure_non_occupiable')&&f.include_in_room_count===true)fail('room_count_role',id,'Non-room component cannot be counted as a physical room');
  if(f.space_category==='structure_non_occupiable'&&f.assignable===true)fail('assignable_role',id,'Non-occupiable structure cannot be assignable');
  if(f.proposed_space_subcategory==='semi_private_study_booths'&&f.proposed_geometry_role==='structural_component'){
   if(f.proposed_include_in_room_count!==false||f.proposed_enclosed_room_count!==0||f.proposed_include_in_area_total!==false)fail('partition_room_count',id,'Partition geometry is not an enclosed room or allocated zone area');
   if(f.functional_zone_footprint_id===null&&f.allocated_floor_area_m2!==null)fail('partition_area',id,'A verified functional-zone footprint is required before allocated area');
   if(f.study_station_count!==null&&(!Number.isInteger(f.study_station_count)||f.study_station_count<0))fail('study_station_count',id,'Station count must be unknown or a nonnegative integer');
  }
 }
 for(const id of originals.keys())if(!byId.has(id))fail('missing_metadata',id,'Complete authoritative inventory required');
 const spaces=new Map(),membership=new Map();
 for(const s of metadata.logical_spaces){
  if(!s||!text(s.space_id)||spaces.has(s.space_id)){fail('logical_space_id',s?.space_id,'Missing/duplicate logical-space ID');continue;}
  spaces.set(s.space_id,s);
  if(!Array.isArray(s.feature_ids)||!s.feature_ids.length||new Set(s.feature_ids).size!==s.feature_ids.length){fail('duplicate_membership',s.space_id,'Nonempty unique feature membership required');continue;}
  if(!Array.isArray(s.floor_ids)||!s.floor_ids.length||new Set(s.floor_ids).size!==s.floor_ids.length)fail('space_floor',s.space_id,'Unique floor list required');
  if(s.status!=='approved'||!approvalMatches(s.approval_id,'approve_membership',s.space_id,fields(s,membershipFields)))fail('membership_approval',s.space_id,'Membership requires its own explicit approval');
  const floors=new Set();for(const id of s.feature_ids){
   if(!byId.has(id)){fail('missing_target',id,'Unknown membership feature');continue;}floors.add(byId.get(id).floor_id);
   if(membership.has(id))fail('duplicate_membership',id,'Feature belongs to more than one logical space');membership.set(id,s.space_id);
  }
  if(!equal([...floors].sort(),[...(s.floor_ids||[])].sort()))fail('space_floor',s.space_id,'Space floor list must match its members');
  if(floors.size>1&&!text(s.cross_floor_evidence))fail('cross_floor_membership',s.space_id,'Multi-floor membership needs explicit support');
 }
 const parents=new Map(),edgeIds=new Set();
 for(const r of metadata.approved_relationships){
  if(!text(r.relationship_id)||edgeIds.has(r.relationship_id))fail('relationship_id',r.relationship_id,'Missing/duplicate approved relationship ID');edgeIds.add(r.relationship_id);
  if(r.type!=='functional_parent'||r.status!=='approved')fail('relationship_status',r.relationship_id,'Only explicitly approved functional parent edges allowed');
  const parent=spaces.get(r.parent_space_id),child=spaces.get(r.child_space_id);
  if(!parent||!child)fail('missing_target',r.relationship_id,'Unknown parent/child logical space');
  if(r.parent_space_id===r.child_space_id)fail('self_parent',r.relationship_id,'Space cannot parent itself');
  if(parents.has(r.child_space_id))fail('contradictory_parent',r.child_space_id,'Only one approved functional parent per child');parents.set(r.child_space_id,r.parent_space_id);
  if(!approvalMatches(r.approval_id,'approve_parent',r.child_space_id,{parent_space_id:r.parent_space_id,cross_floor_evidence:r.cross_floor_evidence}))fail('parent_approval',r.relationship_id,'Functional hierarchy requires explicit matching approval');
  if(parent&&child&&!parent.floor_ids.some(f=>child.floor_ids.includes(f))&&!text(r.cross_floor_evidence))fail('cross_floor_parent',r.relationship_id,'Cross-floor functional parent needs explicit support');
  if(parent?.feature_ids.some(id=>['floor_background','structural_component'].includes(byId.get(id)?.geometry_role)||['floor_background','structure_non_occupiable'].includes(byId.get(id)?.proposed_space_category)&&byId.get(id)?.verification_status!=='verified'))fail('background_parent',r.relationship_id,'Background/structure containment is not functional parentage');
 }
 for(const id of parents.keys()){
  const seen=new Set();let next=id;while(parents.has(next)){if(seen.has(next)){fail('parent_cycle',id,'Cyclic functional hierarchy');break;}seen.add(next);next=parents.get(next);}
 }
 for(const f of byId.values()){
  const member=membership.get(f.feature_id)||null;
  if(f.logical_space_id!==member||f.component_of!==member)fail('membership_consistency',f.feature_id,'Membership fields must mirror approved space membership');
  const parent=member?parents.get(member)||null:null;
  if(f.parent_space_id!==parent)fail('parent_consistency',f.feature_id,'parent_space_id requires an approved functional edge');
  if(f.relationship_status!==(member?'approved':'unreviewed'))fail('relationship_status',f.feature_id,'Relationship status must match membership');
 }
 const proposedIds=new Set();for(const r of metadata.proposed_relationships){
  if((r.proposed_parent_id||r.proposed_child_id)&&(![r.feature_a_id,r.feature_b_id].includes(r.proposed_parent_id)||![r.feature_a_id,r.feature_b_id].includes(r.proposed_child_id)||r.proposed_parent_id===r.proposed_child_id))fail('proposal_targets',r.relationship_id,'Proposed parent and child must be distinct members of this geometric pair');
  if(!byId.has(r.feature_a_id)||!byId.has(r.feature_b_id)||r.proposed_parent_id&&!byId.has(r.proposed_parent_id)||r.proposed_child_id&&!byId.has(r.proposed_child_id))fail('missing_target',r.relationship_id,'Unknown proposed relationship feature');
  if(r.feature_a_id===r.feature_b_id)fail('self_parent',r.relationship_id,'Self pair is invalid');
  if(!RELATIONSHIP_TYPES.includes(r.relationship_type)||r.review_status!=='pending')fail('proposal_status',r.relationship_id,'Proposal must remain pending with a valid geometric type');
  if(r.relationship_id!==relationshipId(r.floor_id,r.feature_a_id,r.feature_b_id)||proposedIds.has(r.relationship_id))fail('relationship_id',r.relationship_id,'Invalid/duplicate canonical pair ID');proposedIds.add(r.relationship_id);
  if(byId.get(r.feature_a_id)?.floor_id!==r.floor_id||byId.get(r.feature_b_id)?.floor_id!==r.floor_id)fail('cross_floor_proposal',r.relationship_id,'Same-floor geometric proposal has mismatched floors');
 }
 for(const p of metadata.membership_proposals){
  if(p.review_status!=='pending'||p.logical_space_id!==null)fail('proposal_status',p.proposal_id,'Grouping proposals are not logical spaces');
  if(!Array.isArray(p.feature_ids)||new Set(p.feature_ids).size!==p.feature_ids.length||p.feature_ids.some(id=>!byId.has(id)))fail('missing_target',p.proposal_id,'Invalid grouping proposal members');
 }
 for(const a of approvals.values()){
  if(a.decision==='approve_classification'&&!byId.has(a.target_id)||['approve_membership','approve_parent'].includes(a.decision)&&!spaces.has(a.target_id))fail('missing_target',a.approval_id,'Unknown approval target');
 }
 const links=new Map((context.display_links||[]).map(l=>[l.display_id,l])),seenLinks=new Set();
 for(const link of metadata.display_links){
  if(seenLinks.has(link.display_id)||!equal(link,links.get(link.display_id)))fail('display_mapping',link.display_id,'F-ALL mapping differs from verified source geometry crosswalk');seenLinks.add(link.display_id);
  if(link.match_status!=='matched')warnings.push({code:'unresolved_display_mapping',id:link.display_id,message:'No metadata may be activated for this unresolved F-ALL feature'});
 }
 if(seenLinks.size!==links.size)fail('display_mapping',null,'Missing F-ALL mapping rows');
 return {valid:errors.length===0,errors,warnings};
}

function requireValid(metadata,context){const result=validateMetadata(metadata,context);if(!result.valid)throw new Error(result.errors.map(e=>`${e.code}: ${e.message}`).join('; '));return result;}

// Atomic, non-mutating import. Owner-supplied approval records are trust inputs;
// this validates evidence and exact decisions, not the reviewer's legal identity.
export function applyApprovalBatch(metadata,batch,context){
 requireValid(metadata,context);
 if(batch.schema_version!=='morris-space-approvals/v1'||batch.dataset_version!==metadata.dataset_version||batch.base_revision!==metadata.revision||!Array.isArray(batch.decisions)||!batch.decisions.length)throw new Error('Invalid approval schema, dataset version, base revision or empty batch');
 const next=structuredClone(metadata),byId=new Map(next.features.map(f=>[f.feature_id,f])),ids=new Set(next.approvals.map(a=>a.approval_id)),targets=new Set();
 for(const event of batch.decisions){
  if(!text(event.approval_id)||ids.has(event.approval_id)||!text(event.reviewed_by)||!isoDate(event.reviewed_at)||!text(event.evidence)||!event.approved_values)throw new Error('Explicit unique approval ID, reviewer, date, evidence and approved values required');ids.add(event.approval_id);
  const targetKey=`${event.decision}:${event.target_id}`;if(targets.has(targetKey))throw new Error('Conflicting decisions for the same target');targets.add(targetKey);
  const values=event.approved_values;
  if(event.decision==='approve_classification'){
   if(!byId.has(event.target_id)||!equal(Object.keys(values).sort(),[...CLASSIFICATION_FIELDS].sort()))throw new Error('Unknown feature or invalid classification approval fields');
   Object.assign(byId.get(event.target_id),structuredClone(values),{classification_status:'approved',verification_status:'verified',verified_by:event.reviewed_by,last_verified:event.reviewed_at,approval_id:event.approval_id,classification_source:`Owner approval ${event.approval_id}`,classification_evidence:event.evidence});
  }else if(event.decision==='approve_membership'){
   if(!text(event.target_id)||next.logical_spaces.some(s=>s.space_id===event.target_id)||!equal(Object.keys(values).sort(),[...membershipFields].sort()))throw new Error('New owner-provided space ID and explicit membership fields required');
   if(!Array.isArray(values.feature_ids)||values.feature_ids.some(id=>!byId.has(id)||byId.get(id).logical_space_id))throw new Error('Unknown or already assigned membership feature');
   next.logical_spaces.push({space_id:event.target_id,...structuredClone(values),status:'approved',approval_id:event.approval_id});
   for(const id of values.feature_ids)Object.assign(byId.get(id),{logical_space_id:event.target_id,component_of:event.target_id,relationship_status:'approved'});
  }else if(event.decision==='approve_parent'){
   if(!equal(Object.keys(values).sort(),['cross_floor_evidence','parent_space_id']))throw new Error('Explicit parent fields required');
   if(next.approved_relationships.some(r=>r.child_space_id===event.target_id))throw new Error('Existing functional parent must be reviewed/reverted before replacement');
   next.approved_relationships.push({relationship_id:`functional-parent-v1:${JSON.stringify([event.target_id,values.parent_space_id])}`,type:'functional_parent',child_space_id:event.target_id,...structuredClone(values),status:'approved',approval_id:event.approval_id});
   for(const f of next.features)if(f.logical_space_id===event.target_id)f.parent_space_id=values.parent_space_id;
  }else throw new Error('Unsupported approval decision');
  next.approvals.push(structuredClone(event));
 }
 next.previous_revision=metadata.revision;next.revision++;next.history.push({action:'import_approvals',revision:next.revision,base_revision:metadata.revision,approval_ids:batch.decisions.map(d=>d.approval_id)});
 requireValid(next,context);return next;
}

export function restoreMetadataSnapshot(current,snapshot,context,review){
 requireValid(current,context);requireValid(snapshot,context);
 if(snapshot.revision>=current.revision||!text(review?.reviewed_by)||!isoDate(review?.reviewed_at)||!text(review?.evidence))throw new Error('An older valid snapshot and explicit restore review are required');
 const next=structuredClone(snapshot);next.previous_revision=current.revision;next.revision=current.revision+1;
 next.history=[...structuredClone(current.history),{action:'restore_snapshot',revision:next.revision,restored_revision:snapshot.revision,reviewed_by:review.reviewed_by,reviewed_at:review.reviewed_at,evidence:review.evidence}];requireValid(next,context);return next;
}
