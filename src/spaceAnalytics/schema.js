// Standalone Stage 2A model. This module is not imported by application rendering.
export const SCHEMA_VERSION = 'morris-space-metadata/v1';
export const GEOMETRY_ROLES = Object.freeze(['room_boundary','functional_zone','nested_compartment','service_fixture','furniture_or_equipment','structural_component','stair_component','elevator_component','circulation_zone','floor_background','unknown']);
export const SPACE_CATEGORIES = Object.freeze(['study_learning','open_reading_study','research_cultural_resources','auditorium_events','library_services','offices_administration','collections_bookshelves','restroom_facilities','circulation_vertical_access','building_support','structure_non_occupiable','floor_background','unclassified']);
export const SUBCATEGORIES = Object.freeze({
 study_learning:['classroom','group_study','family_study','laboratory','instructional_lab','computer_lab','music_studio','semi_private_study_booths'],
 open_reading_study:['candidate_open_study','open_reading','open_study','collaborative_study'],
 research_cultural_resources:['faculty_research','faculty_writing','geospatial_resources','special_collections_reading','cultural_heritage','research_lab'],
 auditorium_events:['auditorium','conference','event_space'],
 library_services:['service_desk','research_information','access_services','student_support','mixed_service_office'],
 offices_administration:['administrative_office','staff_office','publisher_office'],
 collections_bookshelves:['book_collection','book_stacks','journal_collection','folio_collection','archives','special_format_materials','book_storage'],
 restroom_facilities:['restroom'],circulation_vertical_access:['staircase','elevator','ramp','entrance_exit','corridor'],
 building_support:['storage','mechanical','utilities','print_equipment','food_service','wellbeing'],
 structure_non_occupiable:['modeled_structure','stair_base'],floor_background:['unresolved_floor_surface'],unclassified:[],
});
export const RELATIONSHIP_TYPES = Object.freeze(['contains','within','near_contains','partial_overlap','near_coincident','disjoint','boundary_touch']);
export const CLASSIFICATION_FIELDS = Object.freeze(['geometry_role','space_category','space_subcategory','secondary_tags','assignable','include_in_room_count','include_in_area_total']);
export const nullableBoolean = {type:['boolean','null']};
export const METADATA_JSON_SCHEMA = {
 $schema:'https://json-schema.org/draft/2020-12/schema',title:'Morris Library isolated space metadata',type:'object',
 required:['schema_version','dataset_version','revision','sources','features','logical_spaces','proposed_relationships','approved_relationships','membership_proposals','approvals','history','display_links'],
 properties:{schema_version:{const:SCHEMA_VERSION},dataset_version:{type:'string',minLength:1},revision:{type:'integer',minimum:0},
  sources:{type:'array',items:{type:'object',required:['floor_id','source_dataset','source_sha256'],properties:{floor_id:{type:'integer',minimum:0,maximum:7},source_dataset:{type:'string'},source_sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}}}},
  features:{type:'array',items:{$ref:'#/$defs/feature'}},logical_spaces:{type:'array',items:{type:'object'}},
  proposed_relationships:{type:'array',items:{type:'object'}},approved_relationships:{type:'array',items:{type:'object'}},membership_proposals:{type:'array',items:{type:'object'}},approvals:{type:'array',items:{type:'object'}},history:{type:'array',items:{type:'object'}},display_links:{type:'array',items:{type:'object'}}},
 $defs:{feature:{type:'object',required:['feature_id','floor_id','source_dataset','source_export_id','dataset_version','source_sha256','footprint_hash','original_name','geometry_role','proposed_geometry_role','space_category','space_subcategory','secondary_tags','logical_space_id','component_of','parent_space_id','relationship_status','classification_status','verification_status','verified_by','last_verified','assignable','include_in_room_count','include_in_area_total'],properties:{
  feature_id:{type:'string',minLength:1},floor_id:{type:'integer',minimum:0,maximum:7},source_dataset:{type:'string'},source_export_id:{type:['object','null']},dataset_version:{type:'string'},source_sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},footprint_hash:{type:'string',pattern:'^[a-f0-9]{64}$'},original_name:{type:['string','null']},
  geometry_role:{enum:GEOMETRY_ROLES},proposed_geometry_role:{enum:GEOMETRY_ROLES},space_category:{enum:SPACE_CATEGORIES},proposed_space_category:{enum:SPACE_CATEGORIES},space_subcategory:{type:['string','null']},secondary_tags:{type:'array',items:{type:'string'},uniqueItems:true},
  logical_space_id:{type:['string','null']},component_of:{type:['string','null']},parent_space_id:{type:['string','null']},relationship_status:{enum:['unreviewed','approved']},classification_status:{enum:['unclassified','proposed','approved']},verification_status:{enum:['unverified','verified']},verified_by:{type:['string','null']},last_verified:{type:['string','null']},assignable:nullableBoolean,include_in_room_count:nullableBoolean,include_in_area_total:nullableBoolean,
 }}}
};
