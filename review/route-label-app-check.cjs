const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),results=[],errors=[],dialogs=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
 await page.addInitScript(()=>{window.labelDecks=()=>[...document.querySelectorAll('#deckgl-wrapper')].map(node=>{
  let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber'))];while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}
 }).filter(Boolean);});
 try{
  await page.goto('http://127.0.0.1:3004');
  await page.waitForFunction(()=>window.labelDecks()[0]?.getViewports()[0]?.longitude < -89,null,{timeout:60000});
  await page.locator('#animation-toggle').uncheck();
  const search=page.getByRole('combobox',{name:'Search rooms on all floors'});
  const longName='Southern Illinois African American Heritage Center 0640A';
  await search.fill('Heritage');await page.getByRole('option').filter({hasText:longName}).first().click();
  await page.getByRole('region',{name:'Room details'}).waitFor();
  assert.equal(await page.locator('.room-name').innerText(),longName);results.push({case:'full-room-name-in-details',name:longName,passed:true});
  await page.getByRole('button',{name:'F1',exact:true}).click();
  await page.getByRole('button',{name:'Plan Route',exact:true}).click();
  await page.locator('#planner-floor-select').selectOption('');
  await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
  await page.getByPlaceholder('Search end room...').fill('0362');await page.locator('.route-suggestion-item-clickable').first().click();
  await page.getByRole('button',{name:'Find Route',exact:true}).click();
  await page.waitForFunction(()=>window.labelDecks().length>=2,null,{timeout:60000});
  await page.waitForTimeout(2500);
  const labels=()=>page.evaluate(()=>window.labelDecks().flatMap(d=>d.props.layers.filter(l=>l.id==='route-focus-room-labels').flatMap(l=>l.props.data.map(m=>({id:m.id,name:m.roomName,floor:m.floor,z:m.position[2]})))));
  let focus=await labels();assert(focus.some(m=>m.name==='Classroom 0174'&&Number(m.floor)===1));
  assert(focus.some(m=>m.name==='Southern Illinois University Press (0362)'&&Number(m.floor)===3));
  assert(focus.every(m=>m.id.includes('#F')));results.push({case:'computed-F1-F3-route-timeline',focus,passed:true});
  await page.getByRole('button',{name:'Stacked overview',exact:true}).click();
  await page.waitForFunction(()=>window.labelDecks().length===1&&window.labelDecks()[0].props.layers.find(l=>l.id==='route-focus-room-labels')?.props.data.length===2);
  focus=await labels();assert(focus.every(m=>Math.abs(m.z-(Number(m.floor)*4.5+1.1))<1e-8));
  results.push({case:'computed-route-F-ALL',focus,passed:true});
  await page.getByRole('button',{name:'F3',exact:true}).click();
  await page.waitForFunction(()=>window.labelDecks()[0].props.layers.find(l=>l.id==='route-focus-room-labels')?.props.data.every(m=>Number(m.floor)===3));
  focus=await labels();assert.equal(focus.length,1);assert.equal(focus[0].z,1.1);
  results.push({case:'computed-route-individual-floor',focus,passed:true});
  await page.screenshot({path:'docs/stage-2-route-labels/computed-route.png'});
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
 }catch(e){results.push({failure:e.stack});throw e;}
 finally{fs.writeFileSync('docs/stage-2-route-labels/app-integration.json',JSON.stringify({results,errors,dialogs},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
