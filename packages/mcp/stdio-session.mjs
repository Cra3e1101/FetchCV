import {spawn} from 'node:child_process';
import {lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {ContractError} from '../contracts/runtime.mjs';
const versions=['2025-11-25','2025-06-18','2025-03-26'];
const error=code=>new ContractError(code);
// Private APP transport for explicitly trusted local programs. This is NOT an OS sandbox.
// No shell, inherited credentials, automatic retries, or raw stderr forwarding.
export class StdioSession{
 static async open({executable,args=[],cwd,onToolsChanged=()=>{},timeoutMs=10000}){
  if(!path.isAbsolute(executable)||!path.isAbsolute(cwd)||!Array.isArray(args)||args.length>32||args.some(x=>typeof x!=='string'||x.length>4096||x.includes('\0'))||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw error('invalid_mcp_launch');
  if(process.platform==='win32'&&path.extname(executable).toLowerCase()!=='.exe')throw error('invalid_mcp_launch');
  const [program,directory]=await Promise.all([lstat(executable),lstat(cwd)]);
  if(!program.isFile()||program.isSymbolicLink()||!directory.isDirectory()||directory.isSymbolicLink())throw error('invalid_mcp_launch');
  const env={};for(const name of ['SystemRoot','WINDIR'])if(process.env[name])env[name]=process.env[name];
  env.TEMP=await realpath(cwd);env.TMP=env.TEMP;
  const child=spawn(await realpath(executable),args,{cwd:env.TEMP,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const session=new StdioSession(child,onToolsChanged);
  try{const result=await session.request('initialize',{protocolVersion:versions[0],capabilities:{},clientInfo:{name:'FetchCV',version:'2.0.0'}},{timeoutMs});
   if(!result||!versions.includes(result.protocolVersion)||!result.capabilities?.tools)throw error('mcp_protocol_unsupported');
   session.protocolVersion=result.protocolVersion;session.notify('notifications/initialized',{});return session;
  }catch(e){await session.close();throw e;}
 }
 constructor(child,onToolsChanged){
  this.child=child;this.pending=new Map();this.nextId=1;this.closed=false;this.buffer='';this.decoder=new TextDecoder('utf-8',{fatal:true});this.notifications=0;
  this.exited=new Promise(resolve=>child.once('exit',()=>{this.fail('mcp_process_exited');resolve();}));
  child.on('error',()=>this.fail('mcp_process_failed'));child.stdin.on('error',()=>this.fail('mcp_pipe_failed'));child.stdout.on('error',()=>this.fail('mcp_pipe_failed'));child.stderr.resume();
  child.stdout.on('data',bytes=>{if(this.closed)return;try{
   this.buffer+=this.decoder.decode(bytes,{stream:true});if(Buffer.byteLength(this.buffer)>1024*1024)throw error('mcp_message_limit');
   let end;while((end=this.buffer.indexOf('\n'))!==-1){const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);if(!line.trim())continue;const message=JSON.parse(line);
    if(!message||Array.isArray(message)||message.jsonrpc!=='2.0')throw error('mcp_invalid_message');
    if(typeof message.method==='string'){
     if(++this.notifications>1000)throw error('mcp_notification_limit');
     if(Object.hasOwn(message,'id')){this.write({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Client method not supported'}});continue;}
     if(message.method==='notifications/tools/list_changed')onToolsChanged();
     continue;
    }
    const pending=this.pending.get(message.id);if(!pending)throw error('mcp_unexpected_response');
    if(Object.hasOwn(message,'result')===Object.hasOwn(message,'error'))throw error('mcp_invalid_message');
    this.pending.delete(message.id);pending.cleanup();message.error?pending.reject(error('mcp_remote_error')):pending.resolve(message.result);
   }
  }catch(e){this.fail(e instanceof ContractError?e.code:'mcp_invalid_message');}});
  this.idle=null;this.touch();
 }
 touch(){clearTimeout(this.idle);this.idle=setTimeout(()=>{if(!this.pending.size)void this.close();else this.touch();},5*60000);this.idle.unref();}
 fail(code){if(this.closed)return;this.closed=true;clearTimeout(this.idle);for(const item of this.pending.values()){item.cleanup();item.reject(error(code));}this.pending.clear();this.child.kill();}
 write(message){if(this.closed)throw error('mcp_session_closed');const line=JSON.stringify(message)+'\n';if(Buffer.byteLength(line)>1024*1024)throw error('mcp_message_limit');this.child.stdin.write(line);this.touch();}
 notify(method,params){this.write({jsonrpc:'2.0',method,params});}
 request(method,params,{timeoutMs=30000,signal}={}){
  if(this.closed)return Promise.reject(error('mcp_session_closed'));if(this.pending.size>=8)return Promise.reject(error('mcp_busy'));
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)return Promise.reject(error('invalid_mcp_timeout'));
  if(signal?.aborted)return Promise.reject(error('cancelled'));const id=this.nextId++;
  return new Promise((resolve,reject)=>{const cancel=()=>{try{this.notify('notifications/cancelled',{requestId:id,reason:'User cancelled'});}catch{}this.fail('mcp_outcome_unknown');};
   const timer=setTimeout(()=>this.fail('mcp_outcome_unknown'),timeoutMs);
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
   this.pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',cancel,{once:true});
   try{this.write({jsonrpc:'2.0',id,method,params});}catch(e){this.pending.delete(id);cleanup();reject(e);}
  });
 }
 async tools(){const tools=[];let cursor;const cursors=new Set();
  for(let page=0;page<10;page++){const result=await this.request('tools/list',cursor?{cursor}:{},{timeoutMs:10000});
   if(!result||!Array.isArray(result.tools)||result.tools.length+tools.length>100)throw error('mcp_tool_limit');tools.push(...result.tools);
   if(result.nextCursor===undefined)return tools;if(typeof result.nextCursor!=='string'||!result.nextCursor||result.nextCursor.length>2048||cursors.has(result.nextCursor))throw error('mcp_invalid_cursor');cursor=result.nextCursor;cursors.add(cursor);
  }throw error('mcp_tool_limit');
 }
 async close(){this.fail('mcp_session_closed');let timer;try{await Promise.race([this.exited,new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);}finally{clearTimeout(timer);}}
}
