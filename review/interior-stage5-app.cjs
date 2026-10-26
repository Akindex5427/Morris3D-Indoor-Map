const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/GLSL|DeckGL error/.test(m.text()))errors.push(m.text());});
 await page.addInitScript(()=>{window.decks=()=>[...document.querySelectorAll('#deckgl-wrapper')].map(node=>{
  let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}
 }).filter(Boolean);});
 const states=()=>page.evaluate(()=>decks().map(d=>{const v=d.getViewports()[0];return {camera:[v.longitude,v.latitude,v.zoom,v.pitch,v.bearing],gain:d.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill')?.props.getFixtureGain?.(),environment:d.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill')?.props.environment.progress};}));
 const pause=async()=>{const slider=page.getByRole('slider',{name:'Preview progress'});await slider.press(Number(await slider.inputValue())>=.99?'ArrowLeft':'ArrowRight');await page.getByTitle('Resume preview',{exact:true}).waitFor();};
 try {
  await page.goto('http://127.0.0.1:3004');await page.waitForFunction(()=>decks()[0]?.getViewports()[0]?.longitude < -89,null,{timeout:60000});
  await page.locator('#animation-toggle').uncheck();await page.waitForTimeout(1700);
  const day=await states();assert.equal(day[0].environment,0);await page.screenshot({path:'docs/stage-5-interior/app-day.png'});
  await page.locator('#night-mode-toggle').check();await page.waitForFunction(()=>decks()[0].layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill')?.props.environment.progress===1&&decks()[0].layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill')?.props.getFixtureGain?.()===1);
  const night=await states();assert.deepEqual(night[0].camera,day[0].camera);await page.screenshot({path:'docs/stage-5-interior/app-night.png'});results.push({case:'main app F1 day/night',day,night});
  await page.locator('#night-mode-toggle').uncheck();
  await page.getByRole('button',{name:'Plan Route',exact:true}).click();
  await page.locator('#planner-floor-select').selectOption('');
  await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
  await page.getByPlaceholder('Search end room...').fill('0362');await page.locator('.route-suggestion-item-clickable').first().click();
  await page.getByRole('button',{name:'Find Route',exact:true}).click();
  await page.waitForFunction(()=>decks().length>=2,null,{timeout:60000});await page.waitForTimeout(3500);await pause();
  const baseline=await states(),progress=await page.getByRole('slider',{name:'Preview progress'}).inputValue();
  await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('#night-mode-toggle').check();
  await page.waitForTimeout(2900);const sunset=await states();
  assert(sunset.every(s=>s.environment>.2&&s.environment<.65));assert(sunset.every(s=>s.environment===sunset[0].environment));
  assert.deepEqual(sunset.map(s=>s.camera),baseline.map(s=>s.camera));assert.equal(await page.getByRole('slider',{name:'Preview progress'}).inputValue(),progress);
  results.push({case:'shared sunset across paused route panels',baseline,sunset,previewProgress:progress});
  await page.evaluate(()=>{window.rampRefs=decks().map(d=>{const s=d.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill');return {data:s.props.data,atlas:s.state.atlasEntry,models:s.getModels(),gain:s.props.getFixtureGain};});});
  await page.waitForFunction(()=>decks().every(d=>{const s=d.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill');return s?.props.environment.progress===1&&s.props.getFixtureGain()>.1&&s.props.getFixtureGain()<.95;}));
  const ramp=await states();assert(ramp.every(s=>s.gain===ramp[0].gain));assert.deepEqual(ramp.map(s=>s.camera),baseline.map(s=>s.camera));
  assert.equal(await page.getByRole('slider',{name:'Preview progress'}).inputValue(),progress);
  assert(await page.evaluate(()=>decks().every((d,i)=>{const s=d.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill'),r=rampRefs[i];return s.props.data===r.data&&s.state.atlasEntry===r.atlas&&s.getModels().every((m,j)=>m===r.models[j])&&s.props.getFixtureGain===r.gain;})));
  results.push({case:'shared activation ramp across paused route panels; cameras, preview and GPU resources preserved',ramp});
  await page.waitForFunction(()=>decks().every(d=>d.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill')?.props.getFixtureGain?.()===1));
  await page.locator('#night-mode-toggle').uncheck();await page.waitForFunction(()=>decks().every(d=>d.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill')?.props.environment.progress===0));
  assert.deepEqual((await states()).map(s=>s.camera),baseline.map(s=>s.camera));
  await page.getByTitle('Resume preview',{exact:true}).click();await page.waitForTimeout(500);
  const before=Number(await page.getByRole('slider',{name:'Preview progress'}).inputValue());await page.locator('#night-mode-toggle').check();await page.waitForTimeout(1000);
  const after=Number(await page.getByRole('slider',{name:'Preview progress'}).inputValue());assert(after>before);results.push({case:'preview continues through sunset',before,after});
  await page.waitForFunction(()=>decks().every(d=>d.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill')?.props.environment.progress===1));
  const rampBefore=Number(await page.getByRole('slider',{name:'Preview progress'}).inputValue());
  await page.waitForFunction(()=>decks().every(d=>d.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill')?.props.getFixtureGain?.()===1));
  const rampAfter=Number(await page.getByRole('slider',{name:'Preview progress'}).inputValue());assert(rampAfter>rampBefore);
  results.push({case:'preview continues during full-night light activation',rampBefore,rampAfter});await pause();
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(200);
  await page.getByRole('button',{name:'Stacked overview',exact:true}).click();await page.waitForFunction(()=>decks().length===1);await page.waitForTimeout(2000);await pause();
  const stack=await states();assert.equal(stack[0].environment,1);
  await page.locator('#night-mode-toggle').uncheck();await page.waitForFunction(()=>decks()[0].layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill')?.props.environment.progress===0);const stackDay=await states();assert.deepEqual(stackDay[0].camera,stack[0].camera);
  results.push({case:'F-ALL route camera preserved',stack,stackDay});
  assert.deepEqual(errors,[]);
 }catch(e){results.push({failure:e.stack});throw e;}
 finally{fs.writeFileSync('docs/stage-5-interior/app-browser.json',JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
