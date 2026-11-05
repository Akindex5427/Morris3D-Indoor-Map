// Opt-in worker entry for future integration. Not constructed by the live app.
import {createSpatialRelationshipService} from './relationships';
export function createSpatialWorkerHandler(){
 const service=createSpatialRelationshipService();
 return ({id,action='analyze',datasets,dataset_version,feature_a_id,feature_b_id,tolerances})=>{
  try{
   if(action==='clear'){service.clear();return {id,status:'cleared'};}
   if(!['analyze','compare'].includes(action))throw new Error('Unknown spatial worker action');
   return {id,status:'ready',result:action==='compare'?service.compare(datasets,dataset_version,feature_a_id,feature_b_id,tolerances):service.analyze(datasets,dataset_version,tolerances)};
  }catch(error){return {id,status:'error',message:error.message};}
 };
}
if(typeof self!=='undefined'&&typeof document==='undefined'){
 const handle=createSpatialWorkerHandler();self.onmessage=event=>self.postMessage(handle(event.data));
}
