// Runtime raster measurements of the application's existing route TextLayers.
// Isolate one real label at a time to avoid collision/occlusion affecting bounds.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const output = process.env.LABEL_REPORT || 'docs/route-label-refinement/after-pixels.json';
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({channel:'chrome', headless:true,
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport:{width:1440,height:1000}, reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('console', m=>{if(m.text().startsWith('LABEL:'))console.log(m.text());});
  await page.addInitScript(()=>{window.labelDeck=()=>{
    let f=document.querySelector('#deckgl-wrapper');
    f=f?.[Object.keys(f).find(k=>k.startsWith('__reactFiber'))];
    while(f){let h=f.memoizedState;while(h&&typeof h==='object'){
      if(h.memoizedState?.current?.deck)return h.memoizedState.current.deck;h=h.next;
    }f=f.return;}
  };});
  const report={method:'Chrome headless, SwiftShader, 1440x1000, DPR 1. Real route TextLayer cloned to an isolated Deck canvas using the same viewport dimensions; alpha>16 raster bounds, collision disabled only during measurement.',errors};
  try {
    await page.goto(process.env.LABEL_URL || 'http://127.0.0.1:3004');
    console.log('LABEL: application loaded');
    if (process.env.LABEL_HARNESS) {
      await page.waitForFunction(()=>window.labelReview,null,{timeout:60000});
      await page.evaluate(()=>{window.labelReview.setFloor(6);window.labelReview.setFallback(true);});
      await page.waitForFunction(()=>window.labelDeck()?.props.layers.filter(l=>l.id.includes('labels')&&l.props.data.length).length===4);
    } else {
    await page.waitForFunction(()=>window.labelDeck()?.getViewports()[0]?.longitude < -89,null,{timeout:60000});
    await page.locator('#animation-toggle').uncheck();
    await page.getByRole('button',{name:'Plan Route',exact:true}).click();
    await page.getByPlaceholder('Search start room...').fill('0174');
    await page.locator('.route-suggestion-body').first().click();
    await page.getByPlaceholder('Search end room...').fill('0181');
    await page.locator('.route-suggestion-item-clickable').first().click();
    await page.getByRole('button',{name:'Find Route',exact:true}).click();
    await page.waitForFunction(()=>window.labelDeck()?.props.layers.some(l=>l.id==='route-focus-room-labels'));
    await page.waitForTimeout(4000);
    // Pause the automatic preview before measuring; no application source changes.
    const pause=page.getByTitle('Pause preview');
    if(await pause.count()) await pause.first().click();
    }
    await page.waitForTimeout(300);
    console.log('LABEL: route ready');
    report.route=await page.evaluate(()=>window.labelDeck().props.layers.filter(l=>l.id.includes('labels')).map(l=>({id:l.id,names:l.props.data.map(d=>d.roomName),size:l.props.getSize,units:l.props.sizeUnits,billboard:l.props.billboard})));
    await page.evaluate(background=>{window.measureLabelBackground=background;},Boolean(process.env.LABEL_BACKGROUND));
    report.measurements=await page.evaluate(async()=>{
      window.reviewPixelExtension=(await import('/src/layers/routeLabelCollisionExtension.js')).RouteAnnotationPixelsExtension;
      const source=window.labelDeck(),saved={layers:source.props.layers,viewState:source.props.viewState,effects:source.props.effects};
      const canvas=document.createElement('canvas');document.body.appendChild(canvas);
      canvas.style.position='fixed';canvas.style.left='-10000px';
      const viewport=source.getViewports()[0];
      const d=new source.constructor({canvas,width:viewport.width,height:viewport.height,useDevicePixels:1,
        controller:false,viewState:saved.viewState,layers:[]});
      await new Promise(resolve=>setTimeout(resolve,500));
      const textLayers=saved.layers.filter(l=>(l.id.includes('labels')||l.id==='route-focus-start-end-markers'||/^(route-focus-room-glow|route-landmark-room-glow|route-preview-cursor-halo|route-preview-cursor-dot)$/.test(l.id))&&l.props.data.length);
      const building=saved.layers.find(l=>/^indoor-building-(night-)?layer$/.test(l.id));
      const buildingXY=building.props.data.features.flatMap(f=>f.geometry.type==='Polygon'?f.geometry.coordinates.flat():f.geometry.coordinates.flat(2));
      const results=[];
      const raster=()=>new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Raster callback did not run')),10000);
        const previous=d.props.onAfterRender;
        d.setProps({onAfterRender:({gl})=>{
          const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,p=new Uint8Array(w*h*4);
          gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);
          let minX=w,maxX=-1,minY=h,maxY=-1;
          for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(p[(y*w+x)*4+3]>16){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
          d.setProps({onAfterRender:previous});
          clearTimeout(timeout);
          resolve({width:maxX<0?0:maxX-minX+1,height:maxY<0?0:maxY-minY+1});
        }});d.redraw(true);
      });
      try {
        for(const layer of textLayers){
          const item=layer.props.data[0],pos=layer.props.getPosition(item);
          for(const zoom of [17,19,21])for(const [pitch,bearing,latitudeOffset] of [[0,0,0],[45,35,0],[65,120,0],...(zoom===19?[[60,0,-0.00025],[60,0,0.00025]]:[])]){
            const viewState={longitude:pos[0],latitude:pos[1]+latitudeOffset,zoom,pitch,bearing,transitionDuration:0};
            const isolated=layer.clone({data:[item],collisionEnabled:false,extensions:layer.props.extensions.map(e=>e.constructor.name==='RouteLabelCollisionExtension'?new window.reviewPixelExtension():e),background:Boolean(window.measureLabelBackground),pickable:false});
            d.setProps({layers:[isolated],viewState,effects:[]});
            await new Promise(r=>setTimeout(r,120));
            let bounds=await raster();
            for(let retry=0;(!bounds.width||!bounds.height)&&retry<10;retry++){
              await new Promise(r=>setTimeout(r,200));bounds=await raster();
            }
            const v=d.getViewports()[0];
            const xy=buildingXY.map(p=>v.project([p[0],p[1],0]));
            const a=v.project(pos),ground=v.project([pos[0],pos[1],0]);
            results.push({layer:layer.id,text:layer.props.getText?.(item),zoom,pitch,bearing,latitudeOffset,...bounds,
              buildingWidth:Math.max(...xy.map(p=>p[0]))-Math.min(...xy.map(p=>p[0])),
              anchorDisplacement:Math.hypot(a[0]-ground[0],a[1]-ground[1]),
              oneMeterRadiusPixels:Math.abs(v.projectPosition([pos[0],pos[1],1])[2]-v.projectPosition([pos[0],pos[1],0])[2])*v.scale});
            console.log('LABEL: '+JSON.stringify(results.at(-1)));
          }
        }
      }finally{d.finalize();canvas.remove();}
      return results;
    });
    for(const id of new Set(report.measurements.map(m=>m.layer))){
      const rows=report.measurements.filter(m=>m.layer===id);
      assert(rows.every(r=>r.width>0&&r.height>0));
      assert(Math.max(...rows.map(r=>r.width))-Math.min(...rows.map(r=>r.width))<=2,`${id}: unexpected width scaling`);
      assert(Math.max(...rows.map(r=>r.height))-Math.min(...rows.map(r=>r.height))<=2,`${id}: unexpected annotation scaling`);
    }
    report.browser=await browser.version();
    console.log(JSON.stringify({layers:report.route,measurements:report.measurements},null,2));
  } catch(e) {report.failure=e.stack;throw e;}
  finally {fs.mkdirSync(require('node:path').dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
