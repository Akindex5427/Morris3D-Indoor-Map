const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({reducedMotion:'reduce'});let requests=0;
 page.on('request',r=>{if(r.url().endsWith('/interior_lights.geojson'))requests++;});
 try{
  await page.goto('http://127.0.0.1:3004/review/interior-stage5.html');await page.waitForFunction(()=>window.lightReview);
  await page.evaluate(()=>environmentReview.setNight(true));await page.waitForFunction(()=>lightReview.activation.getGain()===1);
  await page.evaluate(()=>{
   const n=document.querySelector('#deckgl-wrapper');let f=n[Object.keys(n).find(k=>k.startsWith('__reactFiber'))];
   while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)window.resourceDeck=h.memoizedState.current.deck;h=h.next;}f=f.return;}
   window.resourceRefs=resourceDeck.layerManager.getLayers().filter(l=>l.id.endsWith('polygons-fill')||l.id.startsWith('interior-light-')).map(l=>({id:l.id,data:l.props.data,models:l.getModels(),atlas:l.state.atlasEntry}));
  });
  for(let cycle=0;cycle<10;cycle++)for(const night of [false,true]){
   await page.evaluate(n=>environmentReview.setNight(n),night);
   await page.waitForFunction(gain=>lightReview.activation.getGain()===gain,Number(night));
   await page.waitForTimeout(80);
   assert(await page.evaluate(()=>resourceRefs.every(r=>{const l=resourceDeck.layerManager.getLayers().find(l=>l.id===r.id);return l&&l.props.data===r.data&&l.state.atlasEntry===r.atlas&&l.getModels().every((m,i)=>m===r.models[i]);})));
  }
  assert.equal(requests,1);
  await page.evaluate(()=>unmountEnvironmentReview());await page.waitForTimeout(100);
  const deleted=await page.evaluate(()=>resourceRefs.filter(r=>r.atlas).every(r=>r.atlas.texture.handle===null));assert(deleted);
  const cycleRequests=requests;
  let attempts=0;
  await page.route('**/interior_lights.geojson',route=>++attempts===1?route.fulfill({status:503,body:'unavailable'}):route.continue());
  await page.reload();await page.waitForFunction(()=>window.lightReview);
  await page.evaluate(()=>environmentReview.setNight(true));await page.getByRole('button',{name:'Retry interior lights'}).waitFor();
  await page.screenshot({path:'docs/stage-5-interior/loading-failure.png'});
  await page.evaluate(()=>environmentReview.setFloor(2));await page.waitForTimeout(800);assert.equal(attempts,1);
  await page.evaluate(()=>environmentReview.setNight(false));await page.waitForFunction(()=>environmentReview.environment.progress===0);
  await page.evaluate(()=>environmentReview.setNight(true));await page.waitForFunction(()=>lightReview.activation.getGain()===1);assert.equal(attempts,2);
  fs.writeFileSync('docs/stage-5-interior/resources.json',JSON.stringify({cycles:10,requests:cycleRequests,modelDataAndAtlasIdentityPreserved:true,
   atlasTexturesDeletedOnUnmount:deleted,floorSwitchDoesNotRetryFailure:true,newNightRequestRetriesOnce:true},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
