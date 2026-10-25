import http from 'node:http';

// Isolated protocol peer: real HTTP + SSE, synthetic credentials and tool calls.
export async function startProviderSettingsPeer() {
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let raw=''; for await(const part of req) raw+=part;
    const body=raw?JSON.parse(raw):null;
    requests.push({path:req.url,method:req.method,headers:req.headers,body});
    if(req.method==='GET') {res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'test-model',context_length:32768,max_output_tokens:4096},{id:'other-model',context_length:65536,max_output_tokens:8192}]}));return;}
    if (req.headers.authorization==='Bearer invalid-synthetic') {res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Invalid credentials'}}));return;}
    const anthropic=new URL(req.url,'http://localhost').pathname.endsWith('/messages');
    const hasResult=body.messages.some(message=>message.role==='tool'||Array.isArray(message.content)&&message.content.some(block=>block.type==='tool_result'));
    const probe=body.tools?.some(tool=>(tool.name||tool.function?.name)==='connection_probe');
    const tool=probe&&!hasResult;
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
    if(anthropic){
      const emit=data=>res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
      emit({type:'message_start',message:{id:'synthetic-message',type:'message',role:'assistant',model:body.model,content:[],usage:{input_tokens:5,output_tokens:0}}});
      emit({type:'content_block_start',index:0,content_block:tool?{type:'tool_use',id:'synthetic-call',name:'connection_probe',input:{}}:{type:'text',text:''}});
      emit({type:'content_block_delta',index:0,delta:tool?{type:'input_json_delta',partial_json:'{"value":"OK"}'}:{type:'text_delta',text:'OK'}});
      emit({type:'content_block_stop',index:0});
      emit({type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn'},usage:{output_tokens:5}});
      emit({type:'message_stop'});res.end();
    }else{
      const emit=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({id:'synthetic-message',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})}\n\n`);
      emit({role:'assistant'});
      emit(tool?{tool_calls:[{index:0,id:'synthetic-call',type:'function',function:{name:'connection_probe',arguments:'{"value":"OK"}'}}]}:{content:'OK'});
      emit({},tool?'tool_calls':'stop');res.end('data: [DONE]\n\n');
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {baseUrl:`http://127.0.0.1:${server.address().port}`,requests,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
