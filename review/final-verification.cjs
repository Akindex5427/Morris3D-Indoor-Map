// Run existing browser regressions against the current app, preserving previous
// stage artifacts. Generated copies change only report paths and server URLs.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root='docs/stage-6-final',temp='.tmp/stage-6-final';
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(temp,{recursive:true});
const suites=[
 ['labels','route-label-refinement.cjs','docs/route-label-refinement'],
 ['label-backgrounds','route-label-refinement.cjs','docs/route-label-refinement',{LABEL_BACKGROUND:'1'}],
 ['label-floors','route-label-stage3-fixture.cjs','docs/stage-3-route-labels'],
 ['label-routes','route-label-stage3.cjs','docs/stage-3-route-labels'],
 ['label-wheel','route-label-wheel.cjs','docs/route-label-refinement'],
 ['environment','environment-stage4.cjs','docs/stage-4-environment'],
 ['basemaps','environment-stage4-map.cjs','docs/stage-4-environment'],
 ['interior','interior-stage5.cjs','docs/stage-5-interior'],
 ['interior-app','interior-stage5-app.cjs','docs/stage-5-interior'],
 ['interior-resources','interior-stage5-resources.cjs','docs/stage-5-interior'],
 ['colors','color-check.cjs','docs/stage-5-colors'],
 ['search','search-check.cjs','docs/stage-3-search'],
 ['correspondence','correspondence-check.cjs','docs/stage-6-correspondence'],
 ['navigation','navigation-check.cjs','docs/stage-2-navigation'],
];
const selected=process.env.FINAL_SUITES?.split(',');
const results=[];
for(const [name,script,oldOutput,extra={}] of suites){
 if(selected&&!selected.includes(name))continue;
 const output=`${root}/${name}`;fs.mkdirSync(output,{recursive:true});
 if(name==='correspondence')fs.copyFileSync('docs/stage-6-correspondence/data-audit.json',`${output}/data-audit.json`);
 const source=fs.readFileSync(`review/${script}`,'utf8').replaceAll(oldOutput,output)
  .replaceAll('http://127.0.0.1:3001','http://127.0.0.1:3004');
 const generated=path.resolve(temp,`${name}.cjs`);fs.writeFileSync(generated,source);
 const log=fs.openSync(`${output}/execution.log`,'w'),started=new Date().toISOString();
 console.log('START',name,started);
 const result=spawnSync(process.execPath,[generated],{env:{...process.env,...extra},stdio:['ignore',log,log],windowsHide:true,timeout:300000});
 fs.closeSync(log);
 const row={name,script,started,finished:new Date().toISOString(),exitCode:result.status,error:result.error?.message};results.push(row);
 fs.writeFileSync(`${output}/status.json`,JSON.stringify(row,null,2));
 fs.writeFileSync(`${root}/last-run.json`,JSON.stringify(results,null,2));
 console.log('END',name,row.exitCode,row.error||'');
}
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
