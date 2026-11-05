const path=require('node:path'),fs=require('node:fs');
fs.mkdirSync('.tmp',{recursive:true});
require('esbuild').buildSync({entryPoints:['scripts/f6Synchronize.mjs'],bundle:true,platform:'node',format:'cjs',outfile:'.tmp/f6-synchronize.cjs',logLevel:'warning'});
require(path.resolve('.tmp/f6-synchronize.cjs'));
