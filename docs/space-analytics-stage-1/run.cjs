// Audit tooling only. Bundles existing geometry utilities; never loaded by the app.
const fs = require('node:fs');
fs.mkdirSync('.tmp', {recursive:true});
require('esbuild').buildSync({entryPoints:['docs/space-analytics-stage-1/audit.mjs'],bundle:true,platform:'node',format:'cjs',outfile:'.tmp/space-analytics-audit.cjs',logLevel:'warning'});
require('../../.tmp/space-analytics-audit.cjs');
