import {listPackage,extractFile} from '@electron/asar';
import {readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
export async function verifyTrial(root){
const hash=async file=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex')};
const sidecar=path.join(root,'sidecar-dist/fetchcv-api'),parserRuntime=path.join(root,'parser-runtime');
const frontendManifest=JSON.parse((await readFile('.m1-evidence/codex-ui-20261011/frontend-manifest.json','utf8')).replace(/^\uFEFF/,''));
const artifacts=(await readdir(path.join(root,'output'))).filter(f=>f.endsWith('.exe')||f.endsWith('.exe.blockmap')).map(f=>path.join(root,'output',f));
if(artifacts.filter(f=>f.endsWith('.exe')).length!==1)throw Error('Expected exactly one installer');
const resources=path.join(root,'output/win-unpacked/resources'),asar=path.join(resources,'app.asar'),files=listPackage(asar).map(f=>f.replaceAll('\\','/'));
for(const f of frontendManifest){const name='dist/'+f.path.replaceAll('\\','/');const digest=createHash('sha256').update(extractFile(asar,path.normalize(name))).digest('hex');if(digest!==f.sha256.toLowerCase())throw Error('ASAR frontend mismatch '+name)}
for(const name of ['main','storage-worker']){const text=extractFile(asar,path.join('build','electron',`${name}.mjs`)).toString();if(text.includes('guard-node-deletions.cjs')||text.includes('FetchCV_M1_work'))throw Error('Test dependency in app runtime')}
const suspicious=files.filter(f=>/\.(?:db|sqlite|secret|env|pem)$/i.test(f)||/(?:^|\/)(?:\.env|\.venv|\.m1-evidence)(?:\/|$)/i.test(f));if(suspicious.length)throw Error('Unexpected private files '+suspicious.join(','));
async function verifyTree(source,destination){const records=[];async function walk(dir,rel=''){for(const ent of await readdir(dir,{withFileTypes:true})){const name=path.join(rel,ent.name),file=path.join(source,name);if(ent.isSymbolicLink())throw Error('Unexpected link');if(ent.isDirectory())await walk(file,name);else{const digest=await hash(file);if(digest!==await hash(path.join(destination,name)))throw Error('Resource copy mismatch');records.push({path:name,bytes:(await lstat(file)).size,sha256:digest})}}}await walk(source);return records}
const sidecarFiles=await verifyTree(sidecar,path.join(resources,'sidecar')),parserFiles=await verifyTree(parserRuntime,path.join(resources,'parser-runtime'));
const artifactRecords=[];for(const file of artifacts)artifactRecords.push({path:file,sha256:await hash(file),bytes:(await lstat(file)).size});
await writeFile(path.join(root,'package-report.json'),JSON.stringify({success:true,version:JSON.parse(await readFile(path.join(root,'stage/package.json'),'utf8')).version,artifacts,artifactRecords,asarSha256:await hash(asar),files,frontendFilesVerified:frontendManifest.length,sidecarFiles,parserFiles,testGuardEmbedded:false,secretPathMatches:suspicious,scope:'Local unsigned trial package, not M10 release acceptance'},null,2));
console.log(JSON.stringify({success:true,artifacts,frontendFilesVerified:frontendManifest.length}));

}
