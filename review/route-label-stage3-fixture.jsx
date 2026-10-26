// Development-only fixture: exercise the production Map3D and TextLayers with
// authoritative features. These are deliberately synthetic routes for label layout, not connectivity tests.
import React, {useState,useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import Map3D from '../src/components/Map3D';
import {buildFloorCatalog,FLOOR_POLYGON_MAP} from '../src/utils/roomCatalog';
import {routeFeatureKey,linkRouteFeatureIdentities} from '../src/utils/routeLabelIdentity';
import {getRoomLabelAnchor} from '../src/utils/roomLabelAnchor';
import {NIGHT_PRESETS} from '../src/utils/nightLightingConfig';
import '../src/App.css';
const datasets=await Promise.all(Array.from({length:8},async(_,floor)=>buildFloorCatalog(
  await (await fetch(FLOOR_POLYGON_MAP[floor])).json(),floor).data.features));
const all=datasets.flat();
const rawCombined=(await (await fetch(FLOOR_POLYGON_MAP.all)).json()).features;
const combined=linkRouteFeatureIdentities(rawCombined.map((f,i)=>({...f,properties:{...f.properties,__displayFeatureKey:`combined:${i}`}})),all);
const eligible=features=>features.filter(f=>f.properties.name && !/floor|wall|exterior|roof|ceiling|structure/i.test(f.properties.name) && getRoomLabelAnchor(f));
const key=routeFeatureKey;
function Review(){
  const [floor,setFloor]=useState(1),[night,setNight]=useState('day'),[fallback,setFallback]=useState(false);
  const [view,setView]=useState({longitude:-89.22045,latitude:37.71525,zoom:19,pitch:0,bearing:0});
  const features=floor==='all'?combined:datasets[floor];
  const rooms=eligible(floor==='all'?all:features).filter(f=>key(f));
  const named=rooms.reduce((m,f)=>{const n=f.properties.name;if(!m.has(n))m.set(n,[]);m.get(n).push(f);return m;},new Map());
  const pair=[...named.values()].find(items=>items.length>1 && (floor!=='all'||items[0].properties.floor!==items.at(-1).properties.floor));
  const start=pair?.[0]||rooms[0],end=pair?.at(-1)||rooms[1];
  const long=rooms.filter(f=>f!==start&&f!==end).sort((a,b)=>b.properties.name.length-a.properties.name.length)[0];
  const connector=features.find(f=>/stairs|staircase/i.test(f.properties.name||'')&&getRoomLabelAnchor(f));
  const connectorFloor=connector?.properties.floor??connector?.properties.level??(floor==='all'?1:floor);
  const focus={startRoomId:key(start),endRoomId:key(end),landmarkRoomIds:[key(long)],landmarks:[{roomId:key(long)}],
    startFloor:start.properties.floor,endFloor:end.properties.floor,involvedFloors:floor==='all'?[0,1,2,3,4,5,6,7]:[floor],
    connectorRoomIds:fallback?[]:connector?[connector.properties.name]:[]};
  const transitions=connector?[{floor:connectorFloor,connectorType:fallback?'ramp':'stairs',coords:fallback?getRoomLabelAnchor(long):getRoomLabelAnchor(connector)}]:[];
  const path=[start,long,end].map(f=>({coords:getRoomLabelAnchor(f),floor:Number(f.properties.floor)}));
  window.labelReview={setFloor,setNight,setFallback,setView,features,all,combined,focus,expected:{start,end,long},floor,night};
  return <Map3D selectedFloor={floor} activeFloor={floor} roomsData={features} authoritativeFeatures={all}
    routeFocus={focus} routeTransitionMarkers={transitions} routeRenderPath={path} viewState={view} onViewStateChange={setView}
    cinematicAnimationsEnabled={false} nightMode={night!=='day'} nightTuning={NIGHT_PRESETS[night]||NIGHT_PRESETS.architectural}
    onRoomSelect={(feature)=>{window.selectedReviewFeature=feature;}} />;
}
createRoot(document.getElementById('root')).render(<Review/>);
