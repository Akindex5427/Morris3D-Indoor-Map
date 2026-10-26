// Repeatable production-browser workload. Instrumentation is identical before/after.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const output = process.env.PERF_OUTPUT || 'docs/stage-7-performance/before.json';
const repeats = Number(process.env.PERF_REPEATS || 3);
const url = process.env.PERF_URL || 'http://127.0.0.1:3002';
const angle = process.env.PERF_ANGLE || 'swiftshader';
const report = { date: new Date().toISOString(), url, cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, memoryGB: os.totalmem()/2**30, repeats, runs: [] };
fs.mkdirSync(require('node:path').dirname(output), {recursive:true});
function installProbe() {
  const p = window.probe = { frames: [], draws: 0, deckDraws: 0, meshes: 0, json: [], loads: [], workers: [], longTasks: [], resources: {}, uploads: 0, bytes: 0 };
  window.testDeck = () => { const node=document.querySelector('#deckgl-wrapper'); let f=node?.[Object.keys(node).find(k=>k.startsWith('__reactFiber'))]; while(f){let h=f.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;}f=f.return;} };
  const contexts = new WeakSet();
  const getContext=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(...args){const gl=getContext.apply(this,args);if(!gl||!/^webgl|experimental-webgl/.test(args[0])||contexts.has(gl))return gl;contexts.add(gl);
    if(!p.renderer){const ext=gl.getExtension('WEBGL_debug_renderer_info');p.renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}
    for(const kind of ['Buffer','Texture','Program','Shader','Framebuffer','Renderbuffer','VertexArray']){
      const live=new WeakSet(); const stats=p.resources[kind] ||= {created:0,deleted:0,live:0};
      for(const action of ['create','delete']){const key=action+kind,original=gl[key];if(!original)continue;gl[key]=function(...a){const value=original.apply(this,a);if(action==='create'&&value){live.add(value);stats.created++;stats.live++;}else if(action==='delete'&&a[0]&&live.has(a[0])){live.delete(a[0]);stats.deleted++;stats.live--;}return value;};}
    }
    for(const key of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const original=gl[key];if(original)gl[key]=function(...a){p.draws++;if(this.canvas.id==='deckgl-overlay')p.deckDraws++;return original.apply(this,a);};}
    for(const key of ['bufferData','bufferSubData']){const original=gl[key];gl[key]=function(...a){p.uploads++;p.bytes+=typeof a[1]==='number'&&key==='bufferData'?a[1]:(a[key==='bufferData'?1:2]?.byteLength||0);return original.apply(this,a);};}
    return gl;
  };
  const fetch=window.fetch;window.fetch=async function(...args){const start=performance.now();const response=await fetch.apply(this,args);if(/\.geojson/.test(String(args[0])))p.loads.push({url:String(args[0]),headersMs:performance.now()-start});return response;};
  const json=Response.prototype.json;Response.prototype.json=async function(...args){const start=performance.now();const result=await json.apply(this,args);if(/\.geojson/.test(this.url))p.json.push({url:this.url,ms:performance.now()-start,features:result.features?.length});return result;};
  const Worker=window.Worker;window.Worker=class extends Worker{constructor(...a){super(...a);this.addEventListener('message',e=>{if(e.data?.result)p.workers.push(e.data.result);});}};
  new PerformanceObserver(list=>p.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});
  let last=performance.now(),draws=0,meshes=new Map();
  function frame(now){const next=new Map();for(const l of window.testDeck()?.props.layers||[]){if(l.props.mesh){if(meshes.has(l.id)&&meshes.get(l.id)!==l.props.mesh)p.meshes++;next.set(l.id,l.props.mesh);}}meshes=next;p.frames.push({ms:now-last,draws:p.draws-draws});last=now;draws=p.draws;requestAnimationFrame(frame);}requestAnimationFrame(frame);
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:[`--use-angle=${angle}`,...(angle==='swiftshader'?['--enable-unsafe-swiftshader']:[])]});report.chrome=browser.version();report.viewport={width:1440,height:1000};report.rendering=`Headless Chrome, ANGLE ${angle}, deviceScaleFactor 1`;
 try { for(let run=0;run<repeats;run++){
  const context=await browser.newContext({viewport:report.viewport,deviceScaleFactor:1,reducedMotion:process.env.PERF_REDUCED_MOTION||'no-preference'});const page=await context.newPage(),cdp=await context.newCDPSession(page);page.setDefaultTimeout(60000);await cdp.send('Performance.enable');await page.addInitScript(installProbe);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const result={run:run+1,scenarios:[],errors};report.runs.push(result);
  const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const snap=()=>page.evaluate(()=>{const p=window.probe;return {time:performance.now(),frame:p.frames.length,draws:p.draws,deckDraws:p.deckDraws,meshes:p.meshes,uploads:p.uploads,bytes:p.bytes,resources:structuredClone(p.resources)};});
  const finish=async(name,start,cpu,extra={})=>{const end=await snap(),after=await metrics();const data=await page.evaluate(start=>{const p=window.probe,frames=p.frames.slice(start.frame),times=frames.map(f=>f.ms).sort((a,b)=>a-b),q=n=>times[Math.min(times.length-1,Math.floor(times.length*n))]||0;return {rafFrames:frames.length,drawnFrames:frames.filter(f=>f.draws>0).length,p50FrameMs:q(.5),p95FrameMs:q(.95),p99FrameMs:q(.99),slowFrames:frames.filter(f=>f.ms>50).length,longTasks:p.longTasks.filter(t=>t.start>=start.time),topLayers:window.testDeck()?.props.layers.map(l=>({id:l.id,count:l.props.data?.features?.length??l.props.data?.length??0})),resources:p.resources};},start);const elapsedMs=end.time-start.time;const row={name,elapsedMs,rafFPS:data.rafFrames/elapsedMs*1000,drawnFPS:data.drawnFrames/elapsedMs*1000,...data,drawCalls:end.draws-start.draws,deckDrawCalls:end.deckDraws-start.deckDraws,wallMeshReplacements:end.meshes-start.meshes,bufferUploads:end.uploads-start.uploads,bufferBytes:end.bytes-start.bytes,taskMs:(after.TaskDuration-cpu.TaskDuration)*1000,scriptMs:(after.ScriptDuration-cpu.ScriptDuration)*1000,heapMB:after.JSHeapUsedSize/2**20,...extra};result.scenarios.push(row);console.log(run+1,name,Math.round(elapsedMs)+'ms',row.p95FrameMs.toFixed(1)+'ms p95','meshes='+row.wallMeshReplacements);fs.writeFileSync(output,JSON.stringify(report,null,2));};
  const measure=async(name,action)=>{const cpu=await metrics(),start=await snap();const extra=await action();await finish(name,start,cpu,extra||{});};
  const room=()=>page.evaluate(()=>window.testDeck()?.props.layers.find(l=>/^indoor-building-(night-)?layer$/.test(l.id))?.props.data.features.length);
  const floor=async n=>{await page.getByRole('button',{name:n==='all'?'F-All':`F${n}`,exact:true}).click();await page.waitForFunction(n=>{const l=window.testDeck()?.props.layers.find(l=>/^indoor-building-(night-)?layer$/.test(l.id));return l&& (n==='all'?l.props.data.features.length===1608:l.props.data.features.every(f=>Number(f.properties.floor??f.properties.level)===n));},n,{timeout:60000});};
  const camera=async()=>{const box=await page.locator('#deckgl-overlay').boundingBox();const x=box.x+box.width*.55,y=box.y+box.height*.5;await page.mouse.move(x,y);await page.mouse.wheel(0,140);await page.waitForTimeout(400);await page.mouse.down();for(let i=1;i<=12;i++)await page.mouse.move(x+i*3,y+i,{steps:1});await page.mouse.up();await page.mouse.down({button:'right'});for(let i=1;i<=12;i++)await page.mouse.move(x+36+i*2,y+12-i,{steps:1});await page.mouse.up({button:'right'});await page.waitForTimeout(1100);};
  const select=async(q,n)=>{await page.getByRole('combobox',{name:'Search rooms on all floors'}).fill(q);await page.getByRole('option').filter({hasText:`F${n}`}).first().click();await page.waitForFunction(n=>document.querySelector('.floor-btn.active')?.textContent===`F${n}`&&window.testDeck()?.getViewports()[0].pitch===0,n,{timeout:60000});await page.waitForTimeout(200);};
  const cpu=await metrics();await page.goto(url);await page.waitForFunction(()=>window.testDeck()?.getViewports()[0]?.longitude<-89,null,{timeout:60000});await page.waitForTimeout(3000);await finish('initial-F1',{time:0,frame:0,draws:0,deckDraws:0,meshes:0,uploads:0,bytes:0},cpu,{features:await room()});result.renderer=await page.evaluate(()=>window.probe.renderer);
  await page.locator('#animation-toggle').uncheck();await measure('F1-camera',camera);
  await measure('F-ALL-load',async()=>{await floor('all');await page.waitForTimeout(1600);});await measure('F-ALL-camera',camera);
  await measure('floor-switch-all-eight',async()=>{for(let n=0;n<8;n++){await floor(n);await page.waitForTimeout(150);}});
  await measure('search',async()=>{const latencies=[];for(const q of ['staff','0362','room','library']){const start=Date.now();await page.getByRole('combobox',{name:'Search rooms on all floors'}).fill(q);await page.getByRole('option').first().waitFor();latencies.push({q,ms:Date.now()-start,count:await page.getByRole('option').count()});}return {latencies};});
  await select('0362',3);await measure('above-below-first',async()=>{await page.getByRole('button',{name:'Rooms Above & Below',exact:true}).click();await page.waitForFunction(()=>window.probe.workers.length>0);return {analysis:await page.evaluate(()=>{const r=window.probe.workers.at(-1);return {status:r.status,analysisMs:r.analysisMs,preparationMs:r.preparationMs,counts:r.groups?.map(g=>({floor:g.floor,count:g.matches.length}))};})};});
  await page.getByRole('button',{name:'Close room correspondence',exact:true}).click();await measure('above-below-cached',async()=>{await page.getByRole('button',{name:'Rooms Above & Below',exact:true}).click();await page.waitForFunction(()=>window.probe.workers.length===2);return {cacheHit:await page.evaluate(()=>window.probe.workers.at(-1).cacheHit)};});await page.getByRole('button',{name:'Close room correspondence',exact:true}).click();
  await floor('all');await page.getByRole('button',{name:'Fit building / Reset view',exact:true}).click();await page.waitForTimeout(1800);
  for(const style of ['architectural','gis']){await measure(`night-${style}-load`,async()=>{await page.locator('#night-mode-toggle').check();await page.locator(`input[name="night-visualization-style"][value="${style}"]`).check({force:true});await page.waitForTimeout(1400);});await measure(`night-${style}-camera`,camera);}
  await page.locator('#night-mode-toggle').uncheck();await select('0174',1);await page.getByRole('button',{name:'Plan Route',exact:true}).click();await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();await page.getByPlaceholder('Search end room...').fill('0181');await page.locator('.route-suggestion-item-clickable').first().click();
  await measure('route-plan',async()=>{await page.getByRole('button',{name:'Find Route',exact:true}).click();await page.waitForTimeout(2000);assert(await page.evaluate(()=>window.testDeck().props.layers.some(l=>l.id.includes('route'))));});
  await measure('route-label-camera',camera);
  await page.locator('#animation-toggle').check();await page.waitForTimeout(1800);if(await page.locator('.route-preview-launch-btn').count())await page.locator('.route-preview-launch-btn').click();else await page.getByTitle('Restart preview').click();
  await measure('route-animated-preview',async()=>{await page.waitForTimeout(4000);return {previewLayers:await page.evaluate(()=>window.testDeck().props.layers.filter(l=>l.id.includes('preview')).map(l=>l.id))};});
  await page.getByRole('button',{name:'Clear Route',exact:true}).click();await page.locator('#animation-toggle').uncheck();
  result.memoryCycles=[];
  for(let cycle=0;cycle<4;cycle++){await floor(1);await page.locator('#night-mode-toggle').uncheck();await page.waitForTimeout(500);await cdp.send('HeapProfiler.collectGarbage');result.memoryCycles.push({cycle,...await metrics(),...await snap()});if(cycle<3){await floor('all');await page.locator('#night-mode-toggle').check();await page.locator('input[name="night-visualization-style"][value="architectural"]').check({force:true});await page.waitForTimeout(300);await page.locator('input[name="night-visualization-style"][value="gis"]').check({force:true});}}
  result.network=await page.evaluate(()=>({loads:window.probe.loads,json:window.probe.json,resources:performance.getEntriesByType('resource').filter(r=>/\.geojson/.test(r.name)).map(r=>({name:r.name,duration:r.duration,transferSize:r.transferSize}))}));assert.deepEqual(errors,[]);fs.writeFileSync(output,JSON.stringify(report,null,2));await context.close();
 }}catch(error){report.failure={message:error.message,stack:error.stack};throw error;}finally{fs.writeFileSync(output,JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
