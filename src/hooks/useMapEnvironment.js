import {useCallback,useEffect,useRef} from 'react';
import {createMapEnvironmentAdapter} from '../utils/mapEnvironment';

export function useMapEnvironment(mapRef, environment) {
  const adapter=useRef(null), latest=useRef(environment);
  latest.current=environment;
  const onLoad=useCallback(()=>{
    adapter.current?.dispose();
    const map=mapRef.current?.getMap?.();
    if(map) {
      adapter.current=createMapEnvironmentAdapter(map);
      adapter.current.apply(latest.current,true);
    }
  },[mapRef]);
  useEffect(()=>{adapter.current?.apply(environment);},[environment]);
  useEffect(()=>()=>{adapter.current?.dispose();adapter.current=null;},[]);
  return onLoad;
}
