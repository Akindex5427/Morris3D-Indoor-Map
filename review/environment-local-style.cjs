const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:3004/review/environment-stage4.html');
  await page.waitForFunction(()=>window.environmentReview&&document.querySelector('#deckgl-wrapper'));
  await page.waitForFunction(()=>{
   const node=document.querySelector('#deckgl-wrapper');let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];
   while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.getMap?.())return true;h=h.next;}f=f.return;}return false;
  });
  const result=await page.evaluate(async()=>{
   let f=document.querySelector('#deckgl-wrapper');f=f[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];let map;
   while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.getMap)map=h.memoizedState.current.getMap();h=h.next;}f=f.return;}
   const {createMapEnvironmentAdapter}=await import('/src/utils/mapEnvironment.js'),{sampleEnvironment}=await import('/src/utils/environment.js');
   const style={version:8,sources:{custom:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},layers:[
    {id:'background',type:'background',paint:{'background-color':'#e8efe3'}},
    {id:'accent',type:'background',paint:{'background-opacity':0,'background-color':['interpolate',['linear'],['zoom'],0,'#ffffff',22,'#aaccdd']}},
    {id:'custom',type:'fill',source:'custom',paint:{'fill-color':'#abcdef'}}]};
   await new Promise(resolve=>{map.once('style.load',resolve);map.setStyle(style);});
   await new Promise(r=>setTimeout(r,150));
   const source=map.getSource('custom'),styleRef=map.style,camera=JSON.stringify([map.getCenter(),map.getZoom(),map.getPitch(),map.getBearing()]);
   let reloads=0;const original=map.setStyle;map.setStyle=function(...args){reloads++;return original.apply(this,args);};
   const adapter=createMapEnvironmentAdapter(map),samples=[],validationErrors=[];
   map.on('error',e=>validationErrors.push(e.error?.message));
   for(const p of [0,.18,.36,.55,.7,.85,1,.7,.36,0]){
    adapter.apply(sampleEnvironment(p),true);await new Promise(r=>setTimeout(r,20));
    samples.push({p,color:map.getPaintProperty('background','background-color'),expression:map.getPaintProperty('accent','background-color'),fog:map.getFog(),light:map.getLight()});
   }
   const stable={style:map.style===styleRef,source:map.getSource('custom')===source,customPaint:map.getPaintProperty('custom','fill-color')==='#abcdef',camera:camera===JSON.stringify([map.getCenter(),map.getZoom(),map.getPitch(),map.getBearing()])};
   const diagnostics=adapter.diagnostics;adapter.dispose();return {reloads,stable,diagnostics,validationErrors,samples};
  });
  assert.equal(result.reloads,0);assert(Object.values(result.stable).every(Boolean));assert.deepEqual(result.diagnostics.failures,[]);assert.deepEqual(result.validationErrors,[]);
  assert.equal(result.samples[0].color,result.samples.at(-1).color);assert.notEqual(result.samples[0].color,result.samples[6].color);assert.deepEqual(errors,[]);
  fs.writeFileSync('docs/stage-6-final/local-style.json',JSON.stringify({result,errors,scope:'Local Mapbox style; hosted streets/outdoors unavailable'},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
