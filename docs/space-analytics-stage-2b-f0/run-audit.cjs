const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync('.tmp', {recursive: true});
require('esbuild').buildSync({entryPoints: ['docs/space-analytics-stage-2b-f0/audit.mjs'], bundle: true, platform: 'node', format: 'cjs', outfile: '.tmp/f0-owner-reaudit.cjs', logLevel: 'warning'});
require(path.resolve('.tmp/f0-owner-reaudit.cjs'));
