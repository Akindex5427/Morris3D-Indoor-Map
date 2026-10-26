// Test-only comparisons on identical data, cameras and Deck blending. No basemap/network pixels.
import React,{useState,useMemo,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import DeckGL from '@deck.gl/react';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {useIndoorBuilding} from '../src/components/IndoorBuilding';
import {useIndoorBuilding as useBefore} from '../.tmp/day-restore-before/src/components/IndoorBuilding';
import {useIndoorBuilding as useLegacy} from '../.tmp/stage7-baseline/src/components/IndoorBuilding';
import {nightEnvelopeLayers} from '../src/utils/interiorLighting';
import {nightEnvelopeLayers as beforeEnvelope} from '../.tmp/day-restore-before/src/utils/interiorLighting';
import {nightEnvelopeLayers as legacyEnvelope} from '../.tmp/stage7-baseline/src/utils/interiorLighting';
import {useBuildingWallLayers,WALL_LAYER_CONFIG} from '../src/layers/buildingWallLayer';
import {usePerimeterWallLayer} from '../src/layers/perimeterWallLayer';
import {useStackedWallLayer} from '../src/layers/stackedWallLayer';
import {loadWallData} from '../src/utils/wallDataCache';
import {useInteriorLighting} from '../src/hooks/useInteriorLighting';
import {buildFloorCatalog,FLOOR_POLYGON_MAP} from '../src/utils/roomCatalog';
import {linkRouteFeatureIdentities,routeFeatureKey} from '../src/utils/routeLabelIdentity';
import {sampleEnvironment} from '../src/utils/environment';
import {enrichMissingFeatureDisplayProperties} from '../src/utils/featureColors';
import {NIGHT_PRESETS} from '../src/utils/nightLightingConfig';

const floors=await Promise.all(Array.from({length:8},async(_,floor)=>buildFloorCatalog(await(await fetch(FLOOR_POLYGON_MAP[floor])).json(),floor).data));
const combined=await(await fetch(FLOOR_POLYGON_MAP.all)).json();
await Promise.all([...WALL_LAYER_CONFIG.map(c=>c.url),'/wall.geojson'].map(loadWallData));
// Match App.loadGeojson's established display metadata repair; never rewrite sources.
floors.forEach((data,floor)=>{data.features=enrichMissingFeatureDisplayProperties(data.features,combined.features,{floor});});
const all=floors.flatMap(d=>d.features);
combined.features=linkRouteFeatureIdentities(combined.features.map((f,i)=>({...f,properties:{...f.properties,__displayFeatureKey:`combined:${i}`}})),all);
const view={longitude:-89.2204671758,latitude:37.7152913603,zoom:19.15,pitch:45,bearing:15};
const empty=[];
function Review(){
 const [floor,setFloor]=useState(1),[variant,setVariant]=useState('before'),[progress,setProgress]=useState(0);
 const [preset,setPreset]=useState('architectural'),[selected,setSelected]=useState(false),[route,setRoute]=useState(false);
 const deck=useRef(null);
 const data=floor==='all'?combined:floors[floor];
 const selectedFloors=useMemo(()=>floor==='all'?[0,1,2,3,4,5,6,7]:[floor],[floor]);
 const environment=useMemo(()=>sampleEnvironment(progress),[progress]);
 const named=data.features.filter(f=>f.properties?.name&&!/floor|wall|structure/i.test(f.properties.name));
 const focus=useMemo(()=>route?{active:true,startRoomId:routeFeatureKey(named[0]),endRoomId:routeFeatureKey(named[1]),landmarkRoomIds:[],connectorRoomIds:[],involvedFloors:selectedFloors}:null,[data,route,selectedFloors]);
 const presentation=useMemo(()=>({revealProgress:1,initialRevealActive:false,routeFocus:focus}),[focus]);
 const legacyId=f=>f.properties.id||f.properties.name||f.properties.room_id||f.properties.OBJECTID;
 const legacyPresentation=useMemo(()=>({...presentation,routeFocus:route?{...focus,startRoomId:legacyId(named[0]),endRoomId:legacyId(named[1])}:null}),[presentation]);
 const {sampler}=useInteriorLighting(true,selectedFloors);
 const props={data,selectedFloors,translucency:.6,wallOpacity:.95,lightSampler:sampler,environment,
  nightMode:progress===1,nightTuning:NIGHT_PRESETS[preset],presentation,highlightedRoomId:selected?routeFeatureKey(named[0]):null};
 const current=useIndoorBuilding(props),before=useBefore(props);
 const legacy=useLegacy({...props,presentation:legacyPresentation,nightMode:false,highlightedRoomId:selected?legacyId(named[0]):null});
 const single=useBuildingWallLayers({visibleFloorIds:floor==='all'?empty:selectedFloors});
 const perimeter=usePerimeterWallLayer({enabled:floor==='all',presentation});
 const stacked=useStackedWallLayer({activeFloor:floor,selectedFloor:floor,selectedFloors:empty,presentation});
 const originals=[...single,...perimeter,...stacked];
 const chosen=variant==='legacy'?legacy:(variant==='before'||variant.startsWith('depth-'))?before:current;
 const walls=(variant==='legacy'||variant==='reference')?legacyEnvelope(originals,false):
  ((variant==='before'||variant.startsWith('depth-'))?beforeEnvelope:nightEnvelopeLayers)(originals,environment.surfaceNight,NIGHT_PRESETS[preset],selectedFloors.length);
 // Ablation isolates depth and blend settings without changing the before shader.
 const layers=[...chosen.layers,...walls].map(l=>variant==='reference'?l.clone({parameters:{...l.props.parameters,depthMask:true,blendFunc:[770,771]},extensions:[],_subLayerProps:{'polygons-fill':{type:SolidPolygonLayer}}}):variant==='depth-only'?l.clone({parameters:{...l.props.parameters,depthMask:true}}):
  variant==='depth-blend'?l.clone({parameters:{...l.props.parameters,depthMask:true,blendFunc:[770,771]}}):l).map(l=>l.clone({id:`${variant}-${l.id}`}));
 const v=floor==='all'?{...view,zoom:18.6}:view;
 window.dayReview={setFloor,setVariant,setProgress,setPreset,setSelected,setRoute,floor,variant,progress,preset,selected,route,data,layers,originals,environment,
  getDeck:()=>deck.current?.deck,ready:Boolean(sampler?.origin&&(floor==='all'?perimeter.length:single.length)),
  rendered:()=>{
   const d=deck.current?.deck;
   return d&&layers.every(expected=>{
    const actual=d.layerManager.getLayers().find(l=>l.id===expected.id);
    return actual&&actual.props.data===expected.props.data&&actual.props.getFillColor===expected.props.getFillColor&&actual.props.environmentDepthProgress===expected.props.environmentDepthProgress;
   });
  },snapshot:()=>{
   const d=deck.current.deck;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(`Screenshot timeout: ${window.dayReview.floor}/${window.dayReview.variant}; ready=${window.dayReview.ready}; rendered=${window.dayReview.rendered()}`)),10000);const previous=d.props.onAfterRender;d.setProps({onAfterRender:()=>{if(!window.dayReview.rendered())return;clearTimeout(timeout);const png=d.canvas.toDataURL();d.setProps({onAfterRender:previous});resolve(png);}});d.redraw(true);});}};
 return <DeckGL ref={deck} viewState={v} layers={layers} effects={[chosen.lightingEffect]} controller={false}
  parameters={{depthTest:true,depthFunc:515,blend:true,blendFunc:[770,771]}} />;
}
createRoot(document.getElementById('root')).render(<Review/>);
