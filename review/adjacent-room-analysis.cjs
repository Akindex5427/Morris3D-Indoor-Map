const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const out='docs/adjacent-room-analysis';fs.mkdirSync(out,{recursive:true});
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
 try{
  await page.goto(process.env.REVIEW_URL||'http://127.0.0.1:3004');await ready();await page.locator('#animation-toggle').uncheck();
  for(const [query,floor,expected] of [['dewey',0,[1]],['0174',1,[2,0]],['0420D',4,[5,3]],['0754',7,[6]]]){
   if(await panel().count())await page.getByRole('button',{name:'Close room correspondence'}).click();
   await select(query,floor);const r=await open(floor);
   assert.deepEqual(r.groups.map(g=>g.floor),expected);
   assert.equal(await panel().locator('.correspondence-direction').count(),expected.length);
   const bars=await panel().locator('.correspondence-bar > span').evaluateAll(nodes=>nodes.map(n=>({percent:parseFloat(n.style.width),width:n.getBoundingClientRect().width,total:n.parentElement.getBoundingClientRect().width}))); 
   const matches=r.groups.flatMap(g=>g.matches);
   assert.equal(bars.length,matches.length);bars.forEach((v,i)=>{assert(Math.abs(v.percent-matches[i].referencePercent)<.0001,`CSS serialization: ${v.percent} vs ${matches[i].referencePercent}`);assert(Math.abs(v.width-v.total*matches[i].referencePercent/100)<1,'bar width within one CSS pixel');});
   assert(matches.every(m=>Math.abs(m.referencePercent-100*m.intersectionArea/r.reference.area)<1e-8));
   results.push({phase:'adjacency-bars',floor,passed:true,reference:r.reference,groups:r.groups,bars,analysisMs:r.analysisMs});
  }
  // An already-open panel follows a newly selected reference; there is no auto speech.
  const oldKey=(await result()).reference.key;
  await select('0420D',4);const r=await waitAnalysis(4);assert.notEqual(r.reference.key,oldKey);
  assert.equal(await page.evaluate(()=>window.speechCalls.filter(c=>c.action==='speak').length),0);
  await panel().getByText('Read analysis summary',{exact:true}).click();
  const summary=await panel().locator('.analysis-summary p').textContent();
  await page.getByRole('button',{name:'Listen to Analysis',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.speechCalls.at(-1).text),summary);
  await page.getByRole('button',{name:'Pause analysis',exact:true}).click();
  await page.getByRole('button',{name:'Resume analysis',exact:true}).click();
  await page.getByRole('button',{name:'Replay analysis',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.speechCalls.filter(c=>c.action==='speak').length),2);
  await page.getByRole('button',{name:'Stop analysis',exact:true}).click();
  await page.getByRole('button',{name:'Listen to Analysis',exact:true}).click();
  await select('0362',3);await waitAnalysis(3);
  assert.equal(await page.evaluate(()=>window.currentUtterance),null);
  assert(!(await panel().locator('.analysis-summary p').textContent()).includes('Group Study 0420D'));
  results.push({phase:'shared-summary-and-controlled-speech-lifecycle',passed:true,summary,nativeAPIPresent:await page.evaluate(()=>window.nativeSpeechSupported)});
  // A new reference cancels speech and replaces stale results even during rapid searches.
  await select('0174',1);await select('0420D',4);await waitAnalysis(4);
  await page.waitForTimeout(200);assert.equal((await result()).reference.floor,4);
  const before=await camera(),count=await page.evaluate(()=>window.analysisSent.length);
  const source=await result(),candidate=source.groups.find(g=>g.matches.length).matches.find(m=>m.name&&m.name!=='Floor')||source.groups[0].matches[0];
  await panel().locator('[data-feature-key]').filter({has:page.locator('strong',{hasText:candidate.label})}).first().click();
  await page.waitForFunction(()=>window.testDeck().props.layers.some(l=>l.id==='room-correspondence-outline'));
  assert.deepEqual(await camera(),before);
  await page.getByRole('button',{name:'Inspect pair in F-ALL'}).click();
  await page.waitForFunction(()=>new Set(window.testDeck().props.layers.find(l=>l.id==='room-correspondence-outline')?.props.data.map(p=>p.role)).size===2,null,{timeout:60000});
  assert.deepEqual(await camera(),before);
  await page.getByRole('button',{name:'Zoom out',exact:true}).click();
  for(const preset of ['architectural','gis']){
   await page.locator('#night-mode-toggle').check();await page.locator(`input[name="night-visualization-style"][value="${preset}"]`).check({force:true});
   await page.locator('#room-color-mode').selectOption('uniform');await page.waitForTimeout(1500);
   assert.equal(await page.evaluate(()=>window.analysisSent.length),count);
   assert.equal(await panel().locator('.correspondence-bar').count(),source.groups.flatMap(g=>g.matches).length);
  }
  await panel().scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/night-desktop.png`});
  await page.locator('#night-mode-toggle').uncheck();await page.locator('#room-color-mode').selectOption('original');
  await page.waitForTimeout(1500);await page.screenshot({path:`${out}/day-desktop.png`});
  results.push({phase:'pair-highlight-camera-night-color-no-reanalysis',passed:true});
  // Unsupported and missing local voices always leave a readable summary.
  await page.getByRole('button',{name:'Close room correspondence'}).click();
  await page.evaluate(()=>Object.defineProperty(window,'speechSynthesis',{configurable:true,value:undefined}));
  await open(source.reference.floor);await page.getByRole('button',{name:'Listen to Analysis'}).isDisabled().then(v=>assert(v));
  assert((await panel().innerText()).includes('Speech synthesis is unavailable'));
  assert((await panel().locator('.analysis-summary p').textContent()).length>50);
  await page.getByRole('button',{name:'Close room correspondence'}).click();
  await page.evaluate(()=>{Object.defineProperty(window,'speechSynthesis',{configurable:true,value:window.speechMock});window.localVoices=[];});
  await open(source.reference.floor);assert((await panel().innerText()).includes('No local English voice'));
  await page.evaluate(()=>{window.localVoices=[{localService:true,lang:'en-US'}];window.voiceListeners.forEach(f=>f());});
  await page.getByRole('button',{name:'Listen to Analysis'}).click();
  await page.getByRole('button',{name:'Close room correspondence'}).click();
  assert.equal(await page.evaluate(()=>window.currentUtterance),null);
  assert.equal(await page.evaluate(()=>window.voiceListeners.size),0);
  results.push({phase:'unsupported-missing-voices-close-cleanup',passed:true});
  // Real F-ALL picking resolves authoritative XY without inventing cross-export IDs.
  await page.evaluate(()=>{const l=window.testRoomLayer(),f=l.props.data.features.find(f=>/press/i.test(f.properties.name));l.props.onClick({object:f});});
  await page.getByRole('button',{name:'Rooms Above & Below',exact:true}).click();
  await page.waitForFunction(()=>['ready','choose-reference'].includes(window.analysisMessages.at(-1)?.result.status)&&document.querySelector('#panel-correspondence')?.getAttribute('aria-busy')==='false');
  if((await result()).status==='choose-reference')await panel().locator('.correspondence-result').filter({hasText:/press/i}).first().click();
  const picked=await waitAnalysis(3);assert.deepEqual(picked.groups.map(g=>g.floor),[4,2]);
  results.push({phase:'f-all-reference-selection',passed:true});
  await page.setViewportSize({width:390,height:844});await page.reload();await ready();
  await page.locator('.mobile-drawer-toggle').click();await page.locator('#animation-toggle').uncheck();await select('0420D',4);
  await open(4);
  await page.waitForFunction(()=>document.querySelector('.correspondence-heading').getBoundingClientRect().top >= document.querySelector('.drawer-tabs').getBoundingClientRect().bottom);
  const box=await panel().boundingBox();assert(box.x>=0&&box.x+box.width<=391);
  assert(await panel().evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.screenshot({path:`${out}/mobile.png`});results.push({phase:'mobile-layout',passed:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.route('**/rooms-level-7-WGS.geojson',route=>route.fulfill({status:503,body:'Unavailable'}));
  await page.reload();await ready();await select('0654',6);const partial=await open(6);
  assert.equal(partial.groups.find(g=>g.floor===7).available,false);
  assert((await panel().innerText()).includes('Floor data unavailable'));
  assert((await panel().locator('.analysis-summary p').textContent()).includes('overlap cannot be determined'));
  await page.unroute('**/rooms-level-7-WGS.geojson');await page.getByRole('button',{name:'Retry missing floors'}).click();
  await page.waitForFunction(()=>window.analysisMessages.at(-1)?.result.groups?.every(g=>g.available),null,{timeout:60000});
  results.push({phase:'missing-adjacent-data-retry',passed:true});
  await select('0174',1);await waitAnalysis(1);
  await page.getByRole('button',{name:'Plan Route',exact:true}).click();
  await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
  await page.getByPlaceholder('Search end room...').fill('0181');await page.locator('.route-suggestion-item-clickable').first().click();
  await page.getByRole('button',{name:'Find Route',exact:true}).click();await page.waitForTimeout(1800);
  const route=()=>page.evaluate(require(process.cwd()+'/review/route-model-snapshot.cjs').snapshotRoute);
  const routeBefore=await route();assert(routeBefore.length);
  await select('0174',1);await waitAnalysis(1);assert.deepEqual(await route(),routeBefore);
  const next=(await result()).groups.find(g=>g.matches.length).matches[0];
  await panel().locator('.correspondence-result').filter({hasText:next.label}).first().click();
  await panel().locator('.correspondence-reference').click();await page.waitForTimeout(700);
  assert.deepEqual(await route(),routeBefore);
  results.push({phase:'route-preservation',passed:true});
  assert.deepEqual(errors,[]);
 }catch(error){results.push({phase:'failure',message:error.message,diagnostics:await page.evaluate(()=>({sent:window.analysisSent,messages:window.analysisMessages.map(m=>({id:m.id,status:m.result.status,floor:m.result.reference?.floor})),panel:document.querySelector('#panel-correspondence')?.textContent}))});await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
