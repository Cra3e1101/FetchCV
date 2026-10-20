import {ContractError} from '../contracts/runtime.mjs';
import {canonicalJSON} from '../storage/legacy-archive.mjs';
import {contentHash} from '../storage/blob-store.mjs';
const fail=code=>{throw new ContractError(code);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
// Deliberately limited closed JSON-schema subset. Unsupported schemas cannot be granted.
export function checkSchema(schema,depth=0,budget={nodes:0}){
 if(!object(schema)||depth>8||++budget.nodes>128)fail('mcp_schema_unsupported');
 const typedKeys={object:['properties','required','additionalProperties'],array:['items','minItems','maxItems'],string:['minLength','maxLength'],number:['minimum','maximum'],integer:['minimum','maximum'],boolean:[],null:[]};
 const keys=['type','description','title','enum','const','default',...(typedKeys[schema.type]??[])];
 if(Object.keys(schema).some(k=>!keys.includes(k))||!['object','array','string','number','integer','boolean','null'].includes(schema.type))fail('mcp_schema_unsupported');
 for(const key of ['description','title'])if(schema[key]!==undefined&&(typeof schema[key]!=='string'||schema[key].length>4000))fail('mcp_schema_unsupported');
 if(schema.enum!==undefined&&(!Array.isArray(schema.enum)||!schema.enum.length||schema.enum.length>100))fail('mcp_schema_unsupported');
 for(const key of ['minItems','maxItems','minLength','maxLength'])if(schema[key]!==undefined&&(!Number.isSafeInteger(schema[key])||schema[key]<0||schema[key]>32768))fail('mcp_schema_unsupported');
 for(const key of ['minimum','maximum'])if(schema[key]!==undefined&&(typeof schema[key]!=='number'||!Number.isFinite(schema[key])))fail('mcp_schema_unsupported');
 if(schema.type==='object'){
  if(schema.additionalProperties!==false||!object(schema.properties)||Object.keys(schema.properties).length>40||Object.keys(schema.properties).some(k=>! /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(k)))fail('mcp_schema_unsupported');
  if(schema.required!==undefined&&(!Array.isArray(schema.required)||new Set(schema.required).size!==schema.required.length||schema.required.some(k=>!Object.hasOwn(schema.properties,k))))fail('mcp_schema_unsupported');
  for(const value of Object.values(schema.properties))checkSchema(value,depth+1,budget);
 }else if(schema.type==='array')checkSchema(schema.items,depth+1,budget);
 return schema;
}
export function validateArguments(schema,value){
 checkSchema(schema);if(Buffer.byteLength(canonicalJSON(value))>32768)fail('invalid_mcp_arguments');
 const check=(s,v)=>{
  if(s.enum&&!s.enum.some(x=>canonicalJSON(x)===canonicalJSON(v)))fail('invalid_mcp_arguments');
  if(Object.hasOwn(s,'const')&&canonicalJSON(s.const)!==canonicalJSON(v))fail('invalid_mcp_arguments');
  if(s.type==='object'){if(!object(v)||Object.keys(v).some(k=>!Object.hasOwn(s.properties,k))||(s.required??[]).some(k=>!Object.hasOwn(v,k)))fail('invalid_mcp_arguments');for(const [k,item]of Object.entries(v))check(s.properties[k],item);}
  else if(s.type==='array'){if(!Array.isArray(v)||v.length<(s.minItems??0)||v.length>Math.min(512,s.maxItems??512))fail('invalid_mcp_arguments');for(const item of v)check(s.items,item);}
  else if(s.type==='string'){if(typeof v!=='string'||[...v].length<(s.minLength??0)||[...v].length>Math.min(32768,s.maxLength??32768))fail('invalid_mcp_arguments');}
  else if(s.type==='number'||s.type==='integer'){if(typeof v!=='number'||!Number.isFinite(v)||(s.type==='integer'&&!Number.isSafeInteger(v))||v<(s.minimum??-Infinity)||v>(s.maximum??Infinity))fail('invalid_mcp_arguments');}
  else if(s.type==='null'?v!==null:typeof v!=='boolean')fail('invalid_mcp_arguments');
 };check(schema,value);return value;
}
export function toolDescriptor(serverId,tool){
 if(!object(tool)||typeof tool.name!=='string'||! /^[a-zA-Z0-9_.-]{1,80}$/.test(tool.name)||tool.description!==undefined&&(typeof tool.description!=='string'||tool.description.length>4000)||tool.inputSchema?.type!=='object')fail('mcp_tool_unsupported');
 checkSchema(tool.inputSchema);if(tool.outputSchema!==undefined){if(tool.outputSchema?.type!=='object')fail('mcp_schema_unsupported');checkSchema(tool.outputSchema);}
 const descriptor={name:tool.name,description:tool.description??'',inputSchema:tool.inputSchema,...(tool.outputSchema?{outputSchema:tool.outputSchema}:{})};
 const hash=contentHash(canonicalJSON(descriptor));return {...descriptor,hash,identity:`mcp:${serverId}/${tool.name}@${hash}`,approved:false,effect:'external_requires_confirmation'};
}

export function validateResult(tool,result){
 if(!object(result)||!Array.isArray(result.content)||result.content.length>100||result.isError!==undefined&&typeof result.isError!=='boolean')fail('mcp_result_unsupported');
 if(result.content.some(item=>!object(item)||item.type!=='text'||typeof item.text!=='string'))fail('mcp_result_unsupported');
 if(result.structuredContent!==undefined&&!object(result.structuredContent))fail('mcp_result_unsupported');
 if(tool.outputSchema&&result.isError!==true){if(!object(result.structuredContent))fail('mcp_result_unsupported');validateArguments(tool.outputSchema,result.structuredContent);}
 return result;
}
