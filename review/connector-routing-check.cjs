const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:3004');await page.getByRole('button',{name:'Plan Route',exact:true}).waitFor();await page.locator('#animation-toggle').uncheck();
  for(const preference of ['stairs_first','elevator_first']){
   await page.getByRole('button',{name:'Plan Route',exact:true}).click();await page.locator('#planner-floor-select').selectOption('');
   await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
   await page.getByPlaceholder('Search end room...').fill('0362');await page.locator('.route-suggestion-item-clickable').first().click();
   if(await page.locator('.advanced-toggle').getAttribute('aria-expanded')!=='true')await page.locator('.advanced-toggle').click();
   await page.locator('#route-preference-select').selectOption(preference);
   await page.getByRole('button',{name:'Find Route',exact:true}).click();await page.locator('.multi-floor-route-view').waitFor({timeout:60000});await page.waitForTimeout(1200);
   const data=await page.evaluate(()=>[...document.querySelectorAll('#deckgl-wrapper')].map(node=>{
    let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];while(f){const p=f.memoizedProps;if(p?.routeRenderPath?.length)return {path:p.routeRenderPath,transitions:p.routeTransitionMarkers,focus:p.routeFocus};f=f.return;}return null;
   }).filter(Boolean));
   const types=[...new Set(data.flatMap(d=>(d.transitions||[]).map(t=>t.connectorType)))];
   assert(types.includes(preference==='stairs_first'?'stairs':'elevator'),JSON.stringify({preference,types}));
   assert(data.every(d=>d.path.every(p=>Number.isFinite(p.coords[0])&&Number.isFinite(p.coords[1]))));
   results.push({preference,types,panels:data.length,points:data.map(d=>d.path.length)});
   await page.getByRole('button',{name:'Clear Route',exact:true}).click();
  }
  assert.deepEqual(errors,[]);
 }catch(e){results.push({failure:e.stack});throw e;}
 finally{fs.writeFileSync('docs/stage-6-final/connectors.json',JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
