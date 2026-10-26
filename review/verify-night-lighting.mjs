// Run from the repository root with Vite and an isolated Chrome CDP session.
// --baseline additionally uses the local pre-change snapshot in .tmp/baseline.
import {writeFile, mkdir} from 'node:fs/promises';
const appUrl = process.env.LIGHTING_REVIEW_URL || 'http://127.0.0.1:3001';
const debugUrl = process.env.LIGHTING_DEBUG_URL || 'http://127.0.0.1:9223';
const tabs = await (await fetch(`${debugUrl}/json`)).json();
const ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
let id=0; const waiting=new Map();
ws.onclose=()=>{for(const p of waiting.values())p.reject(new Error('Browser connection closed'));waiting.clear();};
ws.onmessage=({data})=>{const m=JSON.parse(data);const p=waiting.get(m.id);if(p){waiting.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}};
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{waiting.delete(n);reject(new Error('CDP timeout: '+method));},30000);waiting.set(n,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(expression){for(let i=0;i<150;i++){if(await evaluate(`Boolean(window.review?.getDeck?.()) && (${expression})`))return;await delay(200);}throw new Error('Timed out: '+expression);}
async function shot(name){await delay(900);const {data}=await send('Page.captureScreenshot',{format:'png'});await writeFile(`docs/night-lighting/${name}.png`,Buffer.from(data,'base64'));}
await mkdir('docs/night-lighting',{recursive:true});
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
const results=[];
async function stats(){return evaluate(`(()=>{const d=review.getDeck();const layers=d.layerManager.getLayers();const surfaces=layers.filter(l=>l.constructor.layerName==='NightSurfaceLayer');const fixtures=layers.find(l=>l.id==='interior-light-fixtures');return {floor:review.floor,night:review.night,view:review.view,errors:review.errors.slice(),glError:layers[0].context.gl.getError(),lights:fixtures?.props.data.length||0,fixtureLayers:layers.filter(l=>l.id==='interior-light-fixtures').length,surfaces:surfaces.map(l=>({id:l.id,fieldHeight:l.props.nightField.height,contributions:l.props.nightField.contributions,truncated:l.props.nightField.truncated,textureReferences:l.state.atlasEntry.references})),layerIds:layers.map(l=>l.id)};})()`);}
for(const before of process.argv.includes('--baseline') ? [true,false] : [false]){
  await send('Page.navigate',{url:appUrl+'/review/lighting-review.html'+(before?'?before':'')});
  await until(`Boolean(window.review?.getDeck?.()?.layerManager.getLayers().some(l=>l.id==='interior-light-fixtures'&&l.props.data.length===138))`);
  await delay(1500);
  const label=before?'before':'after';
  await shot(`${label}-all`);
  await evaluate(`document.querySelector('.mapboxgl-canvas').style.visibility='hidden'`);
  await shot(`${label}-all-building`);
  await evaluate(`document.querySelector('.mapboxgl-canvas').style.visibility=''`);
  results.push({phase:label,...await stats()});
  await evaluate('review.setNight(false)');
  await until(`!review.getDeck().layerManager.getLayers().some(l=>l.id==='interior-light-fixtures'||l.constructor.layerName==='NightSurfaceLayer')`);
  await shot(`${label}-day`);
  await evaluate(`document.querySelector('.mapboxgl-canvas').style.visibility='hidden'`);
  await shot(`${label}-day-building`);
  await evaluate(`document.querySelector('.mapboxgl-canvas').style.visibility=''`);
  results.push({phase:label+'-day',...await stats()});
  await evaluate('review.setNight(true)');
  if(!before){
    for(let floor=0;floor<8;floor++){
      await evaluate(`review.setFloor(${floor})`);
      await until(`review.floor===${floor} && review.getDeck().layerManager.getLayers().some(l=>l.constructor.layerName==='NightSurfaceLayer'&&l.props.nightField.height===review.data.length) && review.data.length>0 && (review.data[0].properties.level??review.data[0].properties.floor)===${floor}`);
      await delay(400);
      results.push({phase:'floor',...await stats()});
      if([0,1,7].includes(floor))await shot('after-f'+floor);
      if(floor===1)results.push({phase:'picking',pickedRooms:await evaluate(`review.getDeck().pickObjects({x:0,y:0,width:1440,height:1000,layerIds:['indoor-building-night-layer']}).filter(p=>p.object?.properties).length`)});
    }
    await evaluate('review.setFloor(1)');await until(`review.data[0].properties.level===1`);await delay(800);
    await evaluate(`(async()=>{const data=await(await fetch('/room_level_1_centerlines.geojson')).json();const path=data.features.find(f=>f.geometry.type==='LineString'&&f.geometry.coordinates.length>2).geometry.coordinates.map(p=>({coords:p.slice(0,2)}));review.setRoute({routePath:path,routeRenderPath:path,routeFloorId:1});})()`);
    await until(`review.getDeck().layerManager.getLayers().some(l=>l.id.includes('route'))`);
    await shot('after-route');results.push({phase:'route',...await stats()});
    await evaluate('review.setRoute({}); review.setFloor("all")');await until(`review.getDeck().layerManager.getLayers().some(l=>l.id==='interior-light-fixtures'&&l.props.data.length===138)`);await delay(900);
    await evaluate(`(()=>{const s=review.getDeck().layerManager.getLayers().find(l=>l.constructor.layerName==='NightSurfaceLayer');review.savedTexture=s.state.atlasEntry.texture;review.savedField=s.props.nightField;return true;})()`);
    await evaluate('review.setView(v=>({...v,zoom:18.6,bearing:35,pitch:65}))');await delay(500);
    results.push({phase:'camera',resourcesStable:await evaluate(`(()=>{const s=review.getDeck().layerManager.getLayers().find(l=>l.constructor.layerName==='NightSurfaceLayer');return s.state.atlasEntry.texture===review.savedTexture&&s.props.nightField===review.savedField;})()`),...await stats()});
    await shot('after-rotated');
    await evaluate('review.setNight(false)');await delay(300);
    results.push({phase:'resource-disposal',textureDeleted:await evaluate('review.savedTexture.handle === null'),...await stats()});
    await evaluate('review.setNight(true)');await delay(400);
    for(let n=0;n<3;n++){await evaluate('review.setNight(false)');await delay(250);await evaluate('review.setNight(true)');await delay(400);}
    results.push({phase:'repeated-toggles',...await stats()});
    await evaluate('review.setCinematic(true); review.replay()');await delay(600);
    await until(`review.getDeck().layerManager.getLayers().some(l=>l.id==='interior-light-fixtures'&&l.props.data.length===138)`);
    results.push({phase:'cinematic',...await stats()});
    results.push({phase:'gpu-atlas-readback',...await evaluate(`(()=>{const s=review.getDeck().layerManager.getLayers().find(l=>l.constructor.layerName==='NightSurfaceLayer'),gl=s.context.gl,t=s.state.atlasEntry.texture;gl.getExtension('EXT_color_buffer_float');const prior=gl.getParameter(gl.FRAMEBUFFER_BINDING),f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.handle,0);const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);const out=new Float32Array(8);gl.readPixels(0,0,2,1,gl.RGBA,gl.FLOAT,out);const error=gl.getError();gl.bindFramebuffer(gl.FRAMEBUFFER,prior);gl.deleteFramebuffer(f);return {framebufferComplete:status===gl.FRAMEBUFFER_COMPLETE,glError:error,matchesSource:out.every((v,i)=>Math.abs(v-s.props.nightField.pixels[i])<0.00001)};})()`)});
  }
  console.log(label+' captured');
}
await writeFile('docs/night-lighting/browser-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(({phase,floor,lights,errors,glError,resourcesStable})=>({phase,floor,lights,errors,glError,resourcesStable})),null,2));
ws.close();
if(results.some(r=>r.errors?.length||r.glError||r.resourcesStable===false||r.textureDeleted===false||r.matchesSource===false||r.framebufferComplete===false||r.pickedRooms===0))process.exitCode=1;
