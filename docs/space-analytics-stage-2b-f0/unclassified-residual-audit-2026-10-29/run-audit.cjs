// Bundle in memory: writes are confined to this new report directory.
const path = require('node:path');
const Module = require('node:module');
const entry = path.join(__dirname, 'audit.mjs');
const result = require('esbuild').buildSync({entryPoints: [entry], bundle: true,
  platform: 'node', format: 'cjs', write: false, logLevel: 'warning'});
const audit = new Module(entry, module);
audit.filename = entry;
audit.paths = module.paths;
audit._compile(result.outputFiles[0].text, entry);
