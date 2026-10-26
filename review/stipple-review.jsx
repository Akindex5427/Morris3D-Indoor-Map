// Diagnostic only. Deliberately uses production geometry, lighting and shaders.
import React,{useState,useMemo,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import DeckGL from '@deck.gl/react';
import {useIndoorBuilding} from '../src/components/IndoorBuilding';
import {useBuildingWallLayers,WALL_LAYER_CONFIG} from '../src/layers/buildingWallLayer';
import {usePerimeterWallLayer} from '../src/layers/perimeterWallLayer';
import {useStackedWallLayer} from '../src/layers/stackedWallLayer';
import {loadWallData} from '../src/utils/wallDataCache';
import {useInteriorLighting} from '../src/hooks/useInteriorLighting';
import {buildFloorCatalog,FLOOR_POLYGON_MAP} from '../src/utils/roomCatalog';
import {linkRouteFeatureIdentities} from '../src/utils/routeLabelIdentity';
import {sampleEnvironment} from '../src/utils/environment';
import {enrichMissingFeatureDisplayProperties} from '../src/utils/featureColors';
import {NIGHT_PRESETS} from '../src/utils/nightLightingConfig';
import {nightEnvelopeLayers} from '../src/utils/interiorLighting';
import {EnvironmentDepthExtension as OriginalDepthExtension} from './stipple-baseline-depth';
import {EnvironmentDepthEffect} from '../src/layers/environmentDepthEffect';

const floors=await Promise.all(Array.from({length:8},async(_,floor)=>buildFloorCatalog(await(await fetch(FLOOR_POLYGON_MAP[floor])).json(),floor).data));
const combined=await(await fetch(FLOOR_POLYGON_MAP.all)).json();
await Promise.all([...WALL_LAYER_CONFIG.map(c=>c.url),'/wall.geojson'].map(loadWallData));
floors.forEach((data,floor)=>{data.features=enrichMissingFeatureDisplayProperties(data.features,combined.features,{floor});});
combined.features=linkRouteFeatureIdentities(combined.features,floors.flatMap(d=>d.features));
// Experimental ablation removes ONLY the rejection injection. Existing passes,
// data, camera, materials, blending and depth states remain intact.
class NoRejection extends OriginalDepthExtension {
 getShaders(){const shaders=super.getShaders();return {...shaders,inject:{...shaders.inject,'fs:#main-start':''}};}
}
const noRejection=[new NoRejection()],originalDepth=[new OriginalDepthExtension()],empty=Object.freeze([]),presentation=Object.freeze({revealProgress:1,initialRevealActive:false});
function Review(){
 const [floor,setFloor]=useState(1),[progress,setProgress]=useState(0),[variant,setVariant]=useState('original'),[preset,setPreset]=useState('architectural'),[group,setGroup]=useState('all');
 const [view,setView]=useState({longitude:-89.2204671758,latitude:37.7152913603,zoom:19,pitch:55,bearing:15});
 const deck=useRef(null),selectedFloors=useMemo(()=>floor==='all'?[0,1,2,3,4,5,6,7]:[floor],[floor]);
 const environment=useMemo(()=>sampleEnvironment(progress),[progress]),data=floor==='all'?combined:floors[floor];
 const {sampler}=useInteriorLighting(true,selectedFloors);
 const result=useIndoorBuilding({data,selectedFloors,translucency:.6,wallOpacity:.95,lightSampler:sampler,environment,nightMode:progress===1,nightTuning:NIGHT_PRESETS[preset],presentation});
 const single=useBuildingWallLayers({visibleFloorIds:floor==='all'?empty:selectedFloors});
 const perimeter=usePerimeterWallLayer({enabled:floor==='all',presentation});
 const stacked=useStackedWallLayer({activeFloor:floor,selectedFloor:floor,selectedFloors:empty,presentation});
 const originals=[...single,...perimeter,...stacked];
 const rooms=result.layers.filter(l=>group==='all'||(group==='rooms'&&!l.id.includes('walls'))||(group==='walls'&&l.id.includes('walls')));
 const walls=group==='all'||group==='envelope'?nightEnvelopeLayers(originals,environment.surfaceNight,NIGHT_PRESETS[preset],selectedFloors.length):[];
 const layers=[...rooms,...walls].map(l=>variant==='no-rejection'?l.clone({extensions:noRejection}):variant==='original'?l.clone({extensions:originalDepth}):l);
 const depthEffect=useMemo(()=>new EnvironmentDepthEffect(),[]);depthEffect.setProps({surfaceNight:environment.surfaceNight});
 const v={...view,zoom:floor==='all'?view.zoom-.5:view.zoom};
 window.stippleReview={setFloor,setProgress,setVariant,setPreset,setGroup,setView,floor,progress,variant,preset,group,environment,data,layers,
  getDeck:()=>deck.current?.deck,ready:Boolean(sampler?.origin&&(floor==='all'?perimeter.length:single.length))};
 return <DeckGL ref={deck} viewState={v} layers={layers} effects={[result.lightingEffect,...(variant==='fixed'?[depthEffect]:[])]} controller={false}
  parameters={{depthTest:true,depthFunc:515,blend:true,blendFunc:[770,771]}} />;
}
const root=createRoot(document.getElementById('root'));window.unmountStippleReview=()=>root.unmount();root.render(<Review/>);
