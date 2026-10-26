// Browser-side: inspect the authoritative path passed to Map3D, rather than
// animated traveled/remaining fragments or camera-dependent label layouts.
exports.snapshotRoute=function(){
 return [...document.querySelectorAll('#deckgl-wrapper')].map(node=>{
  let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];
  while(f){const p=f.memoizedProps;if(Array.isArray(p?.routeRenderPath)&&p.routeRenderPath.length){
   return {path:p.routeRenderPath,start:p.routeFocus?.startRoomId,end:p.routeFocus?.endRoomId};
  }f=f.return;}return null;
 }).filter(Boolean);
};
