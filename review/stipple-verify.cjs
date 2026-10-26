const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const out='docs/stipple-regression';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1228,height:920},deviceScaleFactor:1}),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/GLSL|DeckGL error/.test(m.text()))errors.push(m.text());});
 const frame=async(floor,preset,variant,progress)=>{
  await page.evaluate(v=>{const r=stippleReview;r.setFloor(v.floor);r.setPreset(v.preset);r.setVariant(v.variant);r.setProgress(v.progress);},{floor,preset,variant,progress});
  await page.waitForFunction(({floor,preset,variant,progress})=>{const r=window.stippleReview,s=r?.getDeck()?.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill');
   const d=r?.getDeck();
   return r?.floor===floor&&r.preset===preset&&r.variant===variant&&r.progress===progress&&r.ready&&s?.getModels().length&&s.props.environment.progress===progress&&
     r.layers.every(expected=>{const actual=d.layerManager.getLayers().find(l=>l.id===expected.id);return actual&&actual.props.data===expected.props.data&&actual.props.getFillColor===expected.props.getFillColor&&actual.props.environmentDepthProgress===expected.props.environmentDepthProgress;});
  },{floor,preset,variant,progress},{timeout:30000});await page.waitForTimeout(100);
  return page.evaluate(()=>new Promise(resolve=>{
   const d=stippleReview.getDeck(),previous=d.props.onAfterRender;
   d.setProps({onAfterRender:()=>{const png=d.canvas.toDataURL();d.setProps({onAfterRender:previous});resolve(png);}});d.redraw(true);
  }));
 };
 try{
  await page.goto('http://127.0.0.1:3004/review/stipple-review.html');await page.waitForFunction(()=>window.stippleReview?.ready,null,{timeout:60000});
  for(const floor of [0,1,2,3,4,5,6,7,'all'])for(const preset of ['architectural','gis']){
   for(const progress of [0,1]){
    const before=await frame(floor,preset,'original',progress),after=await frame(floor,preset,'fixed',progress);
    if(after!==before){
     fs.writeFileSync(`${out}/mismatch-before-${floor}-${preset}-${progress}.png`,Buffer.from(before.split(',')[1],'base64'));
     fs.writeFileSync(`${out}/mismatch-after-${floor}-${preset}-${progress}.png`,Buffer.from(after.split(',')[1],'base64'));
    }
    assert(after===before,`${floor}/${preset}/${progress} endpoint raster changed (PNG files saved)`);
    results.push({case:'exact endpoint raster',floor,preset,progress,identical:true});
   }
  }
  for(const floor of [1,'all'])for(const preset of ['architectural','gis']){
   await frame(floor,preset,'fixed',0);
   await page.evaluate(()=>{const d=stippleReview.getDeck();window.stableRefs=d.layerManager.getLayers().filter(l=>!l.isComposite).map(l=>({id:l.id,data:l.props.data,models:l.getModels(),atlas:l.state.atlasEntry}));});
   for(const progress of [0,.1,.2,.28,.32,.36,.4,.6,.8,1,.8,.6,.4,.32,.28,.2,.1,0]){
    const png=await frame(floor,preset,'fixed',progress);
    const stable=await page.evaluate(()=>stableRefs.every(r=>{const l=stippleReview.getDeck().layerManager.getLayers().find(l=>l.id===r.id);return l&&l.props.data===r.data&&l.state.atlasEntry===r.atlas&&l.getModels().every((m,i)=>m===r.models[i]);}));
    assert(stable);results.push({case:'forward/reverse complete surfaces',floor,preset,progress,stable});
    if([.2,.4,.6,1].includes(progress))fs.writeFileSync(`${out}/verified-${floor}-${preset}-${progress}.png`,Buffer.from(png.split(',')[1],'base64'));
   }
  }
  for(const view of [
   {zoom:18.3,pitch:0,bearing:0},{zoom:19,pitch:45,bearing:75},{zoom:20,pitch:65,bearing:180},
  ]){
   await page.evaluate(v=>stippleReview.setView({...stippleReview.getDeck().getViewports()[0],...v}),view);
   await frame('all','architectural','fixed',.2);await page.screenshot({path:`${out}/camera-${view.zoom}-${view.pitch}.png`});
   results.push({case:'camera',...view});
  }
  assert.deepEqual(errors,[]);
 }catch(e){results.push({failure:e.stack});throw e;}finally{fs.writeFileSync(`${out}/verification.json`,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
