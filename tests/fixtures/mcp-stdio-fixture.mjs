import readline from 'node:readline';
// Synthetic protocol peer only: no file, network, child process, or deletion operations.
const mode=process.argv[2];const lines=readline.createInterface({input:process.stdin});
const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\n');
lines.on('line',line=>{const r=JSON.parse(line);if(!Object.hasOwn(r,'id'))return;
 if(r.method==='initialize'){process.stderr.write('Synthetic informational stderr\n');send({id:r.id,result:{protocolVersion:mode==='bad-version'?'1900-01-01':'2025-11-25',capabilities:{tools:{listChanged:true}},serverInfo:{name:'synthetic',version:'1'}}});}
 else if(r.method==='tools/list'){send({id:r.id,result:{tools:[{name:'echo',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]}});}
 else if(r.method==='tools/call'){
  if(mode==='hang')return;
  if(mode==='invalid'){process.stdout.write('not-json\n');return;}
  if(mode==='changed')send({method:'notifications/tools/list_changed'});
  send({id:r.id,result:{content:[{type:'text',text:r.params.arguments.text}],inheritedSecret:!!process.env.FETCHCV_PROVIDER_API_KEY}});
 }else send({id:r.id,error:{code:-32601,message:'unknown'}});
});
