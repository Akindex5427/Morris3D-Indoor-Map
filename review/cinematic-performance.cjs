const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const out='docs/stage-6-final/cinematic-performance.json';
function instrument(){
 const p=window.perf={draws:0,blendDraws:0,commits:0,resources:{},frames:[],loads:[]};
 window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,onCommitFiberRoot:()=>p.commits++,onCommitFiberUnmount:()=>{}};
 window.reviewDeck=()=>{let f=document.querySelector('#deckgl-wrapper');f=f?.[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;}};
 window.surface=()=>reviewDeck()?.layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill');
 const contexts=new WeakSet(),original=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(...args){const gl=original.apply(this,args);if(!gl||!/^webgl|experimental-webgl/.test(args[0])||contexts.has(gl))return gl;contexts.add(gl);
  const ext=gl.getExtension('WEBGL_debug_renderer_info');p.renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  for(const kind of ['Buffer','Texture','Program','Framebuffer','Renderbuffer','VertexArray']){
   const live=new WeakSet(),stats=p.resources[kind]||=( {created:0,deleted:0,live:0} );
   for(const action of ['create','delete']){const fn=gl[action+kind];if(!fn)continue;gl[action+kind]=function(...a){const value=fn.apply(this,a);if(action==='create'&&value){live.add(value);stats.created++;stats.live++;}else if(action==='delete'&&a[0]&&live.has(a[0])){live.delete(a[0]);stats.deleted++;stats.live--;}return value;};}
  }
  let blend=gl.isEnabled(gl.BLEND);
  for(const key of ['enable','disable']){const fn=gl[key];gl[key]=function(cap){if(cap===gl.BLEND)blend=key==='enable';return fn.call(this,cap);};}
  for(const key of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const fn=gl[key];if(fn)gl[key]=function(...a){p.draws++;if(blend)p.blendDraws++;return fn.apply(this,a);};}
  return gl;
 };
 const fetch=window.fetch;window.fetch=async function(...args){if(/\.geojson/.test(String(args[0])))p.loads.push(String(args[0]));return fetch.apply(this,args);};
 let last=performance.now(),draws=0;
 function frame(now){p.frames.push({ms:now-last,draws:p.draws-draws});last=now;draws=p.draws;requestAnimationFrame(frame);}requestAnimationFrame(frame);
}
(async()=>{
 const report={date:new Date().toISOString(),cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,viewport:{width:1440,height:1000},runs:[]};
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11']});report.browser=browser.version();
 try{for(let run=1;run<=3;run++){
  const page=await browser.newPage({viewport:report.viewport}),cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await page.addInitScript(instrument);
  const errors=[],r={run,scenarios:[],cycles:[],errors};report.runs.push(r);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/GLSL|DeckGL error/.test(m.text()))errors.push(m.text());});
  await page.goto('http://127.0.0.1:3005');await page.waitForFunction(()=>surface()?.getModels().length&&reviewDeck().getViewports()[0].longitude<-89,null,{timeout:60000});
  await page.locator('#animation-toggle').uncheck();await page.waitForTimeout(1200);
  r.renderer=await page.evaluate(()=>perf.renderer);
  const state=()=>page.evaluate(()=>({time:performance.now(),draws:perf.draws,blendDraws:perf.blendDraws,commits:perf.commits,frames:perf.frames.length,resources:structuredClone(perf.resources)}));
  const measure=async(name,fn)=>{
   const start=await state();await fn();
   const end=await state();const frames=await page.evaluate(i=>perf.frames.slice(i),start.frames);
   const times=frames.map(f=>f.ms).sort((a,b)=>a-b),q=t=>times[Math.min(times.length-1,Math.floor(times.length*t))]||0;
   const ms=end.time-start.time,drawn=frames.filter(f=>f.draws).length;
   const row={name,elapsedMs:ms,p50:q(.5),p95:q(.95),p99:q(.99),slowFrames:times.filter(t=>t>50).length,drawnFrames:drawn,
    drawCalls:end.draws-start.draws,blendEnabledDrawCalls:end.blendDraws-start.blendDraws,drawCallsPerDrawnFrame:(end.draws-start.draws)/Math.max(1,drawn),
    rootCommits:end.commits-start.commits,rootCommitsPerSecond:(end.commits-start.commits)/ms*1000,resourcesBefore:start.resources,resourcesAfter:end.resources};
   r.scenarios.push(row);console.log(run,name,'p95',row.p95.toFixed(1),'draws/frame',row.drawCallsPerDrawnFrame.toFixed(1));fs.writeFileSync(out,JSON.stringify(report,null,2));
  };
  const night=page.locator('#night-mode-toggle');
  const endpoint=async n=>page.waitForFunction(n=>surface()?.props.environment.progress===Number(n)&&surface()?.props.getFixtureGain()===Number(n),n,{timeout:18000});
  const camera=async()=>{const b=await page.locator('#deckgl-overlay').boundingBox(),x=b.x+b.width*.5,y=b.y+b.height*.5;await page.mouse.move(x,y);for(let i=0;i<4;i++){await page.mouse.wheel(0,i%2?70:-70);await page.waitForTimeout(650);}};
  await measure('F1-sunset-with-wheel',async()=>{await night.check();await camera();await endpoint(true);});
  await page.evaluate(()=>{const s=surface();window.retained={atlas:s.state.atlasEntry,data:s.props.data,models:s.getModels()};});
  await measure('F1-night-idle',async()=>page.waitForTimeout(1500));
  await measure('F1-dawn-with-wheel',async()=>{await night.uncheck();await camera();await endpoint(false);});
  await page.getByRole('button',{name:'F-All',exact:true}).click();await page.waitForTimeout(1800);
  await measure('F-ALL-sunset-with-wheel',async()=>{await night.check();await camera();await endpoint(true);});
  await measure('F-ALL-gis-preset',async()=>{await page.locator('input[name="night-visualization-style"][value="gis"]').check({force:true});await page.waitForTimeout(900);});
  await measure('F-ALL-dawn-with-wheel',async()=>{await night.uncheck();await camera();await endpoint(false);});
  await page.getByRole('button',{name:'F1',exact:true}).click();await page.waitForTimeout(700);
  await page.getByRole('button',{name:'Plan Route',exact:true}).click();
  await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
  await page.getByPlaceholder('Search end room...').fill('0181');await page.locator('.route-suggestion-item-clickable').first().click();
  await measure('route-calculation-first',async()=>{await page.getByRole('button',{name:'Find Route',exact:true}).click();await page.waitForTimeout(1200);});
  await measure('route-preview-during-sunset',async()=>{await night.check();await camera();await endpoint(true);});
  await page.getByRole('button',{name:'Clear Route',exact:true}).click();
  await page.emulateMedia({reducedMotion:'reduce'});await night.uncheck();await endpoint(false);
  for(let i=0;i<3;i++){
   await page.getByRole('button',{name:'Plan Route',exact:true}).click();
   await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
   await page.getByPlaceholder('Search end room...').fill('0181');await page.locator('.route-suggestion-item-clickable').first().click();
   await measure(`route-recalculation-${i+1}`,async()=>{await page.getByRole('button',{name:'Find Route',exact:true}).click();await page.waitForTimeout(1000);});
   await page.getByRole('button',{name:'Clear Route',exact:true}).click();
  }
  await night.check();await endpoint(true);await page.waitForTimeout(500);
  await page.evaluate(()=>{const s=surface();window.cycleRefs={atlas:s.state.atlasEntry,data:s.props.data,models:s.getModels()};});
  for(let cycle=0;cycle<=10;cycle++){
   if(cycle){await night.uncheck();await endpoint(false);await night.check();await endpoint(true);}
   await page.waitForTimeout(180);await cdp.send('HeapProfiler.collectGarbage');
   const heap=await cdp.send('Runtime.getHeapUsage'),snap=await state();
   const stable=await page.evaluate(()=>{const s=surface();return {atlas:s.state.atlasEntry===cycleRefs.atlas,data:s.props.data===cycleRefs.data,models:s.getModels().every((m,i)=>m===cycleRefs.models[i])};});assert(Object.values(stable).every(Boolean));
   r.cycles.push({cycle,heapBytes:heap.usedSize,resources:snap.resources,stable});
  }
  r.lightRequests=await page.evaluate(()=>perf.loads.filter(url=>url.endsWith('/interior_lights.geojson')).length);assert.equal(r.lightRequests,1);assert.deepEqual(errors,[]);
  fs.writeFileSync(out,JSON.stringify(report,null,2));await page.close();
 }}catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync(out,JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
