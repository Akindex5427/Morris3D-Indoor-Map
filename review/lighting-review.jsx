import React, {useState, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
const baseline = new URLSearchParams(location.search).has('before');
const root = baseline ? '/.tmp/baseline/src' : '/src';
const {default: Map3D} = await import(/* @vite-ignore */ `${root}/components/Map3D.jsx`);
const {useNightPreset} = await import('/src/hooks/useNightPreset.js');
const {enrichMissingFeatureDisplayProperties} = await import('/src/utils/featureColors.js');
const reference = await (await fetch('/rooms-all-WGS-v6.geojson')).json();
const lights = await (await fetch('/interior_lights.geojson')).json();
const points = lights.features.map(f=>f.geometry.coordinates);
const center = [0,1].map(i=>(Math.min(...points.map(p=>p[i]))+Math.max(...points.map(p=>p[i])))/2);
const cache = new Map();
const files = ['rooms-basement-WGS.geojson','rooms-level-01-WGS.geojson','rooms-level-02-WGS.geojson','rooms-level-03-WGS.geojson','rooms-level-04-WGS.geojson','rooms-level-5-WGS.geojson','rooms-level-6-WGS.geojson','rooms-level-7-WGS.geojson'];
const none = [];
window.review = {errors: [], baseline};
console.error = (...args) => window.review.errors.push(args.map(String).join(' ').slice(0,5000));
window.addEventListener('error', event=>window.review.errors.push(event.message));
function Review() {
  const [floor, setFloor] = useState('all');
  const [night, setNight] = useState(!new URLSearchParams(location.search).has('day'));
  const [data, setData] = useState(none);
  const [route, setRoute] = useState({});
  const {preset, selectPreset, nightTuning: tuning, setTargetTuning: setTuning} = useNightPreset(night);
  const [cinematic, setCinematic] = useState(false);
  const [replay, setReplay] = useState(0);
  const [view, setView] = useState({longitude:center[0],latitude:center[1],zoom:18.3,pitch:55,bearing:0});
  Object.assign(window.review,{setFloor,setNight,setView,setRoute,setTuning,setCinematic,selectPreset,preset,tuning,replay:()=>setReplay(n=>n+1),floor,night,view,data});
  useEffect(()=>{const file=floor==='all'?'rooms-all-WGS-v6.geojson':files[floor];
    if(!cache.has(file))cache.set(file,fetch('/'+file).then(r=>r.json()).then(d=>floor==='all'?d.features:
      enrichMissingFeatureDisplayProperties(d.features,reference.features,{floor}).map(f=>({...f,properties:{...f.properties,level:f.properties.level??f.properties.floor??f.properties.nivel??floor}}))));
    let cancelled=false;cache.get(file).then(d=>{if(!cancelled)setData(d);});return()=>{cancelled=true;};
  },[floor]);
  return React.createElement(Map3D,{selectedFloor:floor,activeFloor:floor,selectedFloors:none,filteredRooms:none,
    roomsData:data,viewState:view,onViewStateChange:setView,nightMode:night,nightTuning:tuning,
    onRoomSelect:room=>{window.review.picked=room;},onRoomHover:()=>{},cinematicAnimationsEnabled:cinematic,
    initialRevealReplayKey:replay,...route});
}
createRoot(document.getElementById('root')).render(React.createElement(Review));
window.review.getDeck = () => {
  const div=document.querySelector('#deckgl-wrapper');
  let fiber=div?.[Object.keys(div).find(k=>k.startsWith('__reactFiber'))];
  while(fiber) {
    let hook=fiber.memoizedState;
    while(hook && typeof hook==='object') {
      if(hook.memoizedState?.current?.deck) return hook.memoizedState.current.deck;
      if(hook.memoizedState?.current?.layerManager) return hook.memoizedState.current;
      hook=hook.next;
    }
    fiber=fiber.return;
  }
};
