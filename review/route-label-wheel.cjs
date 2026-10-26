const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),results=[];
 await page.addInitScript(()=>{window.reviewDeck=()=>{
  let f=document.querySelector('#deckgl-wrapper');f=f?.[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];
  while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}
 };});
 const snapshot=async name=>{
  await page.waitForTimeout(800);
  const data=await page.evaluate(()=>{
   const d=window.reviewDeck();return {zoom:d.getViewports()[0].zoom,budget:Number(d.canvas.closest('.map-3d-container').dataset.routeLabelBudget),
    labels:d.props.layers.filter(l=>l.id.includes('labels')).map(l=>({id:l.id,size:l.props.getSize,units:l.props.sizeUnits,names:l.props.data.map(m=>m.roomName)}))};
  });
  assert(data.labels.every(l=>l.units==='pixels' && l.size===(l.id==='route-focus-room-labels'?12:l.id==='route-transition-labels'?10:10.5)));
  assert(data.labels.flatMap(l=>l.names).length<=data.budget);assert(data.budget<=6);
  results.push({name,...data});return data;
 };
 try{
  await page.goto('http://127.0.0.1:3004');
  await page.waitForFunction(()=>window.reviewDeck()?.getViewports()[0]?.longitude < -89,null,{timeout:60000});
  await page.locator('#animation-toggle').uncheck();
  await page.getByRole('button',{name:'Plan Route',exact:true}).click();
  await page.getByPlaceholder('Search start room...').fill('0110');await page.locator('.route-suggestion-body').first().click();
  await page.getByPlaceholder('Search end room...').fill('0130');await page.locator('.route-suggestion-item-clickable').first().click();
  await page.getByRole('button',{name:'Find Route',exact:true}).click();
  await page.waitForFunction(()=>window.reviewDeck()?.props.layers.some(l=>l.id==='route-focus-room-labels'));
  await page.waitForTimeout(4000);
  await page.getByRole('slider',{name:'Preview progress'}).press('ArrowRight');
  await page.getByTitle('Resume preview',{exact:true}).waitFor();
  const before=await snapshot('0110 to 0130, fitted and paused');
  const box=await page.locator('.map-3d-container').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.wheel(0,-220);await page.waitForTimeout(1800);
  const closer=await snapshot('native wheel closer');assert(closer.zoom>before.zoom);
  await page.mouse.wheel(0,500);await page.waitForTimeout(1800);
  const farther=await snapshot('native wheel farther');assert(farther.zoom<closer.zoom);
  await page.screenshot({path:'docs/route-label-refinement/wheel-far.png'});
  await page.getByRole('button',{name:'Fit building / Reset view',exact:true}).click();await page.waitForTimeout(1500);await snapshot('reset after wheel');
  await page.screenshot({path:'docs/route-label-refinement/wheel-fit.png'});
  const oldZoom=results.at(-1).zoom;
  await page.getByRole('button',{name:'Zoom out',exact:true}).click();await page.waitForTimeout(1000);
  const button=await snapshot('zoom out control');assert(button.zoom<oldZoom);
  await page.setViewportSize({width:390,height:844});
  const toggle=page.locator('.mobile-drawer-toggle');await toggle.waitFor();
  if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
  await page.waitForFunction(()=>document.querySelector('.mobile-drawer-toggle')?.getAttribute('aria-expanded')==='true');
  await page.waitForTimeout(1000);
  const covered=await snapshot('mobile drawer open');
  assert.equal(covered.labels.flatMap(l=>l.names).length,0);
  await page.locator('.drawer-close').click();
  await page.getByRole('button',{name:'Fit building / Reset view',exact:true}).click();await page.waitForTimeout(1500);
  await snapshot('mobile drawer closed');
 }catch(e){results.push({failure:e.stack});throw e;}
 finally{fs.writeFileSync('docs/route-label-refinement/wheel.json',JSON.stringify(results,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
