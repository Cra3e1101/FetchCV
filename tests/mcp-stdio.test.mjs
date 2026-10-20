import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {StdioSession} from '../packages/mcp/stdio-session.mjs';
const config=mode=>({executable:process.execPath,args:[path.resolve('tests/fixtures/mcp-stdio-fixture.mjs'),mode],cwd:process.env.M1_ALLOWED_DELETE_ROOT});
test('MCP stdio negotiates and calls a synthetic peer without inherited credentials',async()=>{
 const previous=process.env.FETCHCV_PROVIDER_API_KEY;process.env.FETCHCV_PROVIDER_API_KEY='SYNTHETIC-NOT-A-KEY';let changed=0;const s=await StdioSession.open({...config('changed'),onToolsChanged:()=>changed++});
 try{assert.equal(s.protocolVersion,'2025-11-25');assert.equal((await s.tools())[0].name,'echo');const result=await s.request('tools/call',{name:'echo',arguments:{text:'中文😀'}});assert.equal(result.content[0].text,'中文😀');assert.equal(result.inheritedSecret,false);assert.equal(changed,1);}
 finally{await s.close();if(previous===undefined)delete process.env.FETCHCV_PROVIDER_API_KEY;else process.env.FETCHCV_PROVIDER_API_KEY=previous;}
});
test('MCP rejects invalid protocol/output and timeout; no retry and no success receipt',async()=>{
 await assert.rejects(StdioSession.open(config('bad-version')),{code:'mcp_protocol_unsupported'});
 for(const [mode,expected]of [['invalid','mcp_invalid_message'],['hang','mcp_outcome_unknown']]){const s=await StdioSession.open(config(mode));try{await assert.rejects(s.request('tools/call',{name:'echo',arguments:{text:'synthetic'}},{timeoutMs:100}),{code:expected});assert.equal(s.closed,true);}finally{await s.close();}}
 const s=await StdioSession.open(config('hang'));try{const cancel=new AbortController(),request=s.request('tools/call',{name:'echo',arguments:{text:'synthetic'}},{signal:cancel.signal});cancel.abort();await assert.rejects(request,{code:'mcp_outcome_unknown'});}finally{await s.close();}
});
