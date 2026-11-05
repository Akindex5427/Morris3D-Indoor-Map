const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const out='docs/interactive-overlap';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),results=[],errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
 const record=results.push.bind(results);results.push=(item)=>{console.log(item.phase,item.floor??'',item.message??'');return record(item);};
 await page.addInitScript(()=>{
  window.nativeSpeechSupported=!!window.speechSynthesis;
  window.analysisMessages=[];window.analysisSent=[];
  const WorkerOriginal=window.Worker;
  window.Worker=class extends WorkerOriginal{constructor(...args){super(...args);this.addEventListener('message',e=>{if(e.data?.result)window.analysisMessages.push(e.data);});}postMessage(data,...args){if(data?.feature)window.analysisSent.push(data.id);return super.postMessage(data,...args);}};
  window.testDeck=()=>{const node=document.querySelector('#deckgl-wrapper');let f=node?.[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}};
  window.testRoomLayer=()=>window.testDeck()?.props.layers.find(l=>/^indoor-building-(night-)?layer$/.test(l.id));
  window.speechCalls=[];window.voiceListeners=new Set();
  window.localVoices=[{localService:true,lang:'en-US',name:'Controlled test voice',default:true}];
  window.speechMock={paused:false,getVoices:()=>window.localVoices,
   speak(u){window.currentUtterance=u;window.speechCalls.push({action:'speak',text:u.text});u.onstart?.();},
   cancel(){window.speechCalls.push({action:'cancel'});window.currentUtterance=null;},
   pause(){this.paused=true;window.currentUtterance?.onpause?.();},resume(){this.paused=false;window.currentUtterance?.onresume?.();},
   addEventListener(_,f){window.voiceListeners.add(f);},removeEventListener(_,f){window.voiceListeners.delete(f);}};
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:window.speechMock});
  Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
 });
 const ready=async()=>{await page.waitForFunction(()=>window.testDeck()?.getViewports()[0]?.longitude < -89,null,{timeout:60000});};
 const panel=()=>page.locator('#panel-correspondence');
 const camera=()=>page.evaluate(()=>{const v=window.testDeck().getViewports()[0];return {longitude:v.longitude,latitude:v.latitude,zoom:v.zoom,bearing:v.bearing,pitch:v.pitch};});
 const select=async(query,floor)=>{
  await page.getByRole('combobox',{name:'Search rooms on all floors'}).fill(query);
  await page.getByRole('option').filter({hasText:`F${floor}`}).first().click();
  await page.waitForFunction(f=>document.querySelector('.floor-btn.active')?.textContent===`F${f}`,floor,{timeout:30000});
 };
 const result=()=>page.evaluate(()=>window.analysisMessages.at(-1)?.result);
 const waitAnalysis=async(floor)=>{
  await page.waitForFunction(f=>document.querySelector('#panel-correspondence')?.getAttribute('aria-busy')==='false'&&window.analysisMessages.at(-1)?.result.status==='ready'&&window.analysisMessages.at(-1)?.result.reference.floor===f,floor,{timeout:60000});
  return result();
 };
 const open=async(floor)=>{await page.getByRole('button',{name:'Rooms Above & Below',exact:true}).click();return waitAnalysis(floor);};
 const choose=async(key,keyboard=false)=>{
  const cards=panel().locator('button[data-feature-key]');const i=await cards.evaluateAll((nodes,k)=>nodes.findIndex(n=>n.dataset.featureKey===k),key);assert(i>=0);
  if(keyboard){await cards.nth(i).focus();await cards.nth(i).press('Enter');}else await cards.nth(i).click();
  await page.waitForFunction(k=>window.testDeck()?.props.layers.find(l=>l.id==='room-overlap-intersection-fill')?.props.data.features[0]?.properties.candidateKey===k,key);
  assert.equal(await panel().locator('.correspondence-result[aria-pressed="true"]').count(),1);
 };
 const overlays=()=>page.evaluate(()=>{
  const d=window.testDeck(),layers=d.props.layers;
  return {intersection:layers.find(l=>l.id==='room-overlap-intersection-fill')?.props.data.features||[],
   outlines:layers.find(l=>l.id==='room-correspondence-outline')?.props.data||[],
   ids:layers.filter(l=>/room-(overlap|correspondence)/.test(l.id)).map(l=>l.id),
   depth:layers.filter(l=>/room-(overlap|correspondence)/.test(l.id)).map(l=>l.props.parameters),
   note:document.querySelector('.overlap-map-note')?.textContent};
 });
 const geometryMatches=(display,match)=>{
  assert(display.intersection.length);assert.equal(new Set(display.intersection.map(f=>f.properties.candidateKey)).size,1);
  for(const feature of display.intersection){
   assert.deepEqual(feature.geometry.coordinates.map(p=>p.map(r=>r.map(v=>v.slice(0,2)))),match.intersectionGeometry.coordinates);
   assert.equal(feature.properties.intersectionArea,match.intersectionArea);assert.equal(feature.properties.referencePercent,match.referencePercent);
  }
  assert(display.depth.every(p=>p.depthTest===false&&p.depthMask===false));
 };
 const floor=()=>page.locator('.floor-btn.active').innerText();
 try{
  await page.goto(process.env.REVIEW_URL||'http://127.0.0.1:3004');await ready();await page.locator('#animation-toggle').uncheck();
  await select('0420D',4);await page.waitForTimeout(500);const analysis=await open(4);
  const above=analysis.groups.find(g=>g.direction==='above').matches.find(m=>m.name&&m.name!=='Floor');
  const below=analysis.groups.find(g=>g.direction==='below').matches[0];assert(above&&below);
  const initial=await camera(),sent=await page.evaluate(()=>window.analysisSent.length);
  await page.evaluate(()=>{const layer=window.testDeck().layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill');window.overlapBuildingBaseline={data:layer.props.data,models:layer.getModels(),tessellator:layer.state.polygonTesselator};});
  await choose(above.key,true);let data=await overlays();geometryMatches(data,above);
  assert.equal(await floor(),'F4');assert.deepEqual(await camera(),initial);
  assert(data.note.includes('F5 footprint projected onto F4'));
  assert(data.outlines.some(p=>p.role==='reference'&&!p.projected));assert(data.outlines.some(p=>p.role==='candidate'&&p.projected));
  assert((await panel().locator('.correspondence-reference').textContent()).includes(analysis.reference.label));
  await page.screenshot({path:`${out}/above-single.png`});
  results.push({phase:'f4-above-keyboard-exact-intersection-no-floor-camera-change',passed:true,reference:analysis.reference,match:above});
  await choose(below.key);data=await overlays();geometryMatches(data,below);
  assert.equal(await floor(),'F4');assert.deepEqual(await camera(),initial);
  assert(data.note.includes('F3 footprint projected onto F4'));assert(data.outlines.some(p=>p.role==='candidate'&&p.color.join(',')==='119,117,220'));
  await page.screenshot({path:`${out}/below-single.png`});
  for(const match of analysis.groups.flatMap(g=>g.matches)){await choose(match.key);geometryMatches(await overlays(),match);}
  for(let i=0;i<8;i++)await choose(i%2?above.key:below.key);
  assert.equal(await page.evaluate(()=>window.analysisSent.length),sent);
  assert(await page.evaluate(()=>{const l=window.testDeck().layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill'),b=window.overlapBuildingBaseline;return l.props.data===b.data&&l.state.polygonTesselator===b.tessellator&&l.getModels().every((m,i)=>m===b.models[i]);}));
  results.push({phase:'below-multiple-results-rapid-switch-model-and-analysis-reuse',passed:true});
  await page.getByRole('button',{name:'Clear Highlight',exact:true}).click();
  await page.waitForFunction(()=>!window.testDeck().props.layers.some(l=>l.id==='room-overlap-intersection-fill'));
  assert.equal(await panel().locator('.correspondence-result[aria-pressed="true"]').count(),0);
  assert((await overlays()).outlines.every(p=>p.role==='reference'));assert.equal(await floor(),'F4');assert.deepEqual(await camera(),initial);
  assert((await page.getByRole('region',{name:'Room details'}).textContent()).includes(analysis.reference.label));
  results.push({phase:'clear-retains-reference-floor-camera',passed:true});
  await choose(above.key);
  const map=page.getByRole('region',{name:'Interactive map, floor 4',exact:true});await map.focus();await map.press('ArrowUp');await map.press('ArrowRight');
  const oriented=await camera();await choose(below.key);assert.deepEqual(await camera(),oriented);
  await page.getByRole('button',{name:'Focus on Overlap',exact:true}).click();await page.waitForTimeout(700);
  const focused=await camera();assert.equal(focused.pitch,oriented.pitch);assert.equal(focused.bearing,oriented.bearing);assert.notDeepEqual(focused,oriented);
  assert(await page.evaluate(()=>{const d=window.testDeck(),v=d.getViewports()[0],p=d.props.layers.find(l=>l.id==='room-correspondence-outline').props.data.flatMap(r=>r.path).map(p=>v.project(p));return p.every(([x,y])=>x>=0&&x<=v.width&&y>=0&&y<=v.height);}));
  await page.getByRole('button',{name:'Zoom out',exact:true}).click();const manual=await camera();await choose(above.key);assert.deepEqual(await camera(),manual);
  results.push({phase:'explicit-focus-keeps-orientation-manual-navigation-keeps-control',passed:true});
  await page.getByRole('button',{name:'Inspect pair in F-ALL'}).click();
  await page.waitForFunction(()=>window.testDeck().props.layers.find(l=>l.id==='room-overlap-intersection-fill')?.props.data.features.length===2);
  data=await overlays();geometryMatches(data,above);assert.deepEqual(await camera(),manual);
  assert.deepEqual(data.intersection.map(f=>f.properties.floor),[4,5]);
  assert.notEqual(data.intersection[0].geometry.coordinates[0][0][0][2],data.intersection[1].geometry.coordinates[0][0][0][2]);
  await page.getByRole('button',{name:'Focus on Overlap',exact:true}).click();await page.waitForTimeout(700);
  const stackCamera=await camera();await choose(below.key);data=await overlays();geometryMatches(data,below);assert.deepEqual(await camera(),stackCamera);
  assert.deepEqual(data.intersection.map(f=>f.properties.floor),[4,3]);
  await page.screenshot({path:`${out}/stacked-day.png`});
  results.push({phase:'stacked-shared-footprint-two-actual-elevations',passed:true,elevations:data.intersection.map(f=>({floor:f.properties.floor,z:f.geometry.coordinates[0][0][0][2]}))});
  const stackSnapshot=JSON.stringify(data.intersection),beforeTheme=await page.evaluate(()=>window.analysisSent.length);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('#night-mode-toggle').check();await page.waitForTimeout(1800);
  assert.equal(JSON.stringify((await overlays()).intersection),stackSnapshot);await page.screenshot({path:`${out}/transition.png`});
  await page.waitForTimeout(8000);
  for(const preset of ['architectural','gis']){
   await page.locator(`input[name="night-visualization-style"][value="${preset}"]`).check({force:true});
   for(const mode of ['uniform','original']){await page.locator('#room-color-mode').selectOption(mode);await page.waitForTimeout(250);assert.equal(JSON.stringify((await overlays()).intersection),stackSnapshot);}
  }
  await page.screenshot({path:`${out}/stacked-night.png`});
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#night-mode-toggle').uncheck();await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>window.analysisSent.length),beforeTheme);
  results.push({phase:'cinematic-transition-both-presets-color-modes-no-reanalysis',passed:true});
  await page.getByRole('button',{name:'F2',exact:true}).click();await page.waitForTimeout(400);
  assert.equal((await overlays()).intersection.length,0);assert(await page.getByRole('button',{name:'Focus on Overlap'}).isDisabled());
  await page.getByRole('button',{name:'F3',exact:true}).click();await page.waitForTimeout(400);geometryMatches(await overlays(),below);
  assert((await overlays()).note.includes('F4 footprint projected onto F3'));
  await page.getByRole('button',{name:'F4',exact:true}).click();await page.waitForTimeout(400);geometryMatches(await overlays(),below);
  results.push({phase:'manual-floor-switching-projection-hidden-on-unrelated-floor',passed:true});
  // Manual floor navigation intentionally clears ordinary room selection in
  // the existing app. Return to the pinned reference before testing reopen.
  await panel().locator('.correspondence-reference').click();
  await page.getByRole('button',{name:'Close room correspondence'}).click();await page.waitForTimeout(100);
  assert.equal((await overlays()).ids.length,0);const reopened=await open(4);assert(reopened.cacheHit);assert.equal((await overlays()).intersection.length,0);
  results.push({phase:'close-reopen-no-stale-highlight-cached-geometry',passed:true});
  for(const [query,f,adj] of [['dewey',0,1],['0754',7,6]]){
   await select(query,f);await page.waitForTimeout(350);const r=await waitAnalysis(f);const m=r.groups[0].matches[0];assert.equal(m.floor,adj);const c=await camera();
   await choose(m.key);geometryMatches(await overlays(),m);assert.equal(await floor(),`F${f}`);assert.deepEqual(await camera(),c);
  }
  // The candidate Lc Folios has several distinct, identically named F4 matches.
  await select('Lc Folios',5);await page.waitForTimeout(350);const duplicateResult=await waitAnalysis(5);
  const duplicates=duplicateResult.groups.flatMap(g=>g.matches).filter(m=>m.label==='Group Study 0420D');assert(duplicates.length>1);
  for(const m of duplicates){await choose(m.key);geometryMatches(await overlays(),m);}
  results.push({phase:'boundary-floors-and-duplicate-names',passed:true,duplicateKeys:duplicates.map(m=>m.key)});
  await select('0174',1);await waitAnalysis(1);
  await page.getByRole('button',{name:'Plan Route',exact:true}).click();
  await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
  await page.getByPlaceholder('Search end room...').fill('0181');await page.locator('.route-suggestion-item-clickable').first().click();
  await page.getByRole('button',{name:'Find Route',exact:true}).click();await page.waitForTimeout(1800);
  await page.waitForFunction(()=>Object.values(window.testDeck().viewManager.controllers).every(controller=>!controller.transitionManager.transition.inProgress),null,{timeout:15000});
  const route=()=>page.evaluate(require(process.cwd()+'/review/route-model-snapshot.cjs').snapshotRoute),routeBefore=await route();assert(routeBefore.length);
  const routeAnalysis=await result(),routeCamera=await camera();await choose(routeAnalysis.groups.find(g=>g.matches.length).matches[0].key);
  assert.deepEqual(await route(),routeBefore);assert.deepEqual(await camera(),routeCamera);
  const order=await page.evaluate(()=>window.testDeck().props.layers.map(l=>l.id));
  assert(order.indexOf('room-overlap-intersection-fill')<order.findIndex(id=>id.startsWith('route-')));
  await page.getByRole('button',{name:'Clear Highlight'}).click();assert.deepEqual(await route(),routeBefore);
  results.push({phase:'route-geometry-camera-and-draw-priority-preserved',passed:true});
  await page.setViewportSize({width:390,height:844});await page.reload();await ready();await page.locator('.mobile-drawer-toggle').click();
  await page.locator('#animation-toggle').uncheck();await select('0420D',4);const mobile=await open(4);
  const mobileMatch=mobile.groups[0].matches.find(m=>m.label!=='Floor');await choose(mobileMatch.key);
  assert.equal(await floor(),'F4');assert(await panel().evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.screenshot({path:`${out}/mobile-card.png`});
  await page.getByRole('button',{name:'Focus on Overlap'}).click();await page.waitForTimeout(700);geometryMatches(await overlays(),mobileMatch);
  const notice = await page.locator('.overlap-map-note').boundingBox();
  const popup = await page.locator('.room-info-popup-floating').boundingBox();
  const menu = await page.locator('.mobile-drawer-toggle').boundingBox();
  assert(notice && notice.y >= menu.y + menu.height && (!popup || notice.y + notice.height <= popup.y));
  await page.screenshot({path:`${out}/mobile-map.png`});
  results.push({phase:'mobile-card-and-explicit-focus',passed:true});
  assert.deepEqual(errors,[]);
 }catch(error){results.push({phase:'failure',message:error.message});await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
