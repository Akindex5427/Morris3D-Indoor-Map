const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const out='docs/stage-2-route-labels/integration.json';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.labelDeck=()=>{let f=document.querySelector('#deckgl-wrapper');f=f?.[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}};});
 try{
  await page.goto('http://127.0.0.1:3004/review/route-label-review.html');
  await page.waitForFunction(()=>window.labelDeck()?.props.layers.some(l=>l.id==='route-focus-room-labels'),null,{timeout:60000});
  for(const floor of [0,1,2,3,4,5,6,7,'all']){
   await page.evaluate(f=>window.labelReview.setFloor(f),floor);
   await page.waitForFunction(f=>window.labelReview?.floor===f && window.labelDeck()?.props.layers.find(l=>l.id==='route-focus-room-labels')?.props.data.length===2,floor);
   await page.waitForTimeout(300);
   const result=await page.evaluate(async()=>{
    const {routeFeatureKey}=await import('/src/utils/routeLabelIdentity.js');
    const {getRoomLabelAnchor}=await import('/src/utils/roomLabelAnchor.js');
    const r=window.labelReview,d=window.labelDeck(),text=d.props.layers.filter(l=>l.id.includes('labels'));
    const focus=text.find(l=>l.id==='route-focus-room-labels').props.data;
    const check=focus.map(m=>{
     const f=r.all.find(f=>routeFeatureKey(f)===m.id),expected=m.type==='start'?r.expected.start:r.expected.end;
     return {id:m.id,name:m.roomName,floor:m.floor,correct:m.id===routeFeatureKey(expected),
      anchorMatches:JSON.stringify(m.position.slice(0,2))===JSON.stringify(getRoomLabelAnchor(f)),z:m.position[2]};
    });
    const long=text.find(l=>l.id==='route-landmark-room-labels');
    return {floor:r.floor,focus:check,longName:long?.props.data[0]?.roomName,
     textLayers:text.map(l=>({id:l.id,size:l.props.getSize,units:l.props.sizeUnits,maxWidth:l.props.maxWidth,collision:l.props.collisionEnabled,group:l.props.collisionGroup})),
     identities:r.floor==='all'?r.combined.reduce((a,f)=>{const status=f.properties.__routeIdentityStatus;a[status]=(a[status]||0)+1;return a;},{}):null};
   });
   assert(result.focus.every(m=>m.correct&&m.anchorMatches));
   assert.equal(new Set(result.focus.map(m=>m.id)).size,2);
   assert(result.focus.every(m=>Math.abs(m.z-(floor==='all'?Number(m.floor)*4.5+1.1:1.1))<1e-8));
   assert(result.longName);assert(result.textLayers.every(l=>l.units==='pixels'&&l.maxWidth===18));
   results.push(result);console.log('Verified floor',floor);
  }
  await page.evaluate(()=>{window.labelReview.setFloor(1);window.labelReview.setFallback(true);});
  await page.waitForFunction(()=>window.labelDeck()?.props.layers.find(l=>l.id==='route-transition-labels')?.props.data.length>0);
  results.push({case:'transition-fallback',passed:true});
  for(const mode of ['architectural','gis','day']){
   await page.evaluate(m=>window.labelReview.setNight(m),mode);await page.waitForTimeout(1000);
   const count=await page.evaluate(()=>window.labelDeck().props.layers.find(l=>l.id==='route-focus-room-labels').props.data.length);
   assert.equal(count,2);results.push({case:`labels-${mode}`,passed:true});
  }
  await page.screenshot({path:'docs/stage-2-route-labels/integration.png'});
  assert.deepEqual(errors,[]);
 }catch(e){results.push({failure:e.stack});throw e;}
 finally{fs.mkdirSync('docs/stage-2-route-labels',{recursive:true});fs.writeFileSync(out,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
