// Alternate variants, using a fresh Chrome process for every complete workload.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const dir='docs/stage-7-performance';
const variants=(process.env.PERF_VARIANTS||'before,after').split(',');
if(variants.some(v=>!['before','after'].includes(v)))throw Error('Invalid PERF_VARIANTS');
const collected={before:[],after:[]};
for(let run=1;run<=3;run++)for(const variant of variants){
 const output=`${dir}/${variant}-hardware-${run}.json`;
 console.log(`Matched hardware run ${run}: ${variant}`);
 const child=spawnSync(process.execPath,['review/performance-check.cjs'],{stdio:'inherit',windowsHide:true,env:{...process.env,
  PERF_REPEATS:'1',PERF_ANGLE:'d3d11',PERF_URL:`http://127.0.0.1:${variant==='before'?3003:3002}`,PERF_OUTPUT:output,
 }});
 if(child.status!==0)throw Error(`${variant} run ${run} did not complete (${child.status})`);
 const report=JSON.parse(fs.readFileSync(output));
 if(report.failure||report.runs[0].memoryCycles?.length!==4)throw Error('Incomplete workload');
 report.runs[0].run=run;collected[variant].push(report);
}
for(const variant of variants){
 const combined={...collected[variant][0],repeats:3,method:'Fresh Chrome process per run',variantSequence:variants,runs:collected[variant].flatMap(r=>r.runs)};
 fs.writeFileSync(`${dir}/${variant}.json`,JSON.stringify(combined,null,2));
}
