const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error' && /GLSL|DeckGL error/.test(m.text()) && errors.length<5)errors.push(m.text());});
 await page.addInitScript(()=>{window.labelDeck=()=>{let f=document.querySelector('#deckgl-wrapper');f=f?.[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}};});
 try{
  await page.goto('http://127.0.0.1:3004/review/route-label-stage3-fixture.html');await page.waitForFunction(()=>window.labelReview&&window.labelDeck(),null,{timeout:60000});
  for(const floor of [0,1,2,3,4,5,6,7,'all']){
   await page.evaluate(f=>window.labelReview.setFloor(f),floor);await page.waitForTimeout(400);
   await page.evaluate(async()=>{const r=window.labelReview,{getRoomLabelAnchor}=await import('/src/utils/roomLabelAnchor.js');const pts=[r.expected.start,r.expected.end,r.expected.long].map(getRoomLabelAnchor);r.setView({longitude:pts.reduce((a,p)=>a+p[0],0)/3,latitude:pts.reduce((a,p)=>a+p[1],0)/3,zoom:18.5,pitch:0,bearing:0});});
   await page.waitForTimeout(700);
   const result=await page.evaluate(()=>{const d=window.labelDeck();return {floor:window.labelReview.floor,budget:Number(d.canvas.closest('.map-3d-container').dataset.routeLabelBudget),labels:d.props.layers.filter(l=>l.id.includes('labels')).flatMap(l=>l.props.data.map(m=>({id:m.id,type:m.type,name:m.roomName,floor:m.floor,z:m.position[2],group:l.props.collisionGroup,size:l.props.getSize,units:l.props.sizeUnits})))}});
   assert(result.labels.length>0);assert(result.labels.every(m=>m.group==='route-room-labels'&&m.units==='pixels'));
   assert(result.labels.every(m=>floor==='all'||Number(m.floor)===floor));
   const focus=result.labels.filter(m=>m.type==='start'||m.type==='end');assert(focus.every(m=>Math.abs(m.z-(floor==='all'?m.floor*4.5+1.1:1.1))<1e-7));
   assert.equal(new Set(result.labels.map(m=>m.id)).size,result.labels.length);results.push(result);console.log('fixture floor',floor,result.labels.length);
  }
  await page.evaluate(()=>{window.labelReview.setFloor(1);window.labelReview.setFallback(true);});await page.waitForTimeout(500);
  await page.evaluate(async()=>{const r=window.labelReview,{getRoomLabelAnchor}=await import('/src/utils/roomLabelAnchor.js');const p=getRoomLabelAnchor(r.expected.long);r.setView({longitude:p[0],latitude:p[1],zoom:20,pitch:0,bearing:0});});
  await page.waitForTimeout(700);
  const fallback=await page.evaluate(()=>window.labelDeck().props.layers.find(l=>l.id==='route-transition-labels')?.props.data.map(m=>({name:m.roomName,key:m.key})));
  assert(fallback?.length);results.push({case:'transition fallback in shared collision group',fallback});
  for(const night of ['architectural','gis','day']){
   await page.evaluate(n=>window.labelReview.setNight(n),night);await page.waitForTimeout(700);
   assert(await page.evaluate(()=>window.labelDeck().props.layers.find(l=>l.id==='route-transition-labels')?.props.data.length>0));results.push({case:night,passed:true});
  }
  await page.screenshot({path:'docs/stage-3-route-labels/fallback.png'});assert.deepEqual(errors,[]);
 }catch(e){results.push({failure:e.stack});throw e;}
 finally{fs.writeFileSync('docs/stage-3-route-labels/fixture.json',JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
