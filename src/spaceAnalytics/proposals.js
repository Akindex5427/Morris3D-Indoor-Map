import {normalizeSearchText, roomName} from '../utils/roomCatalog';
import {exactNameProposals, PROPOSAL_RULE_VERSION} from './proposalRules';
export {PROPOSAL_RULE_VERSION};

export function proposeClassification(feature) {
 const name=normalizeSearchText(roomName(feature));
 let rule=exactNameProposals.get(name);
 // Bounded room-number variants; no fallback that assigns unmatched spaces to collections.
 if(!rule && /^(?:math )?classroom \d+[a-z]?$/.test(name)) rule={category:'study_learning',subcategory:'classroom',confidence:'high',evidence:'Explicit classroom term and room-number pattern'};
 if(!rule && /^(group|family) study \d+[a-z]?$/.test(name)) rule={category:'study_learning',subcategory:name.startsWith('family')?'family_study':'group_study',confidence:'high',evidence:'Explicit study type and room-number pattern'};
 if(!rule && /^(?:all gender |male |female )?rest ?rooms?(?: male| female| all gender)?$/.test(name)) rule={category:'restroom_facilities',subcategory:'restroom',confidence:'high',evidence:'Controlled restroom name variant'};
 rule=rule||{category:'unclassified',subcategory:null,confidence:'none',evidence:name?'No controlled classification evidence':'Missing source name'};
 let role='unknown', alternatives=[];
 if(rule.category==='structure_non_occupiable')role='structural_component';
 else if(rule.category==='floor_background')role='floor_background';
 else if(rule.subcategory==='staircase')role='stair_component';
 else if(rule.subcategory==='elevator')role='elevator_component';
 else if(rule.category==='circulation_vertical_access')role='circulation_zone';
 else if(rule.subcategory==='print_equipment')role='furniture_or_equipment';
 else if(rule.subcategory==='service_desk'){role='unknown';alternatives=['nested_compartment','service_fixture'];}
 else if(rule.category==='collections_bookshelves'){role='functional_zone';alternatives=['room_boundary','furniture_or_equipment'];}
 else if(rule.category==='open_reading_study'||rule.subcategory==='geospatial_resources'){role='functional_zone';alternatives=['room_boundary','furniture_or_equipment'];}
 else if(rule.category!=='unclassified'){role='room_boundary';alternatives=['functional_zone','nested_compartment'];}
 const tags=rule.subcategory==='mixed_service_office'?['mixed_use','office','public_service']:rule.subcategory==='student_support'?['student_facing']:[];
 return {rule_version:PROPOSAL_RULE_VERSION,proposed_space_category:rule.category,proposed_space_subcategory:rule.subcategory||null,proposed_geometry_role:role,geometry_role_alternatives:alternatives,proposed_secondary_tags:tags,proposal_confidence:rule.confidence,classification_source:'Stage 1 audit / supplied owner guidance / controlled name proposal',classification_evidence:rule.evidence,
  proposal_needs_review:rule.auditStatus==='needs_manual_review'||rule.category==='unclassified'||alternatives.length>0,
  proposed_assignable:rule.category==='structure_non_occupiable'?false:null,
  proposed_include_in_room_count:['structure_non_occupiable','floor_background','circulation_vertical_access'].includes(rule.category)?false:null,
  proposed_include_in_area_total:['structure_non_occupiable','floor_background'].includes(rule.category)?false:null};
}

export function createMetadataSeed(context) {
 const features=context.features.map(source=>({
  feature_id:source.feature_id,floor_id:source.floor_id,source_dataset:source.source_dataset,source_export_id:source.source_export_id,
  dataset_version:context.dataset_version,source_sha256:source.source_sha256,footprint_hash:source.footprint_hash,original_name:source.original_name,
  geometry_role:'unknown',space_category:'unclassified',space_subcategory:null,secondary_tags:[],
  logical_space_id:null,component_of:null,parent_space_id:null,relationship_status:'unreviewed',classification_status:'proposed',verification_status:'unverified',verified_by:null,last_verified:null,approval_id:null,
  assignable:null,include_in_room_count:null,include_in_area_total:null,...proposeClassification(source.feature),
 }));
 return {schema_version:'morris-space-metadata/v1',dataset_version:context.dataset_version,revision:0,previous_revision:null,sources:structuredClone(context.sources),features,logical_spaces:[],proposed_relationships:[],approved_relationships:[],membership_proposals:[],approvals:[],history:[],display_links:structuredClone(context.display_links||[])};
}
