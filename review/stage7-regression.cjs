const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const results=[];
for(const [script,prefix,folder,port] of [
 ['color-check.cjs','COLOR','colors',3002],
 ['correspondence-check.cjs','CORRESPONDENCE','correspondence',3002],
 ['navigation-check.cjs','NAVIGATION','navigation',3001],
 ['search-check.cjs','SEARCH','search',3001],
]){
 const env={...process.env,[`${prefix}_REVIEW_URL`]:`http://127.0.0.1:${port}`,[`${prefix}_REVIEW_OUTPUT`]:`docs/stage-7-performance/${folder}`};
 console.log('Starting',script);
 const run=spawnSync(process.execPath,[`review/${script}`],{env,stdio:'inherit',windowsHide:true});
 results.push({script,exitCode:run.status,error:run.error?.message});
 fs.writeFileSync('docs/stage-7-performance/regression-results.json',JSON.stringify(results,null,2));
}
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
