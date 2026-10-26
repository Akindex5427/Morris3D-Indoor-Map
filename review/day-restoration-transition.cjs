const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),results=[],errors=[];
 fs.mkdirSync('docs/day-restoration',{recursive:true});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error' && /GLSL|DeckGL error|Error:.*(paint|fog|light)/.test(m.text()) && errors.length<12)errors.push(m.text());});
 await page.addInitScript(()=>{window.reviewRefs=()=>{let f=document.querySelector('#deckgl-wrapper');f=f?.[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];let deck,map;while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)deck=h.memoizedState.current.deck;if(h.memoizedState?.current?.getMap)map=h.memoizedState.current.getMap();h=h.next;}f=f.return;}return {deck,map};};});
 try {
  await page.goto('http://127.0.0.1:3004/review/environment-stage4.html');
  await page.waitForFunction(()=>window.environmentReview&&window.reviewRefs().deck?.layerManager?.getLayers().some(l=>l.id==='indoor-building-layer-polygons-fill'),null,{timeout:60000});
  await page.waitForTimeout(1800);
  await page.evaluate(()=>{const d=reviewRefs().deck,l=d.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill');window.baseline={view:JSON.stringify(environmentReview.view),data:l.props.data,models:l.getModels(),atlas:l.state.atlasEntry,geometry:l.state.polygonTesselator,positions:l.getAttributeManager().getAttributes().positions.getBuffer(),route:environmentReview.routePath,focus:environmentReview.focus};});
  for(const progress of [0,.36,.7,1,.7,.36,0]) {
   await page.evaluate(p=>environmentReview.setManual(p),progress);await page.waitForTimeout(350);
   const r=await page.evaluate(()=>{const {deck:d,map}=reviewRefs(),l=d.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill');return {progress:environmentReview.appearance.progress,viewUnchanged:JSON.stringify(environmentReview.view)===baseline.view,dataSame:l.props.data===baseline.data,modelsSame:l.getModels().every((m,i)=>m===baseline.models[i]),atlasSame:l.state.atlasEntry===baseline.atlas,geometrySame:l.state.polygonTesselator===baseline.geometry,positionsSame:l.getAttributeManager().getAttributes().positions.getBuffer()===baseline.positions,routeSame:environmentReview.routePath===baseline.route,focusSame:environmentReview.focus===baseline.focus,mapLoaded:map?.isStyleLoaded(),style:map?.isStyleLoaded()?map.getStyle()?.name:null,layers:d.layerManager.getLayers().length,uniforms:l.getModels()[0]?.getUniforms?.()};});
   delete r.uniforms;
   const bindings=await page.evaluate(()=>{const l=reviewRefs().deck.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill');return l.getModels().map(m=>({side:m.id.endsWith('-side'),instanced:l.context.gl.getAttribLocation(m.program.handle,'instanceNightColor'),vertex:l.context.gl.getAttribLocation(m.program.handle,'nightColor')}));});
   assert(bindings.every(b=>b.side?b.instanced>=0&&b.vertex===-1:b.vertex>=0&&b.instanced===-1));r.bindings=bindings;
   assert(r.viewUnchanged&&r.dataSame&&r.modelsSame&&r.atlasSame&&r.geometrySame&&r.positionsSame&&r.routeSame&&r.focusSame,JSON.stringify(r));results.push(r);
   await page.screenshot({path:`docs/day-restoration/map-progress-${progress}.png`});
  }
  await page.evaluate(()=>{environmentReview.setManual(null);environmentReview.setNight(true);});
  await page.waitForTimeout(2800);
  const before=await page.evaluate(()=>environmentReview.environment.progress);assert(before>.2&&before<.65);
  await page.evaluate(()=>environmentReview.setNight(false));await page.waitForTimeout(350);
  const after=await page.evaluate(()=>environmentReview.environment.progress);assert(after<before&&after>0);results.push({case:'mid-transition reversal',before,after});
  await page.waitForFunction(()=>environmentReview.environment.progress===0);
  await page.evaluate(()=>{environmentReview.setNight(true);window.transitionStarted=performance.now();});
  await page.waitForFunction(()=>environmentReview.environment.fullNight,null,{timeout:12000});
  const elapsed=await page.evaluate(()=>performance.now()-transitionStarted);assert(elapsed>=7900&&elapsed<10000);results.push({case:'complete transition',elapsedMs:elapsed});
  await page.evaluate(()=>environmentReview.preset.selectPreset('gis'));await page.waitForTimeout(650);
  assert.equal(await page.evaluate(()=>environmentReview.environment.progress),1);results.push({case:'preset at night preserves progress',passed:true});
  for(const floor of [0,1,2,3,4,5,6,7,'all']) {
   await page.evaluate(f=>environmentReview.setFloor(f),floor);await page.waitForTimeout(450);
   const r=await page.evaluate(()=>{const l=reviewRefs().deck.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill');return {floor:environmentReview.floor,surface:!!l,progress:l?.props.environment.progress,nightColors:l?.getAttributeManager().getAttributes().nightColor.value?.slice(0,4)}});
   assert(r.surface&&r.progress===1);results.push(r);
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>environmentReview.setNight(false));
  await page.waitForFunction(()=>environmentReview.environment.progress===0);results.push({case:'reduced motion',passed:true});
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>environmentReview.setNight(true));await page.waitForTimeout(300);
  await page.evaluate(()=>unmountEnvironmentReview());await page.waitForTimeout(250);results.push({case:'unmount mid-transition',canvasCount:await page.locator('canvas').count()});
  assert.deepEqual(errors,[]);
 } catch(e){results.push({failure:e.stack});throw e;}
 finally {fs.writeFileSync('docs/day-restoration/transition-browser.json',JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
