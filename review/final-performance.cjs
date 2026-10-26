const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const root='docs/stage-6-final',results=[];
const tasks=[['cinematic','review/cinematic-performance.cjs',{}],...[1,2,3].map(run=>[
 `workload-${run}`,'review/performance-check.cjs',{PERF_REPEATS:'1',PERF_ANGLE:'d3d11',PERF_REDUCED_MOTION:'reduce',PERF_URL:'http://127.0.0.1:3005',PERF_OUTPUT:`${root}/workload-${run}.json`}])];
for(const [name,script,env] of tasks){
 console.log('START',name,new Date().toISOString());const log=fs.openSync(`${root}/${name}.log`,'w');
 const result=spawnSync(process.execPath,[script],{env:{...process.env,...env},windowsHide:true,stdio:['ignore',log,log],timeout:600000});fs.closeSync(log);
 results.push({name,exitCode:result.status,error:result.error?.message});fs.writeFileSync(`${root}/performance-status.json`,JSON.stringify(results,null,2));console.log('END',name,result.status);
}
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
