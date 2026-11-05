const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const out='docs/adjacent-room-analysis';fs.mkdirSync(out,{recursive:true});
const run=(entry,args,log)=>{
 const fd=fs.openSync(`${out}/${log}`,'w');
 const result=spawnSync(process.execPath,[entry,...args],{stdio:['ignore',fd,fd],windowsHide:true});
 fs.closeSync(fd);return result.status;
};
const unitExitCode=run('node_modules/vitest/vitest.mjs',['run','--reporter=json',`--outputFile=${out}/unit-tests.json`],'unit-execution.log');
const buildExitCode=run('node_modules/vite/bin/vite.js',['build'],'build.log');
const unit=JSON.parse(fs.readFileSync(`${out}/unit-tests.json`));
const baseline=JSON.parse(fs.readFileSync('docs/stipple-regression/unit-tests.json'));
const failed=result=>result.testResults.flatMap(s=>s.assertionResults.filter(t=>t.status==='failed').map(t=>t.fullName));
const previous=new Set(failed(baseline)),newFailures=failed(unit).filter(name=>!previous.has(name));
const results={unitExitCode,buildExitCode,total:unit.numTotalTests,passed:unit.numPassedTests,failed:unit.numFailedTests,newFailures};
fs.writeFileSync(`${out}/checks.json`,JSON.stringify(results,null,2));console.log(results);
if(buildExitCode!==0||newFailures.length||unit.testResults.some(s=>s.status==='failed'&&!s.assertionResults.length))process.exitCode=1;
