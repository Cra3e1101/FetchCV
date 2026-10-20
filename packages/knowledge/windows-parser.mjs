import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,cp,lstat,realpath,readdir,statfs,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ContractError} from '../contracts/runtime.mjs';

const MAX_OUTPUT=65*1024*1024;
const RETAINED_LIMIT=512*1024*1024;
const initializations=new Map();
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw new ContractError(code);};
async function verifyRuntime(root){
  if((await lstat(root)).isSymbolicLink())fail('parser_runtime_link');
  const manifestStat=await lstat(path.join(root,'runtime-manifest.json'));
  if(!manifestStat.isFile()||manifestStat.isSymbolicLink()||manifestStat.size>1024*1024)fail('invalid_parser_runtime');
  const bytes=await readFile(path.join(root,'runtime-manifest.json'));
  if(bytes.length>1024*1024)fail('invalid_parser_runtime');
  const manifest=JSON.parse(bytes);
  if(manifest.schema!==1||manifest.python!=='3.14.7'||manifest.pypdf!=='6.4.1'||!Array.isArray(manifest.files)||manifest.files.length>1000||manifest.archives?.python!=='d297e5ff019966817ad8502465176139f2d3d840fa4ed84b13bed399a6ab1f15'||manifest.archives?.pypdf!=='1782ee0766f0b77defc305f1eb2bafe738a2ef6313f3f3d2ee85b4542ba7e535')fail('invalid_parser_runtime');
  const expected=new Set(['runtime-manifest.json']);let totalBytes=bytes.length;
  for(const item of manifest.files){
    if(!Number.isSafeInteger(item.bytes)||item.bytes<0||!/^[a-f0-9]{64}$/.test(item.sha256??''))fail('invalid_parser_runtime');
    totalBytes+=item.bytes;if(totalBytes>100*1024*1024)fail('invalid_parser_runtime');
    if(typeof item.path!=='string'||item.path.includes('\\')||item.path.includes(':')||item.path.startsWith('/')||item.path.split('/').some(p=>!p||p==='.'||p==='..')||expected.has(item.path))fail('invalid_parser_runtime');
    expected.add(item.path);
  }
  async function walk(directory,relative=''){
    for(const item of await readdir(directory,{withFileTypes:true})){
      const name=relative+item.name;
      if(item.isSymbolicLink())fail('parser_runtime_link');
      if(item.isDirectory())await walk(path.join(directory,item.name),name+'/');
      else if(!item.isFile()||!expected.delete(name))fail('parser_runtime_unexpected_file');
    }
  }
  await walk(root);if(expected.size)fail('parser_runtime_missing_file');
  for(const item of manifest.files){
    const file=path.join(root,...item.path.split('/')),stat=await lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==item.bytes||digest(await readFile(file))!==item.sha256)fail('parser_runtime_integrity');
  }
  for(const file of ['python.exe','python314.dll','python314._pth','entry.py','host_entry.py','windows_container.py','harden-profile.ps1'])if(!manifest.files.some(item=>item.path===file))fail('parser_runtime_missing_file');
  return {hash:digest(bytes),bytes:totalBytes};
}

async function retainedBytes(directory){
  let size=0,count=0;
  async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){
    if(++count>20000)fail('parser_retention_limit');
    if(item.isSymbolicLink())fail('parser_retention_link');const full=path.join(dir,item.name);
    if(item.isDirectory())await walk(full);else if(item.isFile())size+=(await lstat(full)).size;else fail('parser_retention_link');
    if(size>RETAINED_LIMIT)fail('parser_retention_limit');
  }}
  await walk(directory);return size;
}
async function reserve(root,bytes){
  if(await retainedBytes(root)+bytes>RETAINED_LIMIT)fail('parser_retention_limit');
  const space=await statfs(root);if(space.bavail*space.bsize<bytes+256*1024*1024)fail('parser_disk_space_low');
}
async function publishRuntime(runtime,workRoot,manifest){
  const cached=path.join(workRoot,'runtime-'+manifest.hash.slice(0,24));
  try{
    if((await verifyRuntime(cached)).hash!==manifest.hash)fail('parser_runtime_integrity');
    return cached;
  }catch(error){
    if(error.code!=='ENOENT'&&!(error instanceof ContractError)&&!(error instanceof SyntaxError))throw error;
    // Never discard partial or invalid caches. Only this exact owned child is moved.
    try{if((await lstat(cached)).isSymbolicLink())fail('parser_runtime_link');
      await rename(cached,path.join(workRoot,'isolated-runtime-'+randomUUID()));
    }catch(missing){if(missing.code!=='ENOENT')throw missing;}
  }
  await reserve(workRoot,manifest.bytes);
  const staging=path.join(workRoot,'staging-runtime-'+randomUUID());await mkdir(staging);
  for(const name of await readdir(runtime))await cp(path.join(runtime,name),path.join(staging,name),{recursive:true,errorOnExist:true,force:false});
  if((await verifyRuntime(staging)).hash!==manifest.hash)fail('parser_runtime_integrity');
  await rename(staging,cached);
  return cached;
}

