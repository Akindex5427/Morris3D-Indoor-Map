import React,{useState,useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import Map3D from '../src/components/Map3D';
import {useInteriorLightActivation} from '../src/hooks/useInteriorLightActivation';
import {interiorLightResources} from '../src/utils/interiorLightResources';
import {enrichMissingFeatureDisplayProperties} from '../src/utils/featureColors';
import {useEnvironmentController} from '../src/hooks/useEnvironmentController';
import {useNightPreset} from '../src/hooks/useNightPreset';
import {sampleEnvironment} from '../src/utils/environment';
import {buildFloorCatalog,FLOOR_POLYGON_MAP} from '../src/utils/roomCatalog';
import {getRoomLabelAnchor} from '../src/utils/roomLabelAnchor';
import {routeFeatureKey,linkRouteFeatureIdentities} from '../src/utils/routeLabelIdentity';
import '../src/App.css';
const datasets=await Promise.all(Array.from({length:8},async(_,floor)=>buildFloorCatalog(await(await fetch(FLOOR_POLYGON_MAP[floor])).json(),floor).data.features));
const all=datasets.flat();
const combined=linkRouteFeatureIdentities((await(await fetch(FLOOR_POLYGON_MAP.all)).json()).features,all);
datasets.forEach((features,floor)=>{datasets[floor]=enrichMissingFeatureDisplayProperties(features,combined,{floor});});
const routeRooms=datasets[1].filter(f=>f.properties.name && !/floor|wall|exterior|roof|ceiling|structure/i.test(f.properties.name)&&getRoomLabelAnchor(f));
const endpoints=[routeRooms[0],routeRooms[3]];
const routePath=endpoints.map(f=>({coords:getRoomLabelAnchor(f),floor:1}));
const focus={active:true,startRoomId:routeFeatureKey(endpoints[0]),endRoomId:routeFeatureKey(endpoints[1]),involvedFloors:[1],landmarkRoomIds:[],connectorRoomIds:[]};
function Review(){
 window.lightReviewRenderCount=(window.lightReviewRenderCount||0)+1;
 const [night,setNight]=useState(false),[floor,setFloor]=useState(1),[manual,setManual]=useState(null),[mounted,setMounted]=useState(true);
 const [view,setView]=useState({longitude:-89.22045,latitude:37.71525,zoom:19,pitch:45,bearing:17});
 const environment=useEnvironmentController(night),preset=useNightPreset(night);
 const appearance=useMemo(()=>manual===null?environment:sampleEnvironment(manual),[environment,manual]);
 const activation=useInteriorLightActivation(night,appearance.fullNight);
 window.lightReview={activation,resources:interiorLightResources,night};
 window.environmentReview={setNight,setFloor,setManual,setView,setMounted,environment,appearance,preset,view,floor,routePath,focus};
 return mounted ? <Map3D roomsData={floor==='all'?combined:datasets[floor]} authoritativeFeatures={all} selectedFloor={floor} activeFloor={floor}
   routeFocus={focus} routeRenderPath={routePath} routeFloorId={1} highlightedRoomId={routeFeatureKey(endpoints[0])}
   viewState={view} onViewStateChange={setView} cinematicAnimationsEnabled={false} environment={appearance}
   interiorLightActivation={activation} nightMode={night} nightTuning={preset.nightTuning} /> : null;
}
const root=createRoot(document.getElementById('root'));window.unmountEnvironmentReview=()=>root.unmount();root.render(<React.StrictMode><Review/></React.StrictMode>);
