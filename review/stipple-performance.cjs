const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11']});
 const report={browser:browser.version(),viewport:{width:1228,height:920},runs:[]};
 try{for(let run=1;run<=3;run++){
  const page=await browser.newPage({viewport:report.viewport});await page.addInitScript(()=>{
   window.stipplePerf={draws:0,resources:{}};const seen=new WeakSet(),original=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(...a){const gl=original.apply(this,a);if(!gl||!/^webgl/.test(a[0])||seen.has(gl))return gl;seen.add(gl);
    const ext=gl.getExtension('WEBGL_debug_renderer_info');stipplePerf.renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    for(const kind of ['Buffer','Texture','Program','Framebuffer','Renderbuffer']){
     const live=new WeakSet(),s=stipplePerf.resources[kind]||=( {created:0,deleted:0,live:0} );
     for(const action of ['create','delete']){const fn=gl[action+kind];if(fn)gl[action+kind]=function(...a){const value=fn.apply(this,a);if(action==='create'&&value){live.add(value);s.created++;s.live++;}else if(action==='delete'&&a[0]&&live.has(a[0])){live.delete(a[0]);s.deleted++;s.live--;}return value;};}
    }
    for(const key of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const fn=gl[key];if(fn)gl[key]=function(...a){stipplePerf.draws++;return fn.apply(this,a);};}
    return gl;
   };
  });
  await page.goto('http://127.0.0.1:3004/review/stipple-review.html');await page.waitForFunction(()=>window.stippleReview?.ready,null,{timeout:60000});
  const rows=[];
  for(const floor of [1,'all'])for(const variant of run===2?['fixed','original']:['original','fixed']){
   await page.evaluate(({floor,variant})=>{stippleReview.setFloor(floor);stippleReview.setVariant(variant);stippleReview.setProgress(.2);},{floor,variant});await page.waitForTimeout(600);
   await page.waitForFunction(()=>{
    const r=stippleReview,d=r.getDeck();return r.layers.every(expected=>{
     const actual=d.layerManager.getLayers().find(l=>l.id===expected.id);
     return actual&&actual.props.data===expected.props.data&&actual.props.environmentDepthProgress===expected.props.environmentDepthProgress;
    });
   },null,{timeout:30000});
   // Warm the same camera path before counting: floor changes can finish their
   // first mesh upload on the first camera draw, despite data already matching.
   await page.evaluate(()=>new Promise(resolve=>{let i=0;const tick=()=>{
    stippleReview.setView({longitude:-89.2204671758,latitude:37.7152913603,zoom:19+.05*Math.sin(i/10),pitch:55,bearing:15+12*Math.sin(i/18)});
    if(++i<45)requestAnimationFrame(tick);else resolve();
   };requestAnimationFrame(tick);}));await page.waitForTimeout(250);
   const r=await page.evaluate(()=>new Promise(resolve=>{
    const start=performance.now(),before=structuredClone(stipplePerf.resources),draws=stipplePerf.draws,times=[];let last=start,i=0;
    const animate=now=>{times.push(now-last);last=now;
     stippleReview.setView({longitude:-89.2204671758,latitude:37.7152913603,zoom:19+.05*Math.sin(i/10),pitch:55,bearing:15+12*Math.sin(i/18)});
     if(++i<120)return requestAnimationFrame(animate);
     const sorted=times.slice(2).sort((a,b)=>a-b),q=t=>sorted[Math.floor(sorted.length*t)];
     resolve({floor:stippleReview.floor,variant:stippleReview.variant,p50:q(.5),p95:q(.95),p99:q(.99),elapsedMs:now-start,frames:i,drawCalls:stipplePerf.draws-draws,
      resourcesBefore:before,resourcesAfter:structuredClone(stipplePerf.resources)});
    };requestAnimationFrame(animate);
   }));
   rows.push(r);console.log(run,floor,variant,r.p95,r.drawCalls);
  }
  await page.evaluate(()=>{stippleReview.setFloor(1);stippleReview.setVariant('fixed');stippleReview.setProgress(.2);});await page.waitForTimeout(500);
  const initial=await page.evaluate(()=>structuredClone(stipplePerf.resources));
  for(let cycle=0;cycle<5;cycle++)for(const p of [0,.2,.4,1,.4,.2,0]){await page.evaluate(p=>stippleReview.setProgress(p),p);await page.waitForTimeout(40);}
  const settled=await page.evaluate(()=>structuredClone(stipplePerf.resources));
  assert.equal(settled.Texture.created,initial.Texture.created);assert.equal(settled.Program.created,initial.Program.created);assert.equal(settled.Framebuffer.created,initial.Framebuffer.created);
  report.runs.push({run,renderer:await page.evaluate(()=>stipplePerf.renderer),rows,repeatedTransitions:{cycles:5,initial,settled}});
  fs.writeFileSync('docs/stipple-regression/performance.json',JSON.stringify(report,null,2));await page.close();
 }}catch(e){report.failure=e.stack;throw e;}finally{fs.writeFileSync('docs/stipple-regression/performance.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
