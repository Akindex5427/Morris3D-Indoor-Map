const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const out=process.env.CORRESPONDENCE_REVIEW_OUTPUT||'docs/stage-6-correspondence';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),results=[],errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('framenavigated',f=>{if(f===page.mainFrame())console.log('Page loaded',f.url());});page.on('request',r=>{if(/rooms-.*geojson/.test(r.url()))requests.push(r.url());});
 await page.addInitScript(()=>{
  window.analysisMessages=[];window.analysisSent=[];
  const OriginalWorker=window.Worker;
  window.Worker=class extends OriginalWorker {constructor(...args){super(...args);this.addEventListener('message',event=>{if(event.data?.result)window.analysisMessages.push(event.data);});}postMessage(data,...args){if(data?.feature)window.analysisSent.push({id:data.id,datasets:!!data.datasets,key:data.feature.properties.__roomSearchKey});return super.postMessage(data,...args);}};
  window.testDeck=()=>{const node=document.querySelector('#deckgl-wrapper');let f=node?.[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}};
  window.testRoomLayer=()=>window.testDeck()?.props.layers.find(l=>/^indoor-building-(night-)?layer$/.test(l.id));
 });
 const camera=()=>page.evaluate(()=>{const v=window.testDeck().getViewports()[0];return {longitude:v.longitude,latitude:v.latitude,zoom:v.zoom,bearing:v.bearing,pitch:v.pitch};});
 const ready=async()=>{await page.waitForFunction(()=>window.testDeck()?.getViewports()[0]?.longitude < -89,null,{timeout:60000});if(page.viewportSize().width>768)await page.locator('#animation-toggle').uncheck();};
 const select=async(query,floor)=>{
  await page.getByRole('combobox',{name:'Search rooms on all floors'}).fill(query);
  await page.getByRole('option').filter({hasText:`F${floor}`}).first().click();
  await page.waitForFunction(floor=>document.querySelector('.floor-btn.active')?.textContent===`F${floor}`&&window.testRoomLayer()?.props.data.features.every(f=>Number(f.properties.floor??f.properties.level)===floor),floor,{timeout:60000});
  await page.waitForFunction(()=>window.testDeck().getViewports()[0].pitch===0,null,{timeout:30000});await page.waitForTimeout(200);
 };
 const analyze=async()=>{
  const n=await page.evaluate(()=>window.analysisMessages.length);
  await page.getByRole('button',{name:'Rooms Above & Below',exact:true}).click();
  await page.waitForFunction(n=>window.analysisMessages.length>n||document.querySelector('#panel-correspondence')?.textContent.includes('Analysis unavailable'),n,{timeout:60000});
  const r=await page.evaluate(()=>window.analysisMessages.at(-1)?.result||{status:'error',message:document.querySelector('#panel-correspondence')?.textContent});
  assert.notEqual(r.status,'error',r.message);console.log('Analysis',r.status,r.reference?.label,r.analysisMs);return r;
 };
 try{
  await page.goto(process.env.CORRESPONDENCE_REVIEW_URL||'http://127.0.0.1:3001');await ready();
  await select('0362',3);const before=await camera();const result=await analyze();
  assert.equal(result.status,'ready');assert.equal(result.groups.length,7);assert(result.groups.every(g=>g.available));
  const sourceReport=JSON.parse(fs.readFileSync('docs/stage-6-correspondence/data-audit.json'));
  assert(Math.abs(result.reference.area-sourceReport.example.reference.area)<1e-6);
  assert.deepEqual(result.groups.map(g=>g.matches.map(r=>r.key)),sourceReport.example.groups.map(g=>g.matches.map(r=>r.key)));
  result.groups.forEach((g,i)=>g.matches.forEach((r,j)=>{const expected=sourceReport.example.groups[i].matches[j];for(const field of ['intersectionArea','referencePercent','candidatePercent'])assert(Math.abs(r[field]-expected[field])<1e-6,field);}));
  results.push({phase:'real-press-all-floors',passed:true,reference:result.reference,counts:result.groups.map(g=>({floor:g.floor,matches:g.matches.length})),preparationMs:result.preparationMs,analysisMs:result.analysisMs});
  assert.deepEqual(await camera(),before);
  const candidate=result.groups.find(g=>g.floor===4).matches[0];
  await page.getByRole('region',{name:'Rooms above',exact:true}).getByRole('button').filter({hasText:candidate.label}).first().click();
  await page.waitForFunction(()=>document.querySelector('.floor-btn.active')?.textContent==='F4'&&window.testDeck().props.layers.some(l=>l.id==='room-correspondence-outline'));
  assert.deepEqual(await camera(),before);
  assert((await page.locator('.correspondence-reference').innerText()).includes(result.reference.label));
  const outlines=()=>page.evaluate(()=>window.testDeck().props.layers.find(l=>l.id==='room-correspondence-outline')?.props.data);
  let paths=await outlines();assert(paths.every(p=>p.role==='candidate'));assert(paths.length>0);
  await page.getByRole('button',{name:'Inspect pair in F-ALL',exact:true}).click();
  await page.waitForFunction(()=>window.testRoomLayer()?.props.data.features.length===1608&&new Set(window.testDeck().props.layers.find(l=>l.id==='room-correspondence-outline')?.props.data.map(p=>p.role)).size===2,null,{timeout:60000});
  assert.deepEqual(await camera(),before);
  paths=await outlines();const pathSnapshot=JSON.stringify(paths);
  results.push({phase:'candidate-floor-and-f-all-pair-camera-preserved',passed:true,candidate,paths:paths.length});
  const nRequests=requests.length, sent=await page.evaluate(()=>window.analysisSent.length);
  await page.getByRole('button',{name:'Zoom out',exact:true}).click();
  for(const style of ['architectural','gis']){
   await page.locator('#night-mode-toggle').check();await page.locator(`input[name="night-visualization-style"][value="${style}"]`).check({force:true});
   for(const mode of ['uniform','original']){await page.locator('#room-color-mode').selectOption(mode);await page.waitForTimeout(350);assert.equal(JSON.stringify(await outlines()),pathSnapshot);}
  }
  assert.equal(await page.evaluate(()=>window.analysisSent.length),sent);assert.equal(requests.length,nRequests);
  results.push({phase:'night-colors-navigation-no-analysis-or-refetch',passed:true});
  await page.locator('#night-mode-toggle').uncheck();
  await page.getByRole('button',{name:'Fit building / Reset view',exact:true}).click();await page.waitForTimeout(1500);
  await page.locator('#panel-correspondence').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/paired-f-all.png`});
  await page.getByRole('button',{name:'Close room correspondence',exact:true}).click();
  assert.equal(await page.locator('#panel-correspondence').count(),0);await page.waitForTimeout(100);assert.equal(await outlines(),undefined);
  // Exercise the real F-ALL layer pick callback (retaining feature identity and geometry).
  await page.evaluate(()=>{const l=window.testRoomLayer();const f=l.props.data.features.find(f=>/press/i.test(f.properties.name));if(!f)throw Error('Missing combined Press feature');l.props.onClick({object:f});});
  await page.getByRole('button',{name:'Rooms Above & Below',exact:true}).waitFor();
  let fromAll=await analyze();
  const resolution=fromAll.status;
  if(resolution==='choose-reference'){
   const choice=fromAll.choices.find(r=>/university press/i.test(r.label));assert(choice);
   const n=await page.evaluate(()=>window.analysisMessages.length);
   await page.locator('#panel-correspondence .correspondence-result').filter({hasText:choice.label}).click();
   await page.waitForFunction(n=>window.analysisMessages.length>n,n);fromAll=await page.evaluate(()=>window.analysisMessages.at(-1).result);
  }
  assert.equal(fromAll.reference.key,result.reference.key);
  assert.equal(fromAll.cacheHit,true);
  results.push({phase:'f-all-pick-authoritative-resolution-and-cache',passed:true,resolution});
  for(const [query,floor] of [['dewey',0],['0754',7]]){
   await select(query,floor);const r=await analyze();assert.equal(r.reference.floor,floor);
   const direction=floor===0?'below':'above';assert.equal(r.groups.filter(g=>g.direction===direction).length,0);
   assert((await page.locator('#panel-correspondence').innerText()).includes(`No supported floors ${direction} F${floor}`));
   results.push({phase:'edge-floor',floor,passed:true});
  }
  // Search and analysis preserve an active route; return to its floor to compare.
  await select('0174',1);
  await page.getByRole('button',{name:'Plan Route',exact:true}).click();
  await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
  await page.getByPlaceholder('Search end room...').fill('0181');await page.locator('.route-suggestion-item-clickable').first().click();
  await page.getByRole('button',{name:'Find Route',exact:true}).click();await page.waitForTimeout(1800);
  const route=()=>page.evaluate(require(process.cwd()+'/review/route-model-snapshot.cjs').snapshotRoute);
  const routeBefore=await route();assert(routeBefore.length);
  await select('0174',1);await analyze();assert.deepEqual(await route(),routeBefore);
  const next=await page.evaluate(()=>window.analysisMessages.at(-1).result.groups.find(g=>g.matches.length).matches[0]);
  await page.locator('#panel-correspondence .correspondence-result').filter({hasText:next.label}).first().click();
  await page.locator('.correspondence-reference').click();await page.waitForTimeout(700);assert.deepEqual(await route(),routeBefore);
  results.push({phase:'routing-preserved',passed:true});
  await page.getByRole('button',{name:'Clear Route',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.reload();await ready();
  await page.locator('.mobile-drawer-toggle').click();await page.locator('#animation-toggle').uncheck();await select('0362',3);await analyze();
  await page.locator('#panel-correspondence').scrollIntoViewIfNeeded();
  const box=await page.locator('#panel-correspondence').boundingBox();assert(box.x>=0&&box.x+box.width<=390);
  await page.screenshot({path:`${out}/mobile-results.png`});results.push({phase:'mobile-sidebar-results',passed:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.route('**/rooms-level-7-WGS.geojson',r=>r.fulfill({status:503,body:'Unavailable'}));await page.reload();await ready();
  await select('0362',3);const partial=await analyze();assert.equal(partial.groups.find(g=>g.floor===7).available,false);
  await page.unroute('**/rooms-level-7-WGS.geojson');
  const n=await page.evaluate(()=>window.analysisMessages.length);
  await page.getByRole('button',{name:'Retry missing floors'}).click();
  await page.waitForFunction(n=>window.analysisMessages.length>n&&window.analysisMessages.at(-1).result.groups?.every(g=>g.available),n,{timeout:60000});
  results.push({phase:'missing-floor-retry-and-cache-invalidation',passed:true});
  assert.deepEqual(errors,[]);
 }catch(e){results.push({phase:'failure',message:e.message});await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw e;}
 finally{fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
