const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const out='docs/interactive-overlap/perspective';fs.mkdirSync(out,{recursive:true});
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
  await page.goto('http://127.0.0.1:3004');await ready();await page.locator('#animation-toggle').uncheck();
  await select('0420D',4);await page.waitForTimeout(500);const r=await open(4);
  const match=r.groups[0].matches.find(m=>m.label!=='Floor');await choose(match.key);
  const map=page.getByRole('region',{name:'Interactive map, floor 4',exact:true});
  await map.focus();for(let i=0;i<8;i++)await map.press('ArrowUp');for(let i=0;i<2;i++)await map.press('ArrowRight');
  const pitched=await camera();assert.equal(pitched.pitch,40);assert.equal(pitched.bearing,30);
  await page.getByRole('button',{name:'Focus on Overlap'}).click();await page.waitForTimeout(700);
  geometryMatches(await overlays(),match);await page.screenshot({path:`${out}/single-pitched.png`});
  const before=await camera();await page.getByRole('button',{name:'Inspect pair in F-ALL'}).click();
  await page.waitForFunction(()=>window.testDeck().props.layers.find(l=>l.id==='room-overlap-intersection-fill')?.props.data.features.length===2);
  assert.deepEqual(await camera(),before);
  await page.getByRole('button',{name:'Focus on Overlap'}).click();await page.waitForTimeout(700);
  const focused=await camera();assert.equal(focused.pitch,40);assert.equal(focused.bearing,30);
  assert(await page.evaluate(()=>{const d=window.testDeck(),v=d.getViewports()[0],paths=d.props.layers.find(l=>l.id==='room-correspondence-outline').props.data;return paths.flatMap(r=>r.path).every(p=>{const [x,y]=v.project(p);return x>=0&&y>=0&&x<=v.width&&y<=v.height;});}));
  geometryMatches(await overlays(),match);await page.screenshot({path:`${out}/stacked-pitched-day.png`});
  for(const preset of ['architectural','gis']){
   await page.locator('#night-mode-toggle').check();await page.locator(`input[name="night-visualization-style"][value="${preset}"]`).check({force:true});await page.waitForTimeout(1600);
   geometryMatches(await overlays(),match);await page.screenshot({path:`${out}/stacked-pitched-${preset}.png`});
  }
  results.push({phase:'pitched-single-and-stacked-focus-both-presets',passed:true,camera:focused});assert.deepEqual(errors,[]);
 }catch(error){results.push({phase:'failure',message:error.message});await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
