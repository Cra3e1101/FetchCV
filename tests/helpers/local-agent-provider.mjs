import http from 'node:http';

// A deterministic local protocol peer for the real Pi SDK. No external model,
// real credential, or generated resume fact is involved in this acceptance.
export async function localAgentProvider({artifactId,basedOnVersionId,basedOnHash}){
  let calls=0;const payloads=[];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const bytes of req)raw+=bytes;payloads.push(JSON.parse(raw));calls++;
    const tool=calls===1?{name:'read_artifact',arguments:{artifactId}}:calls===2?{name:'propose_artifact',arguments:{artifactId,basedOnVersionId,basedOnHash,text:'Packaged synthetic reviewed version',reason:'Synthetic wording acceptance'}}:null;
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
    const emit=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:`packaged-${calls}`,object:'chat.completion.chunk',created:1,model:'gpt-4o-mini',choices:[{index:0,delta,finish_reason}]})}\n\n`);
    emit({role:'assistant'});
    if(tool){emit({tool_calls:[{index:0,id:`call-${calls}`,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]});emit({},'tool_calls');}
    else{emit({content:'Packaged Pi answer persisted in APP.'});emit({},'stop');}
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {get calls(){return calls;},payloads,env:{FETCHCV_PROVIDER_API_KEY:'M4-PACKAGED-SYNTHETIC-KEY',FETCHCV_PROVIDER_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,FETCHCV_PROVIDER_MODEL:'gpt-4o-mini',FETCHCV_PROVIDER_PROTOCOL:'openai',FETCHCV_PROVIDER_NAME:'Synthetic local model',FETCHCV_PROVIDER_CONTEXT_WINDOW:'32768',FETCHCV_PROVIDER_MAX_OUTPUT_TOKENS:'2048'},
    async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
