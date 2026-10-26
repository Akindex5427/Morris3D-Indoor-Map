const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const out='docs/stipple-regression',browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1228,height:920},deviceScaleFactor:2}),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:3004/review/stipple-review.html');await page.waitForFunction(()=>window.stippleReview?.ready,null,{timeout:60000});
  for(const group of ['all','rooms','walls','envelope'])for(const variant of ['original','fixed']){
   await page.evaluate(({group,variant})=>{const r=stippleReview;r.setFloor('all');r.setGroup(group);r.setVariant(variant);r.setProgress(.2);},{group,variant});
   await page.waitForTimeout(500);await page.screenshot({path:`${out}/dpr2-${group}-${variant}.png`});results.push({dpr:2,group,variant});
  }
  // Early handoff, smooth endpoint approach, and rapid direction changes.
  for(const p of [0,.0001,.1,.2,.19,.25,.12,.3,.2,.3599,.36,1,0]){
   await page.evaluate(p=>{stippleReview.setGroup('all');stippleReview.setVariant('fixed');stippleReview.setProgress(p);},p);await page.waitForTimeout(80);
   await page.waitForFunction(()=>stippleReview.getDeck().layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill')?.props.environment.progress===stippleReview.progress,null,{timeout:30000});
   results.push({case:'DPR2 reversal/endpoint',p});
  }
  await page.evaluate(()=>{
   const d=stippleReview.getDeck();window.ownedDepthBuffers=d.deckRenderer.renderBuffers.map(buffer=>({buffer,color:buffer.color,depth:buffer.attachments[d.layerManager.context.gl.DEPTH_ATTACHMENT]}));
   window.ownedDepthEffect=d.effectManager.getEffects().find(e=>e.id==='environment-depth-resolve');unmountStippleReview();
  });await page.waitForTimeout(150);
  const cleanup=await page.evaluate(()=>({canvases:document.querySelectorAll('canvas').length,modelDisposed:ownedDepthEffect.model===null,
   buffers:ownedDepthBuffers.map(r=>({framebuffer:r.buffer.handle===null,color:r.color.handle===null,depth:r.depth?.handle===null}))}));
  assert.equal(cleanup.canvases,0);assert(cleanup.modelDisposed);assert(cleanup.buffers.length===2&&cleanup.buffers.every(r=>r.framebuffer&&r.color&&r.depth));results.push({case:'postprocess cleanup',...cleanup});
  assert.deepEqual(errors,[]);
 }catch(e){results.push({failure:e.stack});throw e;}finally{fs.writeFileSync(`${out}/additional.json`,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
