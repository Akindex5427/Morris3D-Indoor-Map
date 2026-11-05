const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const out='docs/workspace-layout';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'}),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.refs=()=>{let f=document.querySelector('#deckgl-wrapper');f=f?.[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];let deck,map;while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)deck=h.memoizedState.current.deck;if(h.memoizedState?.current?.getMap)map=h.memoizedState.current.getMap();h=h.next;}f=f.return;}return {deck,map};};});
 const ready=()=>page.waitForFunction(()=>refs().deck?.getViewports()[0].longitude < -89,null,{timeout:60000});
 const alignment=()=>page.evaluate(()=>{
  const {deck,map}=refs(),v=deck.getViewports()[0],center=[v.longitude,v.latitude];
  const samples=[center,[center[0]+.0002,center[1]+.0002],[center[0]-.0002,center[1]-.0002]];
  return samples.map(p=>{const a=v.project([...p,0]),b=map.project(p);return Math.hypot(a[0]-b.x,a[1]-b.y);});
 });
 try{
  await page.goto('http://127.0.0.1:3004');await ready();await page.locator('#animation-toggle').uncheck();await page.waitForTimeout(1000);
  await page.getByRole('button',{name:'Fit building / Reset view'}).click();await page.waitForTimeout(600);
  const m=await page.locator('.map-3d-container').boundingBox();
  const before=await page.evaluate(()=>refs().deck.getViewports()[0].longitude);
  await page.mouse.move(m.x+m.width*.5,m.y+m.height*.6);await page.mouse.down();await page.mouse.move(m.x+m.width*.5+45,m.y+m.height*.6+20,{steps:8});await page.mouse.up();await page.waitForTimeout(400);
  assert.notEqual(await page.evaluate(()=>refs().deck.getViewports()[0].longitude),before);
  for(const collapsed of [true,false]){
   await page.locator('.sidebar-toggle').click();await page.waitForTimeout(550);
   await page.waitForFunction(()=>{const {deck,map}=refs(),v=deck.getViewports()[0],a=v.project([v.longitude,v.latitude,0]),b=map.project([v.longitude,v.latitude]);return Math.hypot(a[0]-b.x,a[1]-b.y)<1;},null,{timeout:5000});
   const error=await alignment();assert(error.every(v=>v<1),`ground-plane projection mismatch ${error}`);
   results.push({case:'basemap/deck projection after pan and sidebar resize',collapsed,maxPixelError:Math.max(...error)});
  }
  await page.getByRole('combobox',{name:'Search rooms on all floors'}).fill('0174');await page.getByRole('option').filter({hasText:'F1'}).first().click();await page.waitForTimeout(600);
  await page.locator('.sidebar-toggle').click();await page.waitForTimeout(550);
  const pick=await page.evaluate(async()=>{
   const d=refs().deck,l=d.props.layers.find(l=>l.id==='indoor-building-layer'),f=l.props.data.features.find(f=>f.properties.name==='Classroom 0174');
   const {getRoomLabelAnchor}=await import('/src/utils/roomLabelAnchor.js');
   const a=getRoomLabelAnchor(f),xy=d.getViewports()[0].project([a[0],a[1],0]),hit=d.pickObject({x:xy[0],y:xy[1],radius:2,layerIds:[l.id]});
   const rect=document.querySelector('.map-3d-container').getBoundingClientRect();return {name:hit?.object?.properties?.name,x:rect.x+xy[0],y:rect.y+xy[1]};
  });assert.equal(pick.name,'Classroom 0174');
  await page.mouse.click(pick.x,pick.y);await page.waitForTimeout(500);assert.equal(await page.locator('.room-info-popup .room-name').innerText(),'Classroom 0174');
  results.push({case:'real GPU picking and room click after resize',...pick});
  await page.setViewportSize({width:390,height:844});await page.reload();await ready();await page.waitForTimeout(1800);
  await page.screenshot({path:`${out}/mobile-initial.png`});

  const toggle=page.locator('.mapboxgl-ctrl-attrib-button');await toggle.click();
  const attribution=await page.locator('.mapboxgl-ctrl-attrib').boundingBox(),help=await page.locator('.help-button').boundingBox();
  assert(attribution.y>=help.y+help.height,'expanded attribution overlaps Help');
  assert(await page.locator('.mapboxgl-ctrl-attrib a[href*="openstreetmap"]').isVisible());
  await page.screenshot({path:`${out}/mobile-attribution.png`});results.push({case:'fresh mobile load and expanded licensing attribution',attribution,help});
  assert.deepEqual(errors,[]);
 }catch(e){results.push({failure:e.stack});await page.screenshot({path:`${out}/interaction-failure.png`}).catch(()=>{});throw e;}
 finally{fs.writeFileSync(`${out}/interaction.json`,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
