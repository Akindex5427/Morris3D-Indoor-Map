const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const out='docs/stage-5-interior';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const results=[],errors=[];let requests=0;
 const open=async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/GLSL|DeckGL error/.test(m.text()))errors.push(m.text());});
  page.on('request',r=>{if(r.url().endsWith('/interior_lights.geojson'))requests++;});
  await page.addInitScript(()=>{
   window.reviewDeck=()=>{const node=document.querySelector('#deckgl-wrapper');let f=node?.[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];
    while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}};
   window.surface=()=>reviewDeck()?.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill');
  });
  return page;
 };
 const ready=async page=>{
  await page.goto('http://127.0.0.1:3004/review/interior-stage5.html');
  await page.waitForFunction(()=>window.lightReview&&surface()?.getModels().length,null,{timeout:60000});
  await page.waitForTimeout(300);
 };
 const state=page=>page.evaluate(()=>({progress:environmentReview.environment.progress,gain:lightReview.activation.getGain(),
  status:lightReview.resources.getSnapshot().status,fixtureCount:reviewDeck().props.layers.find(l=>l.id==='interior-light-fixtures')?.props.data.length||0,
  camera:environmentReview.view,uniform:surface().getModels()[0].getUniforms().fixtureGain,renders:lightReviewRenderCount}));
 try{
  const page=await open();await ready(page);assert.equal(requests,0);
  const day=await state(page);assert.equal(day.status,'idle');assert.equal(day.gain,0);
  await page.evaluate(()=>{window.samples=[];window.started=performance.now();lightReview.activation.subscribe(()=>samples.push({time:performance.now()-started,gain:lightReview.activation.getGain(),progress:environmentReview.environment.progress,renders:lightReviewRenderCount}));environmentReview.setNight(true);});
  await page.waitForFunction(()=>environmentReview.environment.progress>.35&&lightReview.resources.getSnapshot().status==='ready');
  const sunset=await state(page);assert.equal(sunset.gain,0);assert.equal(sunset.uniform,0);assert.equal(sunset.fixtureCount,20);
  await page.evaluate(()=>{
   const s=surface();window.retained={data:s.props.data,models:s.getModels(),atlas:s.state.atlasEntry,geometry:s.state.polygonTesselator,
    fixtures:reviewDeck().layerManager.getLayers().filter(l=>l.id.startsWith('interior-light-')).map(l=>({id:l.id,data:l.props.data,models:l.getModels()}))};
  });
  await page.waitForFunction(()=>environmentReview.environment.fullNight);
  await page.waitForFunction(()=>lightReview.activation.getGain()>.15&&lightReview.activation.getGain()<.9).catch(async error=>{console.log(await page.evaluate(()=>({state:lightReview.activation.getStatus(),samples})));throw error;});
  const ramp=await state(page);assert.equal(ramp.progress,1);
  await page.waitForFunction(()=>lightReview.activation.getGain()===1);
  await page.waitForTimeout(100);const night=await state(page);assert.equal(night.uniform,1);assert.deepEqual(night.camera,day.camera);
  assert(await page.evaluate(()=>{const s=surface();return s.props.data===retained.data&&s.state.atlasEntry===retained.atlas&&s.state.polygonTesselator===retained.geometry&&s.getModels().every((m,i)=>m===retained.models[i])&&retained.fixtures.every(r=>{const l=reviewDeck().layerManager.getLayers().find(l=>l.id===r.id);return l.props.data===r.data&&l.getModels().every((m,i)=>m===r.models[i]);});}));
  const samples=await page.evaluate(()=>samples),rampSamples=samples.filter(s=>s.gain>0&&s.gain<1);
  assert(rampSamples.every(s=>s.progress===1));assert(new Set(rampSamples.map(s=>s.renders)).size<=2);
  results.push({case:'normal activation, zero gain before endpoint, stable atlas/models/data, no React ramp loop',day,sunset,ramp,night,
   activationFirstMs:rampSamples[0].time,activationLastMs:samples.find(s=>s.gain===1).time,rampReactRenderCounts:[...new Set(rampSamples.map(s=>s.renders))]});
  await page.screenshot({path:`${out}/architectural-night.png`});
  // Move the camera during dimming; the lighting clock must not restore it.
  await page.evaluate(()=>{environmentReview.setNight(false);environmentReview.setView({...environmentReview.view,bearing:43,zoom:18.7});});
  await page.waitForFunction(()=>lightReview.activation.getGain()<.85&&lightReview.activation.getGain()>.05);
  const dim=await state(page);await page.evaluate(()=>environmentReview.setNight(true));
  await page.waitForFunction(()=>lightReview.activation.getGain()===1&&environmentReview.environment.fullNight);
  assert.equal((await state(page)).camera.bearing,43);results.push({case:'mid-ramp reversal and manual camera preservation',dim,restored:await state(page)});
  await page.evaluate(()=>environmentReview.preset.selectPreset('gis'));await page.waitForTimeout(700);
  assert.equal((await state(page)).gain,1);assert.equal((await state(page)).progress,1);
  await page.screenshot({path:`${out}/gis-night.png`});results.push({case:'preset switch preserves full-night progress and gain',passed:true});
  const counts=[19,20,23,16,23,19,18,0];
  for(const preset of ['architectural','gis']){
   await page.evaluate(p=>environmentReview.preset.selectPreset(p),preset);await page.waitForTimeout(650);
   for(const floor of [0,1,2,3,4,5,6,7,'all']){
    await page.evaluate(f=>environmentReview.setFloor(f),floor);await page.waitForTimeout(400);
    await page.waitForFunction(n=>(reviewDeck().props.layers.find(l=>l.id==='interior-light-fixtures')?.props.data.length||0)===n,floor==='all'?138:counts[floor]);
    results.push({case:'floor and preset',floor,preset,...await state(page)});
   }
  }
  assert.equal(requests,1);
  await page.evaluate(()=>environmentReview.setFloor(1));await page.waitForTimeout(450);
  await page.emulateMedia({reducedMotion:'reduce'});
  for(let i=0;i<4;i++){
   await page.evaluate(()=>environmentReview.setNight(false));await page.waitForFunction(()=>lightReview.activation.getGain()===0&&environmentReview.environment.progress===0);
   await page.evaluate(()=>environmentReview.setNight(true));await page.waitForFunction(()=>lightReview.activation.getGain()===1&&environmentReview.environment.progress===1);
  }
  assert.equal(requests,1);results.push({case:'four reduced-motion cycles reuse one combined request',requests});
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>environmentReview.setNight(false));await page.waitForTimeout(100);
  await page.evaluate(()=>{window.oldActivation=lightReview.activation;unmountEnvironmentReview();});await page.waitForTimeout(200);
  assert.equal(await page.locator('canvas').count(),0);assert.equal(await page.evaluate(()=>oldActivation.getGain()),0);
  results.push({case:'unmount during ramp disposes controller and canvases',passed:true});await page.close();

  const delayed=await open();let release;
  const hold=new Promise(resolve=>{release=resolve;});
  await delayed.route('**/interior_lights.geojson',async route=>{await hold;await route.continue();});
  await ready(delayed);await delayed.evaluate(()=>environmentReview.setNight(true));
  await delayed.waitForFunction(()=>environmentReview.environment.fullNight);const pending=await state(delayed);
  assert.equal(pending.status,'loading');assert.equal(pending.gain,0);
  assert(await delayed.getByRole('status').isVisible());
  await delayed.evaluate(()=>environmentReview.setView({...environmentReview.view,bearing:61}));
  const released=Date.now();release();await delayed.waitForFunction(()=>lightReview.activation.getGain()===1);
  const loaded=await state(delayed);assert.equal(loaded.camera.bearing,61);assert(Date.now()-released>=1000);
  results.push({case:'late data waits at ambient night, then ramps without blocking camera',pending,loaded,afterReleaseMs:Date.now()-released});await delayed.close();

  const failed=await open();let attempts=0;
  await failed.route('**/interior_lights.geojson',route=>++attempts===1?route.fulfill({status:503,body:'unavailable'}):route.continue());
  await ready(failed);await failed.emulateMedia({reducedMotion:'reduce'});await failed.evaluate(()=>environmentReview.setNight(true));
  await failed.getByRole('button',{name:'Retry interior lights'}).waitFor();
  const failure=await state(failed);assert.equal(failure.gain,0);assert.equal(failure.progress,1);
  await failed.getByRole('button',{name:'Retry interior lights'}).click();await failed.waitForFunction(()=>lightReview.activation.getGain()===1);
  assert.equal(attempts,2);results.push({case:'failure leaves ambient night; explicit retry recovers with reduced motion',failure,recovered:await state(failed),attempts});await failed.close();
  assert.deepEqual(errors,[]);
 }catch(e){results.push({failure:e.stack});throw e;}
 finally{fs.writeFileSync(`${out}/browser.json`,JSON.stringify({results,errors,requests},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
