// Read-only geometry diagnosis. Writes reports only; never updates source data.
import fs from 'node:fs';
import crypto from 'node:crypto';
import DiscreteHausdorffDistance from 'jsts/org/locationtech/jts/algorithm/distance/DiscreteHausdorffDistance';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp';
import {buildFloorCatalog} from '../src/utils/roomCatalog';
import {prepareSpatialDataset,compareMetricRows} from '../src/spaceAnalytics/relationships';
import {routeFootprintSignature} from '../src/utils/routeLabelIdentity';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sources=['public/rooms-level-6-WGS.geojson','public/rooms-all-WGS-v6.geojson'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before=Object.fromEntries(sources.map(p=>[p,hash(p)]));
const floor=buildFloorCatalog(read(sources[0]),6).data.features;
const display=read(sources[1]).features.filter(f=>Number(f.properties.level)===6).map(f=>({...f,properties:{...f.properties,__roomSearchKey:`display:${f.properties.OBJECTID}`}}));
const index=prepareSpatialDataset({6:{type:'FeatureCollection',features:[...floor,...display]}});
const pairs=[];
for(const feature of display.filter(f=>['Group Study Space','Collaborative Space'].includes(f.properties.name))){
 const a=index.rows.get(feature.properties.__roomSearchKey);
 const ranked=floor.flatMap(f=>{const b=index.rows.get(f.properties.__roomSearchKey);if(!a||!b)return [];const r=compareMetricRows(a,b);return r.intersection_area_m2>1e-6?[{r,b}]:[];}).sort((x,y)=>y.r.intersection_over_union-x.r.intersection_over_union);
 if(!ranked.length)continue;
 const {r,b}=ranked[0];
 const independentArea=OverlayOp.intersection(a.metric,b.metric).getArea();
 const separation=DiscreteHausdorffDistance.distance(a.metric.getBoundary(),b.metric.getBoundary(),.02);
 pairs.push({name:feature.properties.name,display_id:feature.properties.OBJECTID,f6_id:b.feature.properties.OBJECTID,
  f6_area_m2:b.area,combined_area_m2:a.area,intersection_m2:r.intersection_area_m2,jsts_intersection_m2:independentArea,
  independent_area_difference_m2:Math.abs(independentArea-r.intersection_area_m2),iou_percent:r.intersection_over_union*100,
  sampled_max_boundary_separation_m:separation,exact_export_precision_match:routeFootprintSignature(a.feature.geometry)===routeFootprintSignature(b.feature.geometry),
  f6_relative_height:Number(b.feature.properties.height)-Number(b.feature.properties.base_height??b.feature.properties.base_heigh),combined_relative_height:Number(feature.properties.height)-Number(feature.properties.base_height??feature.properties.base_heigh),
  f6_coordinates:b.coordinates,combined_coordinates:a.coordinates});
}
const after=Object.fromEntries(sources.map(p=>[p,hash(p)]));if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Sources changed during read-only check');
const result={source_hashes:after,valid_F6_features:floor.length,valid_combined_F6_features:display.length,geometry_issues:index.issues,
 method:'Shared local spherical Lambert azimuthal equal-area plane; polyclip-ts intersection independently compared with JSTS OverlayOp; sampled boundary Hausdorff distance at vertices plus 50 subdivisions per edge, not a guaranteed exact continuous maximum.',pairs};
fs.writeFileSync('docs/f6-geometry-sync/geometry-recheck.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,pairs:pairs.map(({f6_coordinates,combined_coordinates,...p})=>p)},null,2));
