const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),results=[],errors=[],networkFailures=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error' && /Failed to fetch https:\/\/api.mapbox.com/.test(m.text())){networkFailures.push('Mapbox style fetch failed');return;}if(m.type()==='error' && !/net::ERR|Failed to load resource/.test(m.text())){if(errors.length<10){console.log('BROWSER ERROR',m.text().slice(0,1000));errors.push(m.text());}}});
 await page.addInitScript(()=>{window.labelDecks=()=>[...document.querySelectorAll('#deckgl-wrapper')].map(node=>{
  let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}
 }).filter(Boolean);});
 const snapshot=async name=>{
  await page.waitForTimeout(500);
  const data=await page.evaluate(()=>window.labelDecks().map(d=>({view:{zoom:d.getViewports()[0].zoom,pitch:d.getViewports()[0].pitch,bearing:d.getViewports()[0].bearing},labels:d.props.layers.filter(l=>['route-focus-room-labels','route-landmark-room-labels','route-used-connector-room-labels','route-transition-labels'].includes(l.id)).map(l=>({id:l.id,size:l.props.getSize,units:l.props.sizeUnits,collision:l.props.collisionGroup,items:l.props.data.map(m=>({id:m.id,key:m.key,floor:m.floor,position:m.position,offset:m.pixelOffset,text:m.labelText,progress:m.progress,box:(()=>{const p=d.getViewports()[0].project(m.textPosition||m.position);return {left:p[0]+m.pixelOffset[0]-m.width/2,right:p[0]+m.pixelOffset[0]+m.width/2,top:p[1]+m.pixelOffset[1]-m.height/2,bottom:p[1]+m.pixelOffset[1]+m.height/2};})()}))})),budget:Number(d.canvas.closest('.map-3d-container').dataset.routeLabelBudget)})));
  for(const d of data){const items=d.labels.flatMap(l=>l.items);assert(items.length<=d.budget);assert.equal(new Set(items.map(m=>m.key)).size,items.length);
   for(const l of d.labels){assert.equal(l.size,l.id==='route-focus-room-labels'?12:l.id==='route-transition-labels'?10:10.5);assert.equal(l.units,'pixels');assert.equal(l.collision,'route-room-labels');}
   for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i].box,b=items[j].box;assert(!(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top));}
  }
  results.push({name,data});console.log(name,JSON.stringify(data.map(d=>({budget:d.budget,counts:d.labels.map(l=>[l.id,l.items.length]),view:d.view}))));return data;
 };
 const pause=async()=>{const slider=page.getByRole('slider',{name:'Preview progress'});await slider.press(Number(await slider.inputValue())>=0.99?'ArrowLeft':'ArrowRight');await page.getByTitle('Resume preview',{exact:true}).waitFor();};
 const view=async zoom=>{await page.evaluate(zoom=>{const d=window.labelDecks()[0],v=d.getViewports()[0];d.props.onViewStateChange({viewState:{longitude:v.longitude,latitude:v.latitude,zoom,pitch:0,bearing:0,transitionDuration:0},interactionState:{isZooming:true}});},zoom);await page.waitForTimeout(800);};
 try{
  await page.goto('http://127.0.0.1:3004');
  await page.waitForFunction(()=>window.labelDecks()[0]?.getViewports()[0]?.longitude < -89,null,{timeout:60000});
  await page.locator('#animation-toggle').uncheck();
  await page.getByRole('button',{name:'Plan Route',exact:true}).click();
  await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
  await page.getByPlaceholder('Search end room...').fill('0181');await page.locator('.route-suggestion-item-clickable').first().click();
  await page.getByRole('button',{name:'Find Route',exact:true}).click();
  await page.waitForFunction(()=>window.labelDecks()[0]?.props.layers.some(l=>l.id==='route-focus-room-labels'));
  await page.waitForTimeout(4000);await pause();
  await view(19);const close=await snapshot('F1 route near');await page.screenshot({path:'docs/stage-3-route-labels/near.png'});
  await view(16.5);const far=await snapshot('F1 route far');assert(far[0].budget<close[0].budget);await page.screenshot({path:'docs/stage-3-route-labels/far.png'});
  await view(19.5);await page.getByTitle('Resume preview',{exact:true}).click();await page.waitForTimeout(1200);await snapshot('preview playing');await pause();await snapshot('preview paused');
  await page.evaluate(()=>{const d=window.labelDecks()[0],v=d.getViewports()[0];d.props.onViewStateChange({viewState:{longitude:v.longitude,latitude:v.latitude,zoom:19.5,pitch:60,bearing:75,transitionDuration:0},interactionState:{isRotating:true}});});await snapshot('pitch 60 bearing 75');
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await snapshot('sidebar collapsed');
  await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();await snapshot('sidebar expanded');
  await page.getByRole('button',{name:'Clear Route',exact:true}).click();
  const cleared=await snapshot('route cleared');assert.equal(cleared[0].labels.flatMap(l=>l.items).length,0);
  await page.getByRole('button',{name:'Plan Route',exact:true}).click();
  await page.locator('#planner-floor-select').selectOption('');
  await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
  await page.getByPlaceholder('Search end room...').fill('0362');await page.locator('.route-suggestion-item-clickable').first().click();
  await page.getByRole('button',{name:'Find Route',exact:true}).click();
  await page.waitForFunction(()=>window.labelDecks().length>=2,null,{timeout:60000});await page.waitForTimeout(4000);await pause();
  const timeline=await snapshot('F1 F3 timeline paused');
  assert(timeline.every(d=>new Set(d.labels.flatMap(l=>l.items.map(m=>m.floor))).size<=1));
  await page.getByTitle('Resume preview',{exact:true}).click();await snapshot('timeline playing');await pause();
  await page.getByRole('button',{name:'Stacked overview',exact:true}).click();
  await page.waitForFunction(()=>window.labelDecks().length===1);await page.waitForTimeout(1500);await pause();
  await snapshot('F-ALL paused');await page.screenshot({path:'docs/stage-3-route-labels/stacked.png'});
  await page.getByTitle('Resume preview',{exact:true}).click();await snapshot('F-ALL playing');await pause();
  // A seek explicitly pauses playback and lets us check destination-floor relevance.
  const scrubber=page.getByRole('slider',{name:'Preview progress'});
  await scrubber.fill('0.85');await snapshot('F-ALL seek paused');
  await page.getByTitle('Resume preview',{exact:true}).click();await snapshot('F-ALL destination playback');await pause();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(2500);
  const open=page.getByRole('button',{name:'Open navigation panel',exact:true});if(await open.count())await open.first().click();await page.waitForFunction(()=>document.querySelector('.map-3d-container')?.dataset.routeLabelCount==='0',null,{timeout:10000});const covered=await snapshot('mobile drawer open');assert.equal(covered[0].labels.flatMap(l=>l.items).length,0);
  await page.locator('.drawer-close').click();await page.getByRole('button',{name:'Fit building / Reset view',exact:true}).click();await page.waitForFunction(()=>Number(document.querySelector('.map-3d-container')?.dataset.routeLabelCount)>0,null,{timeout:10000});await page.waitForTimeout(500);const restored=await snapshot('mobile drawer closed, building fitted');assert(restored[0].labels.flatMap(l=>l.items).length>0);
  await page.screenshot({path:'docs/stage-3-route-labels/mobile.png'});
  assert.deepEqual(errors,[]);
 }catch(e){results.push({failure:e.stack});throw e;}
 finally{fs.mkdirSync('docs/stage-3-route-labels',{recursive:true});fs.writeFileSync('docs/stage-3-route-labels/browser.json',JSON.stringify({results,errors,networkFailures},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
