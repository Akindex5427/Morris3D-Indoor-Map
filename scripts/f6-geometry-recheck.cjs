const fs=require('node:fs'),path=require('node:path');
fs.mkdirSync('.tmp',{recursive:true});
require('esbuild').buildSync({entryPoints:['scripts/f6GeometryRecheck.mjs'],bundle:true,platform:'node',format:'cjs',outfile:'.tmp/f6-geometry-recheck.cjs',logLevel:'warning'});
require(path.resolve('.tmp/f6-geometry-recheck.cjs'));
