const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),crypto=require('node:crypto');
const out=process.env.PERF_VISUAL_OUTPUT||'docs/stage-7-performance/visual-before';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.visualDeck=()=>{let f=document.querySelector('#deckgl-wrapper');f=f?.[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}};});
 try {
  await page.goto('http://127.0.0.1:3002');await page.waitForFunction(()=>window.visualDeck()?.getViewports()[0]?.longitude<-89,null,{timeout:60000});await page.locator('#animation-toggle').uncheck();
  for(const floor of [1,'all']){
   await page.getByRole('button',{name:floor==='all'?'F-All':`F${floor}`,exact:true}).click();
   await page.waitForFunction(count=>window.visualDeck()?.props.layers.find(l=>/^indoor-building-(night-)?layer$/.test(l.id))?.props.data.features.length===count,floor==='all'?1608:355);
   for(const style of ['day','architectural','gis']){
    if(style==='day')await page.locator('#night-mode-toggle').uncheck();else {await page.locator('#night-mode-toggle').check();await page.locator(`input[name="night-visualization-style"][value="${style}"]`).check({force:true});}
    await page.evaluate(()=>window.visualDeck().props.onViewStateChange({viewState:{longitude:-89.2204671758,latitude:37.7152913603,zoom:19.5,pitch:45,bearing:15,transitionDuration:0},interactionState:{}}));
    await page.mouse.move(0,0);await page.waitForTimeout(2500);
    const geometry=await page.evaluate(()=>window.visualDeck().props.layers.filter(l=>l.id.startsWith('indoor-building')||l.id.startsWith('procedural-interior')).map(l=>({id:l.id,data:l.props.data.features.map(f=>({geometry:f.geometry,properties:f.properties,color:l.props.getFillColor(f)}))})));
    results.push({floor,style,hash:crypto.createHash('sha256').update(JSON.stringify(geometry)).digest('hex')});
    // Snapshot Deck only: external basemap tiles are not deterministic.
    await page.evaluate(()=>{window.savedScreen=null;const d=window.visualDeck(),previous=d.props.onAfterRender;d.setProps({onAfterRender:()=>{window.savedScreen=d.canvas.toDataURL();d.setProps({onAfterRender:previous});}});d.redraw(true);});
    await page.waitForFunction(()=>window.savedScreen);const png=await page.evaluate(()=>window.savedScreen);
    fs.writeFileSync(`${out}/F${floor}-${style}.png`,Buffer.from(png.split(',')[1],'base64'));console.log('Captured',floor,style);
   }
  }
 } finally {fs.writeFileSync(`${out}/results.json`,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
