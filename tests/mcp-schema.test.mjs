import test from 'node:test';import assert from 'node:assert/strict';import {toolDescriptor,validateArguments,validateResult} from '../packages/mcp/tool-schema.mjs';
const tool=()=>({name:'lookup',description:'Synthetic',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{text:{type:'string',minLength:1,maxLength:3},count:{type:'integer',minimum:0,maximum:3}},required:['text'],additionalProperties:false}});
test('MCP identity binds server and schema; annotations never grant authority',()=>{
 const a=toolDescriptor('one',tool()),b=toolDescriptor('two',tool());assert.notEqual(a.identity,b.identity);assert.equal(a.approved,false);assert.equal(a.effect,'external_requires_confirmation');
 const changed=tool();changed.inputSchema.properties.count.maximum=4;assert.notEqual(toolDescriptor('one',changed).hash,a.hash);
 assert.deepEqual(validateArguments(a.inputSchema,{text:'中文😀',count:0}),{text:'中文😀',count:0});
 for(const args of [{text:'x',extra:true},{count:1},{text:'long'},{text:'x',count:4},{text:'x',count:1.2}])assert.throws(()=>validateArguments(a.inputSchema,args),{code:'invalid_mcp_arguments'});
});
test('unsupported MCP schemas fail closed instead of silently granting partial validation',()=>{
 for(const change of [t=>t.inputSchema.additionalProperties=true,t=>t.inputSchema.properties.text.pattern='.*',t=>t.inputSchema.properties.text.$ref='#/defs/x',t=>t.inputSchema.required=['missing']]){const t=tool();change(t);assert.throws(()=>toolDescriptor('one',t),{code:'mcp_schema_unsupported'});}
});

test('MCP schemas reject constraints that do not apply to the declared type',()=>{
 for(const schema of [{type:'string',minimum:5},{type:'array',items:{type:'string'},minLength:3},{type:'object',properties:{},additionalProperties:false,minItems:2},{type:'boolean',properties:{}},{type:'string',required:[]},{type:'integer',additionalProperties:false},{type:'null',items:{type:'string'}}]){
  const t=tool();t.inputSchema.properties.text=schema;assert.throws(()=>toolDescriptor('one',t),{code:'mcp_schema_unsupported'});
 }
});

test('MCP result contract validates declared structured output before accepting a receipt',()=>{
 const t=tool();t.outputSchema={type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false};const d=toolDescriptor('one',t);
 assert.notEqual(d.hash,toolDescriptor('one',tool()).hash);
 assert.throws(()=>validateResult(d,{content:[]}));
 assert.throws(()=>validateResult(d,{content:[],structuredContent:{count:'wrong'}}),{code:'invalid_mcp_arguments'});
 assert.throws(()=>validateResult(d,{content:[{type:'image',data:'untrusted'}]}),{code:'mcp_result_unsupported'});
 assert.throws(()=>validateResult(d,{isError:'false',content:[]}),{code:'mcp_result_unsupported'});
 assert.equal(validateResult(d,{content:[],structuredContent:{count:2}}).structuredContent.count,2);
});
