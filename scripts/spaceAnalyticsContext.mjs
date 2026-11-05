// Node-only source registry. Does not participate in the application bundle.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {FLOOR_POLYGON_MAP,ROOM_FLOORS,buildFloorCatalog,roomIdentifiers} from '../src/utils/roomCatalog.js';
import {footprintSignature,correspondenceFloor} from '../src/utils/roomCorrespondenceIdentity.js';
import {routeFootprintSignature} from '../src/utils/routeLabelIdentity.js';
export const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
export function loadSpaceAnalyticsContext({combinedBytes: suppliedCombinedBytes}={}){
 const datasets={},sources=[],features=[];
 for(const floor of ROOM_FLOORS){
  const source=FLOOR_POLYGON_MAP[floor],bytes=fs.readFileSync(`public${source}`),hash=sha256(bytes);
  const catalog=buildFloorCatalog(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),floor);
  datasets[floor]=catalog.data;sources.push({floor_id:floor,source_dataset:source,source_sha256:hash});
  for(const feature of catalog.data.features){
   const ids=roomIdentifiers(feature),exportId=['OBJECTID','FID','FID_','feature.id','room_id','id','number'].map(field=>ids.find(i=>i.field===field)).find(Boolean)||null;
   features.push({feature_id:feature.properties.__roomSearchKey,floor_id:floor,source_dataset:source,source_export_id:exportId,source_sha256:hash,footprint_hash:sha256(footprintSignature(feature.geometry)||''),original_name:feature.properties.name??null,feature});
  }
 }
 const combinedBytes=suppliedCombinedBytes||fs.readFileSync(`public${FLOOR_POLYGON_MAP.all}`),combined=JSON.parse(combinedBytes.toString('utf8').replace(/^\uFEFF/,'')),combinedHash=sha256(combinedBytes);
 const index=new Map();for(const f of features){const k=JSON.stringify([f.floor_id,routeFootprintSignature(f.feature.geometry)]);if(!index.has(k))index.set(k,[]);index.get(k).push(f.feature_id);}
 const display_links=combined.features.map(feature=>{
  const floor=correspondenceFloor(feature),ids=roomIdentifiers(feature),id=ids.find(i=>i.field==='OBJECTID')||ids[0];
  if(!id)throw new Error('Combined display identity requires source ID');
  const matches=index.get(JSON.stringify([floor,routeFootprintSignature(feature.geometry)]))||[];
  return {display_id:`${FLOOR_POLYGON_MAP.all}#F${floor}:${id.field}:${id.value}`,source_dataset:FLOOR_POLYGON_MAP.all,source_sha256:combinedHash,floor_id:floor,match_status:matches.length===1?'matched':matches.length?'ambiguous':'unmatched',authoritative_feature_id:matches.length===1?matches[0]:null,candidate_feature_ids:matches,resolution:matches.length===1?'full_footprint_at_export_precision':'unresolved'};
 });
 return {dataset_version:`rooms-sha256:${sha256(JSON.stringify({sources,combined_sha256:combinedHash}))}`,sources,features,datasets,display_links};
}
