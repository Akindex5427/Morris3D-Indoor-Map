// Offline tooling entry: generate or import reviewed decisions. Never auto-runs.
const fs=require('node:fs'),path=require('node:path');
fs.mkdirSync('.tmp',{recursive:true});
require('esbuild').buildSync({entryPoints:['scripts/spaceAnalyticsArtifacts.mjs'],bundle:true,platform:'node',format:'cjs',outfile:'.tmp/space-analytics-tools.cjs',logLevel:'warning'});
require(path.resolve('.tmp/space-analytics-tools.cjs'));