async function ownedDirectory(workspaceRoot,workRoot){
  if(!path.isAbsolute(workspaceRoot)||!path.isAbsolute(workRoot))fail('invalid_parser_paths');
  if((await lstat(workspaceRoot)).isSymbolicLink())fail('parser_work_root_escape');
  workspaceRoot=await realpath(workspaceRoot);
  const relative=path.relative(workspaceRoot,workRoot);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('parser_work_root_escape');
  let current=workspaceRoot;
  for(const segment of relative.split(path.sep)){
    current=path.join(current,segment);try{await mkdir(current);}catch(error){if(error.code!=='EEXIST')throw error;}
    const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink()||path.relative(current,await realpath(current))!=='')fail('parser_work_root_escape');
  }
  return current;
}

export async function createWindowsParser({runtime,workRoot,workspaceRoot}){
  if(process.platform!=='win32')fail('parser_platform_unsupported');
  if(typeof workspaceRoot!=='string'||!path.isAbsolute(runtime)||!path.isAbsolute(workRoot))fail('invalid_parser_paths');
  runtime=await realpath(runtime);const manifest=await verifyRuntime(runtime);
  workRoot=await ownedDirectory(workspaceRoot,workRoot);
  const key=workRoot.toLowerCase();
  if(initializations.has(key))fail('parser_busy');
  const initialization=publishRuntime(runtime,workRoot,manifest);initializations.set(key,initialization);
  let cached;try{cached=await initialization;}finally{initializations.delete(key);}
  const jobRoot=path.join(workRoot,'jobs');await mkdir(jobRoot,{recursive:true});
  let busy=false;
  return async(bytes,format,{signal}={})=>{
    signal?.throwIfAborted();
    if(!Buffer.isBuffer(bytes)||bytes.length>50*1024*1024||!['pdf','docx','html','txt','md','chat'].includes(format))fail('invalid_material');
    if(busy)fail('parser_busy');busy=true;
    try{
    await ownedDirectory(workspaceRoot,workRoot);
    const reserved=bytes.length+2*64*1024*1024+1024*1024;
    await reserve(workRoot,reserved);
    const job=path.join(jobRoot,randomUUID());await mkdir(job);
    await writeFile(path.join(job,'input.bin'),bytes,{flag:'wx'});
    await writeFile(path.join(job,'request.json'),JSON.stringify({format,inputHash:digest(bytes)}),{flag:'wx'});
    signal?.throwIfAborted();
    const env={SystemRoot:process.env.SystemRoot||process.env.SYSTEMROOT,WINDIR:process.env.SystemRoot||process.env.SYSTEMROOT,TEMP:job,TMP:job,TMPDIR:job,PYTHONDONTWRITEBYTECODE:'1'};
    const child=spawn(path.join(cached,'python.exe'),['-I','-B',path.join(cached,'host_entry.py'),job],{cwd:job,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const chunks=[],errors=[];let count=0,stderrBytes=0,overflow=false;
    const abort=()=>{if(!child.stdin.destroyed)child.stdin.end('cancel');};
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.stdin.on('error',()=>{});
    child.stdout.on('data',chunk=>{count+=chunk.length;if(count>MAX_OUTPUT){overflow=true;child.kill();}else chunks.push(chunk);});
    child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>65536){overflow=true;child.kill();}else errors.push(chunk);});
    let deadline=false;
    const timer=setTimeout(()=>{deadline=true;child.kill();},165000);timer.unref();
    try{
      const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,terminationSignal)=>resolve({code,terminationSignal}));});
      await writeFile(path.join(job,'host-exit.json'),JSON.stringify({...status,stdoutBytes:count,stderrBytes,overflow,deadline,aborted:signal?.aborted??false,stderr:Buffer.concat(errors).toString('utf8')},null,2),{flag:'wx'});
      signal?.throwIfAborted();if(overflow)fail('parser_output_limit');if(deadline)fail('parser_timeout');
      let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('parser_protocol_failed');}
      if(status.code!==0||!result.ok)fail(['cancelled','parser_timeout','parser_output_limit','parser_infrastructure_failed'].includes(result.code)?result.code:'parser_failed');
      if(result.receipt?.isolation!=='windows-lpac-registry-read-only'||result.receipt?.profilePersistence!=='denied')fail('parser_isolation_unverified');
      return result.ir;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);child.stdin.destroy();}
    }finally{busy=false;}
  };
}
