const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
fs.mkdirSync('.tmp',{recursive:true});
const root='docs/interactive-overlap/integration';fs.mkdirSync(root,{recursive:true});const results=[];
for(const [name,original] of [['main-route-lighting','interior-stage5-app.cjs'],['label-floors','route-label-stage3-fixture.cjs'],['environment','environment-stage4.cjs'],['adjacent-narration','adjacent-room-analysis.cjs']]){
 const dir=`${root}/${name}`;fs.mkdirSync(dir,{recursive:true});
 const code=fs.readFileSync(`review/${original}`,'utf8').replaceAll('docs/stage-5-interior',dir).replaceAll('docs/stage-3-route-labels',dir).replaceAll('docs/stage-4-environment',dir).replaceAll('docs/adjacent-room-analysis',dir);
 const file=path.resolve('.tmp',`overlap-${name}.cjs`);fs.writeFileSync(file,code);const log=fs.openSync(`${dir}/execution.log`,'w');
 const run=spawnSync(process.execPath,[file],{env:process.env,stdio:['ignore',log,log],windowsHide:true,timeout:180000});fs.closeSync(log);
 results.push({name,exitCode:run.status,error:run.error?.message});fs.writeFileSync(`${root}/status.json`,JSON.stringify(results,null,2));console.log(name,run.status);
}
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
