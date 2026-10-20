import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const index=process.argv.indexOf('--output-dir');
const outputRoot=index<0?path.join(projectRoot,'build','electron'):path.resolve(process.argv[index+1]);
await mkdir(outputRoot,{recursive:true});
await build({entryPoints:[path.join(projectRoot,'electron','storage-worker.mjs')],outfile:path.join(outputRoot,'storage-worker.mjs'),
  bundle:true,platform:'node',format:'esm',target:'node22',external:['electron'],minify:true,treeShaking:true,sourcemap:false,legalComments:'none',
  banner:{js:"import {createRequire as __fetchcvCreateRequire} from 'node:module'; const require=__fetchcvCreateRequire(import.meta.url);"}});
await copyFile(path.join(projectRoot,'electron','storage-preload.cjs'),path.join(outputRoot,'storage-preload.cjs'));
console.log(outputRoot);
