const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs');
(async()=>{
 const out='docs/stipple-regression';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const page=await browser.newPage({viewport:{width:1228,height:920},deviceScaleFactor:1}),results=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/GLSL|DeckGL error/.test(m.text()))errors.push(m.text());});
 try{
  await page.goto('http://127.0.0.1:3004/review/stipple-review.html');await page.waitForFunction(()=>window.stippleReview?.ready,null,{timeout:60000});await page.waitForTimeout(800);
  for(const floor of [1,'all'])for(const progress of [0,.2,.28,.32,.4,.6,.8,1])for(const variant of progress===.2||progress===.28?['original','no-rejection']:['original']){
   await page.evaluate(({floor,progress,variant})=>{stippleReview.setFloor(floor);stippleReview.setProgress(progress);stippleReview.setVariant(variant);},{floor,progress,variant});await page.waitForTimeout(450);
   const data=await page.evaluate(()=>{const d=stippleReview.getDeck(),gl=d.layerManager.getLayers().find(l=>!l.isComposite).context.gl;
    return {floor:stippleReview.floor,progress:stippleReview.progress,variant:stippleReview.variant,surfaceNight:stippleReview.environment.surfaceNight,
     alphaToCoverage:gl.isEnabled(gl.SAMPLE_ALPHA_TO_COVERAGE),samples:gl.getParameter(gl.SAMPLES),dpr:devicePixelRatio,layers:d.layerManager.getLayers().map(l=>l.id)};});
   await page.screenshot({path:`${out}/before-${floor}-${progress}-${variant}.png`});results.push(data);
  }
 }catch(e){results.push({failure:e.stack});throw e;}finally{fs.writeFileSync(`${out}/ablation.json`,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
