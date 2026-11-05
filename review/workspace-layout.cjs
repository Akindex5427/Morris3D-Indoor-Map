const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), assert = require('node:assert/strict');
const out = 'docs/workspace-layout';
fs.mkdirSync(out, { recursive: true });
const baseline = process.argv.includes('--baseline');
const sizes = [[1920,1080],[1440,900],[1366,768],[1024,720],[820,1180],[390,844],[320,568],[844,390]];
(async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const results=[], errors=[];
 page.on('pageerror', e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.testDeck=()=>{const node=document.querySelector('#deckgl-wrapper');let f=node?.[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}};
 });
 const camera=()=>page.evaluate(()=>{const v=testDeck().getViewports()[0];return [v.longitude,v.latitude,v.zoom,v.pitch,v.bearing];});
 const measure=()=>page.evaluate(()=>{
  const box=s=>{const el=document.querySelector(s);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const v=testDeck().getViewports()[0];
  return {viewport:[innerWidth,innerHeight],header:box('.app-header'),map:box('.map-container'),workspace:box('.main-content'),deck:box('#deckgl-overlay'),basemap:box('.mapboxgl-canvas'),help:box('.help-button'),attribution:box('.mapboxgl-ctrl-attrib'),logo:box('.mapboxgl-ctrl-logo'),controls:box('.map-camera-controls'),deckSize:[v.width,v.height],pageSize:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],footer:!!document.querySelector('.app-footer'),sidebarScroll:getComputedStyle(document.querySelector('.left-panel')).overflowY};
 });
 const intersects=(a,b)=>a&&b&&a.width&&b.width&&a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y;
 try {
  await page.goto('http://127.0.0.1:3004');
  await page.waitForFunction(()=>testDeck()?.getViewports()[0]?.longitude < -89,null,{timeout:60000});
  await page.locator('#animation-toggle').uncheck();await page.waitForTimeout(1600);
  for(const [width,height] of sizes){
   await page.setViewportSize({width,height});await page.waitForTimeout(750);
   if(width<1024 && await page.locator('.main-content.sidebar-open').count())await page.locator('.drawer-close').click();
   await page.waitForTimeout(350);
   const m=await measure();results.push(m);console.log(`${width}x${height}`,JSON.stringify(m));
   if(!baseline){
    assert(!m.footer);assert(m.pageSize[0]<=width&&m.pageSize[1]<=height,'page overflow');
    assert(Math.abs(m.map.bottom-(height-12))<2,'map must reach bottom padding');
    assert(Math.abs(m.map.bottom-m.workspace.bottom)<2,'workspace gap');
    for(const canvas of [m.deck,m.basemap]){assert(canvas);assert(Math.abs(canvas.width-(m.map.width-2))<2);assert(Math.abs(canvas.height-(m.map.height-2))<2);}
    assert(Math.abs(m.deckSize[0]-m.deck.width)<2&&Math.abs(m.deckSize[1]-m.deck.height)<2);
    assert(m.help.y>=m.map.y&&m.help.bottom<=m.map.bottom,'help outside map');
    assert(m.controls.bottom<=m.map.bottom,'zoom controls outside map');
    assert(!intersects(m.help,m.attribution),'help overlaps attribution');
    assert(!intersects(m.help,m.controls),'help overlaps camera controls');
    assert(m.attribution&&m.logo,'map attribution retained');
    if(width>=1024)assert.equal(m.sidebarScroll,'auto');
    if(width<1024){
     await page.getByRole('button',{name:'Open navigation panel',exact:true}).click();
     assert.equal(await page.locator('.left-panel').evaluate(el=>getComputedStyle(el).overflowY),'auto');
     await page.locator('.drawer-close').click();
     await page.waitForTimeout(350);
    }
   }
   await page.screenshot({path:`${out}/${baseline?'before':'after'}-${width}x${height}.png`});
  }
  if(!baseline){
   await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(750);
   await page.evaluate(()=>{window.originalDeck=testDeck();window.originalCanvas=testDeck().canvas;});
   const before=await camera();const start=await measure();
   await page.locator('.sidebar-toggle').click();await page.waitForTimeout(700);const collapsed=await measure();
   assert.deepEqual(await camera(),before);assert(collapsed.map.width>start.map.width);assert.equal(collapsed.map.height,start.map.height);
   await page.locator('.sidebar-toggle').click();await page.waitForTimeout(700);assert.deepEqual(await camera(),before);
   await page.setViewportSize({width:1366,height:768});await page.waitForTimeout(700);assert.deepEqual(await camera(),before);
   assert(await page.evaluate(()=>testDeck()===originalDeck&&testDeck().canvas===originalCanvas),'map remounted');
   await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.waitForTimeout(500);assert((await camera())[2]>before[2]);
   const slider=page.getByRole('slider',{name:'Map zoom'});assert(Math.abs(Number(await slider.inputValue())-(await camera())[2])<.02);
   await slider.focus();await slider.press('ArrowDown');await page.waitForTimeout(500);assert(Math.abs(Number(await slider.inputValue())-(await camera())[2])<.02);
   await page.getByRole('button',{name:'Fit building / Reset view'}).click();await page.waitForTimeout(700);
   results.push({case:'sidebar and browser resize preserve camera and map instance; zoom, slider, fit',passed:true});
   await page.locator('.help-button').click();await page.locator('.help-overlay-content').waitFor();
   results.push({case:'help opens',passed:true});
  }
  assert.deepEqual(errors,[]);
 }catch(e){results.push({failure:e.stack});await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw e;}
 finally{fs.writeFileSync(`${out}/${baseline?'before':'after'}.json`,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
