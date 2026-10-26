const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const crypto=require('node:crypto');
const fs=require('node:fs'),assert=require('node:assert/strict');
const out='docs/day-restoration';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const phasesOnly=process.env.DAY_REVIEW_PHASES==='1';
 const page=await browser.newPage({viewport:{width:1100,height:900},deviceScaleFactor:1}),errors=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/GLSL|DeckGL|Error/.test(m.text()))errors.push(m.text().slice(0,1500));});
 const update=async values=>{
  await page.evaluate(values=>{for(const [key,value] of Object.entries(values))dayReview[`set${key[0].toUpperCase()}${key.slice(1)}`](value);},values);
  await page.waitForFunction(values=>Object.entries(values).every(([k,v])=>dayReview[k]===v),values);
 };
 const capture=async name=>{
  console.log(name);
  await page.waitForFunction(()=>dayReview.ready&&dayReview.rendered(),null,{timeout:60000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const png=await page.evaluate(()=>dayReview.snapshot());fs.writeFileSync(`${out}/${name}.png`,Buffer.from(png.split(',')[1],'base64'));
  const r=await page.evaluate(()=>{const r=dayReview,d=r.getDeck();return {floor:r.floor,variant:r.variant,progress:r.progress,
   modelCount:d.layerManager.getLayers().reduce((n,l)=>n+l.getModels().length,0),
   rooms:r.layers[0].props.data.features.map(f=>({color:r.layers[0].props.getFillColor(f),source:f.properties.color,geometry:f.geometry})),
   walls:r.layers[1].props.data.features.map(f=>({color:r.layers[1].props.getFillColor(f),geometry:f.geometry}))};});
  const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  r.geometryHash=hash([r.rooms.map(f=>f.geometry),r.walls.map(f=>f.geometry)]);
  r.colorHash=hash([r.rooms.map(f=>f.color),r.walls.map(f=>f.color)]);
  r.featureCount=r.rooms.length;r.wallCount=r.walls.length;
  r.sourceColors=[...new Map(r.rooms.map(f=>[JSON.stringify(f.source),{source:f.source,color:f.color}])).values()];
  delete r.rooms;delete r.walls;
  results.push({name,...r});assert.deepEqual(errors,[]);
 };
 try{
  await page.goto('http://127.0.0.1:3004/review/day-restoration.html');
  await page.waitForFunction(()=>window.dayReview?.ready&&dayReview.getDeck()?.layerManager.getLayers().some(l=>l.id.endsWith('indoor-building-layer-polygons-fill')),null,{timeout:60000});
  await page.waitForTimeout(1200);
  const ablation=process.env.DAY_REVIEW_ABLATION==='1';
  for(const floor of phasesOnly?[]:ablation?[1,'all']:[0,1,2,3,4,5,6,7,'all']){
   await update({floor});
   for(const variant of ablation?['legacy','before','depth-only','depth-blend']:['legacy','before','current']){
    await update({variant});await capture(`F${floor}-${variant}`);
   }
  }
  if(!ablation){
   if(!phasesOnly){
   await update({floor:1});
   for(const state of ['selected','route']){
    await update({selected:state==='selected',route:state==='route'});
    for(const variant of ['legacy','reference','before','current']){await update({variant});await capture(`F1-${state}-${variant}`);}
   }
   await update({selected:false,route:false});
   for(const floor of [1,'all'])for(const preset of ['architectural','gis']){
    await update({floor,preset,progress:1});
    for(const variant of ['before','current']){await update({variant});await capture(`F${floor}-${preset}-${variant}`);}
   }
   }
   for(const [phase,progress] of [['golden',.36],['twilight',.7]]){
    await update({floor:1,preset:'architectural',progress});
    for(const variant of ['before','current']){await update({variant});await capture(`F1-${phase}-${variant}`);}
   }
   if(!phasesOnly){
   await update({floor:1,variant:'current',preset:'architectural',progress:0});
   await page.waitForTimeout(350);
   await page.evaluate(()=>{window.retained=dayReview.getDeck().layerManager.getLayers().filter(l=>!l.isComposite).map(l=>({id:l.id,models:l.getModels(),data:l.props.data}));});
   for(const progress of [.0001,.05,.36,.7,1,.7,.36,.05,0]){
    await update({progress});await capture(`F1-transition-${progress}`);
    assert(await page.evaluate(()=>retained.every(a=>{const l=dayReview.getDeck().layerManager.getLayers().find(l=>l.id===a.id);return l&&l.props.data===a.data&&l.getModels().every((m,i)=>m===a.models[i]);})));
   }
   }
  }
 }finally{fs.writeFileSync(`${out}/${phasesOnly?'phases':process.env.DAY_REVIEW_ABLATION==='1'?'ablation':'visual'}.json`,JSON.stringify({results,errors},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
