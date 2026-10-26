const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11']});const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 try{
  await page.goto('http://127.0.0.1:3005');await page.locator('#animation-toggle').uncheck();await page.waitForTimeout(1800);
  await page.evaluate(()=>{
   let f=document.querySelector('#deckgl-wrapper');f=f[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)window.reviewDeck=h.memoizedState.current.deck;h=h.next;}f=f.return;}
   window.allocations=[];
   for(const canvas of document.querySelectorAll('canvas')){
    const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');if(!gl)continue;
    const original=gl.createTexture;gl.createTexture=function(...a){allocations.push(canvas.className+' / '+canvas.id+'\n'+new Error().stack);return original.apply(this,a);};
   }
   window.refs=()=>reviewDeck.layerManager.getLayers().filter(l=>!l.isComposite).map(l=>({id:l.id,layer:l,models:l.getModels(),data:l.props.data,mesh:l.props.mesh}));
   window.previous=refs();
  });
  const results=[];
  for(const night of [true,false,true]){
   await page.locator('#night-mode-toggle').setChecked(night);await page.waitForTimeout(500);
   results.push(await page.evaluate(()=>{const next=refs(),changed=next.filter(n=>{const old=previous.find(p=>p.id===n.id);return !old||n.models.some((m,i)=>m!==old.models[i]);}).map(n=>({id:n.id,dataSame:previous.find(p=>p.id===n.id)?.data===n.data,meshSame:previous.find(p=>p.id===n.id)?.mesh===n.mesh}));previous=next;const result={changed,textureCreations:allocations.length,stacks:[...new Set(allocations)].slice(0,10)};allocations=[];return result;}));
  }
  fs.writeFileSync('docs/stage-6-final/allocation-attribution.json',JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
