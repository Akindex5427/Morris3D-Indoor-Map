const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1200,height:900}}),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3004/review/environment-stage4.html');
 await page.waitForFunction(()=>window.environmentReview&&document.querySelector("#deckgl-wrapper"),null,{timeout:60000});
 try {
 await page.waitForFunction(()=>{
   let f=document.querySelector('#deckgl-wrapper');f=f?.[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];
   while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.getMap){window.mapReviewRef=h.memoizedState.current.getMap();return true;}h=h.next;}f=f.return;}return false;
  },null,{timeout:60000});
 const report=await page.evaluate(async()=>{
  const map=window.mapReviewRef;
  const {createMapEnvironmentAdapter}=await import('/src/utils/mapEnvironment.js');
  const {sampleEnvironment}=await import('/src/utils/environment.js');
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const reports=[],validationErrors=[];map.on('error',e=>{if(/paint|fog|light|expression|color|transition/i.test(e.error?.message||''))validationErrors.push(e.error.message);});
  for(const style of ['streets-v12','outdoors-v12']) {
   // Explicit style selection only. No setStyle occurs during any transition below.
   await new Promise(resolve=>{let timer;const loaded=()=>{clearTimeout(timer);map.off('style.load',loaded);resolve();};map.on('style.load',loaded);timer=setTimeout(loaded,20000);map.setStyle('mapbox://styles/mapbox/'+style);});
   for(let n=0;n<150&&!map.isStyleLoaded();n++) await wait(100);
   if(!map.isStyleLoaded()){reports.push({style,unavailable:true});continue;}
   const adapter=createMapEnvironmentAdapter(map);
   if(map.getLayer('environment-review-custom')) map.removeLayer('environment-review-custom');
   if(map.getSource('environment-review-custom')) map.removeSource('environment-review-custom');
   map.addSource('environment-review-custom',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
   map.addLayer({id:'environment-review-custom',type:'fill',source:'environment-review-custom',paint:{'fill-color':'#abcdef'}});
   const source=map.getSource('environment-review-custom'),mapStyle=map.style,baseline=map.getStyle(),camera=[map.getCenter().lng,map.getCenter().lat,map.getZoom(),map.getPitch(),map.getBearing()];
   const props=baseline.layers.filter(l=>l.paint?.['background-color']||l.paint?.['fill-color']).slice(0,8).map(l=>({id:l.id,property:l.paint['background-color']?'background-color':'fill-color'}));
   const samples=[];
   for(const p of [0,.36,.7,1,.36,0]) {
    adapter.apply(sampleEnvironment(p),true);await wait(60);
    samples.push({progress:p,colors:props.map(({id,property})=>map.getPaintProperty(id,property))});
   }
   const stable={source:map.getSource('environment-review-custom')===source,style:map.style===mapStyle,customPaint:map.getPaintProperty('environment-review-custom','fill-color')==='#abcdef',camera:JSON.stringify(camera)===JSON.stringify([map.getCenter().lng,map.getCenter().lat,map.getZoom(),map.getPitch(),map.getBearing()])};
   reports.push({style,diagnostics:adapter.diagnostics,validationErrors:[...validationErrors],stable,samples});adapter.dispose();
  }
  return reports;
 });
 for(const r of report){if(r.unavailable)continue;assert(Object.values(r.stable).every(Boolean));assert.equal(r.diagnostics.failures.length,0);assert.deepEqual(r.validationErrors,[]);assert(r.diagnostics.paintProperties>20);assert.deepEqual(r.samples[0].colors,r.samples.at(-1).colors);assert.notDeepEqual(r.samples[0].colors,r.samples[3].colors);}
 results.push(...report);assert.deepEqual(errors,[]);
 fs.writeFileSync('docs/stage-4-environment/basemaps.json',JSON.stringify({results,errors},null,2));} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
