const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {snapshotRoute}=require(process.cwd()+'/review/route-model-snapshot.cjs');
const output=process.env.COLOR_REVIEW_OUTPUT||'docs/stage-5-colors';
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 // Palette assertions concern settled Day/Night endpoints, not an arbitrary
 // moment 1.1 seconds into the cinematic sunset. Transition timing has its own suite.
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.colorDecks=()=>[...document.querySelectorAll('#deckgl-wrapper')].map(node=>{
   let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];
   while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}
  }).filter(Boolean);
  window.roomLayer=d=>d.props.layers.find(l=>/^indoor-building-(night-)?layer$/.test(l.id));
 });
 const mode=async value=>{await page.locator('#room-color-mode').selectOption(value);await page.waitForTimeout(200);};
 const snap=()=>page.evaluate(()=>{
  const l=window.roomLayer(window.colorDecks()[0]),w=window.colorDecks()[0].props.layers.find(l=>l.id.startsWith('procedural-interior-room-walls'));
  const isRoom=f=>!String(f.properties.name||'').toLowerCase().includes('floor')&&f.properties.type!=='floor';
  const rooms=l.props.data.features.filter(isRoom);
  const ws=w.props._subLayerProps['polygons-fill'];
  const wallColor=ws.environment.fullNight?ws.getNightColor:w.props.getFillColor;
  return {count:l.props.data.features.length,colors:rooms.map(f=>l.props.getFillColor(f)),walls:w.props.data.features.map(wallColor),geometry:JSON.stringify(l.props.data.features.map(f=>f.geometry)),sourceColors:rooms.map(f=>f.properties.color)};
 });
 try{
  await page.goto(process.env.COLOR_REVIEW_URL||'http://127.0.0.1:3001');
  await page.waitForFunction(()=>window.colorDecks()[0]?.getViewports()[0]?.longitude < -89,null,{timeout:60000});
  await page.locator('#animation-toggle').uncheck();
  assert(await page.locator('#room-color-mode option[value="function"]').isDisabled());
  assert((await page.locator('#room-color-description').textContent()).includes('unavailable'));
  assert.equal(await page.locator('.room-color-legend').count(),0);
  const counts=[148,355,243,288,199,149,138,90,1608];
  for(const floor of [0,1,2,3,4,5,6,7,'all']){
   await page.getByRole('button',{name:floor==='all'?'F-All':`F${floor}`,exact:true}).click();
   await page.waitForFunction(count=>window.roomLayer(window.colorDecks()[0])?.props.data.features.length===count,counts[floor==='all'?8:floor],{timeout:60000});
   for(const style of ['day','architectural','gis']){
    if(style==='day')await page.locator('#night-mode-toggle').uncheck();
    else {await page.locator('#night-mode-toggle').check();await page.locator(`input[name="night-visualization-style"][value="${style}"]`).check({force:true});}
    await page.waitForTimeout(1100);
    await mode('original');const before=await snap();
    await mode('uniform');const neutral=await snap();
    assert(neutral.colors.length>0);
    assert(neutral.colors.every(c=>c.slice(0,3).join(',')==='174,181,187'),`${floor}/${style} uniform bodies`);
    const wallColor=style==='day'?'73,76,79':'174,181,187';
    assert(neutral.walls.every(c=>c.slice(0,3).join(',')===wallColor),`${floor}/${style} uniform walls`);
    assert.equal(neutral.geometry,before.geometry);assert.deepEqual(neutral.sourceColors,before.sourceColors);
    await mode('original');const restored=await snap();assert.deepEqual(restored.colors,before.colors);assert.deepEqual(restored.walls,before.walls);
    results.push({floor,style,features:neutral.count,roomsChecked:neutral.colors.length,wallsChecked:neutral.walls.length,passed:true});console.log('Passed',floor,style);
   }
  }
  await page.locator('#night-mode-toggle').uncheck();
  const search=page.getByRole('combobox',{name:'Search rooms on all floors'});
  await search.fill('Classroom 0174');await page.getByRole('option').filter({hasText:'Classroom 0174'}).first().click();
  await page.waitForFunction(()=>window.roomLayer(window.colorDecks()[0]).props.data.features.length===355);
  for(const style of ['day','architectural','gis']) {
   if(style==='day')await page.locator('#night-mode-toggle').uncheck();
   else {await page.locator('#night-mode-toggle').check();await page.locator(`input[name="night-visualization-style"][value="${style}"]`).check({force:true});}
   for(const value of ['uniform','original']){await mode(value);const s=await snap();assert.equal(s.colors.filter(c=>c.slice(0,3).join(',')==='255,200,0').length,1);}
  }
  await page.locator('#night-mode-toggle').uncheck();
  results.push({phase:'selection-priority',passed:true});
  await page.getByRole('button',{name:'Close room details',exact:true}).click();
  await page.getByRole('button',{name:'Plan Route',exact:true}).click();
  await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
  await page.getByPlaceholder('Search end room...').fill('0181');await page.locator('.route-suggestion-item-clickable').first().click();
  await page.getByRole('button',{name:'Find Route',exact:true}).click();await page.waitForTimeout(2200);
  const routes=()=>page.evaluate(snapshotRoute);
  const routeBefore=await routes();assert(routeBefore.length);
  for(const value of ['uniform','original']){await mode(value);const s=await snap();assert(s.colors.some(c=>c.slice(0,3).join(',')==='34,197,94'));assert(s.colors.some(c=>c.slice(0,3).join(',')==='239,68,68'));assert.deepEqual(await routes(),routeBefore);}
  results.push({phase:'route-colors-and-geometry',passed:true});
  await page.getByRole('button',{name:'Clear Route',exact:true}).click();
  await page.getByRole('button',{name:'Plan Route',exact:true}).click();
  await page.locator('#planner-floor-select').selectOption('');
  await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
  await page.getByPlaceholder('Search end room...').fill('0261');await page.locator('.route-suggestion-item-clickable').first().click();
  await page.getByRole('button',{name:'Find Route',exact:true}).click();
  await page.locator('.multi-floor-route-view').waitFor({timeout:60000});
  await page.waitForFunction(()=>window.colorDecks().length>=2&&window.colorDecks().every(d=>window.roomLayer(d)));
  for(const style of ['day','architectural','gis']) {
   if(style==='day')await page.locator('#night-mode-toggle').uncheck();
   else {await page.locator('#night-mode-toggle').check();await page.locator(`input[name="night-visualization-style"][value="${style}"]`).check({force:true});}
   await page.waitForTimeout(1000);
   await mode('original');const routeData=await routes();
   const original=await page.evaluate(()=>window.colorDecks().map(d=>{const l=window.roomLayer(d);return l.props.data.features.map(f=>l.props.getFillColor(f));}));
   await mode('uniform');
   const panels=await page.evaluate(()=>window.colorDecks().map(d=>{const l=window.roomLayer(d);return l.props.data.features.map(f=>l.props.getFillColor(f).slice(0,3).join(','));}));
   assert(panels.every(colors=>colors.includes('125,130,135')));
   assert(panels.some(colors=>colors.includes('34,197,94')));assert(panels.some(colors=>colors.includes('239,68,68')));
   assert.deepEqual(await routes(),routeData);
   await mode('original');
   const restored=await page.evaluate(()=>window.colorDecks().map(d=>{const l=window.roomLayer(d);return l.props.data.features.map(f=>l.props.getFillColor(f));}));
   assert.deepEqual(restored,original);results.push({phase:'timeline-colors-and-routes',style,panels:panels.length,passed:true});
  }
  await page.getByRole('button',{name:'Clear Route',exact:true}).click();
  await page.locator('#night-mode-toggle').uncheck();
  await page.getByRole('button',{name:'F1',exact:true}).click();
  await page.getByRole('button',{name:'Fit building / Reset view',exact:true}).click();
  await mode('uniform');await page.locator('#room-color-mode').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${output}/uniform-desktop.png`});
  await page.setViewportSize({width:390,height:844});await page.locator('.mobile-drawer-toggle').click();
  await page.locator('#room-color-mode').scrollIntoViewIfNeeded();await mode('original');await mode('uniform');
  const rect=await page.locator('#room-color-mode').boundingBox();assert(rect.x>=0&&rect.x+rect.width<=390);
  await page.screenshot({path:`${output}/mobile-controls.png`});results.push({phase:'mobile-selector',passed:true});
  assert.deepEqual(errors,[]);
 }finally{fs.writeFileSync(`${output}/browser-results.json`,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
