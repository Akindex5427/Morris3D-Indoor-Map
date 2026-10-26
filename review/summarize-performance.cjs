const fs=require('node:fs');
const dir='docs/stage-7-performance';
const before=JSON.parse(fs.readFileSync(`${dir}/before.json`)),after=JSON.parse(fs.readFileSync(`${dir}/after.json`));
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
const stats=values=>({median:median(values),min:Math.min(...values),max:Math.max(...values)});
const summary={conditions:{cpu:before.cpu,chrome:before.chrome,rendering:before.rendering,viewport:before.viewport},beforeRuns:before.runs.length,afterRuns:after.runs.length,scenarios:[],memory:{},network:{}};
summary.conditions.renderers=[...new Set([...before.runs,...after.runs].map(r=>r.renderer))];
summary.conditionsMatch=['cpu','chrome','rendering','viewport'].every(k=>JSON.stringify(before[k])===JSON.stringify(after[k]))&&summary.conditions.renderers.length===1;
for(const name of before.runs[0].scenarios.map(s=>s.name)){
 const row={name};
 for(const [key,report] of [['before',before],['after',after]]){
  const rows=report.runs.map(r=>r.scenarios.find(s=>s.name===name));
  if(rows.some(r=>!r))throw Error(`Incomplete ${key} ${name}`);
  row[key]=Object.fromEntries(['elapsedMs','rafFPS','drawnFPS','p50FrameMs','p95FrameMs','p99FrameMs','slowFrames','scriptMs','taskMs','wallMeshReplacements','bufferUploads','bufferBytes','drawCalls','deckDrawCalls','heapMB'].map(metric=>[metric,stats(rows.map(s=>s[metric]))]));
  row[key].drawCallsPerDrawnFrame=stats(rows.map(r=>r.drawCalls/Math.max(1,r.drawnFrames)));
  if(name==='search')row[key].queries=rows.map(r=>r.latencies);
  if(name==='above-below-first')row[key].workerTimes=rows.map(r=>r.analysis);
 }
 summary.scenarios.push(row);
}
for(const [key,report] of [['before',before],['after',after]]){
 summary.memory[key]=report.runs.map(r=>r.memoryCycles.map(m=>({cycle:m.cycle,heapMB:m.JSHeapUsedSize/2**20,resources:m.resources})));
 summary.network[key]=report.runs.map(r=>({wallFetches:r.network.loads.filter(l=>/wall.*\.geojson/.test(l.url)).length,perimeterFetches:r.network.loads.filter(l=>l.url==='/wall.geojson').length,roomFetches:r.network.loads.filter(l=>/rooms-.*\.geojson/.test(l.url)).length,jsonCalls:r.network.json.length,jsonBodyAndDecodeMs:r.network.json.reduce((s,l)=>s+l.ms,0)}));
}
fs.writeFileSync(`${dir}/summary.json`,JSON.stringify(summary,null,2));
const num=(n,d=1)=>n.toFixed(d);
const table=['| Scenario | Duration before → after (s) | Script CPU before → after (ms) | p95 frame interval before → after (ms) | Drawn frames/s before → after |','|---|---:|---:|---:|---:|'];
for(const r of summary.scenarios){const a=r.before,b=r.after;table.push(`| ${r.name} | ${num(a.elapsedMs.median/1000,2)} → ${num(b.elapsedMs.median/1000,2)} | ${num(a.scriptMs.median)} → ${num(b.scriptMs.median)} | ${num(a.p95FrameMs.median)} → ${num(b.p95FrameMs.median)} | ${num(a.drawnFPS.median)} → ${num(b.drawnFPS.median)} |`);}
fs.writeFileSync(`${dir}/measurements.md`,table.join('\n')+'\n');console.log(table.join('\n'));
