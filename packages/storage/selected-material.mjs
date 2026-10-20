import {open,lstat} from 'node:fs/promises';
import path from 'node:path';
import {ContractError} from '../contracts/runtime.mjs';

// The argument is supplied only by the trusted main-process native picker.
// Renderer RPC never accepts paths; read from a single, bounded file handle.
export async function readSelectedMaterial(selectedPath){
  if(typeof selectedPath!=='string'||!path.isAbsolute(selectedPath))throw new ContractError('invalid_selected_file');
  const link=await lstat(selectedPath,{bigint:true});
  if(!link.isFile()||link.isSymbolicLink())throw new ContractError('invalid_selected_file');
  const handle=await open(selectedPath,'r');
  try{
    const before=await handle.stat({bigint:true}),openedPath=await lstat(selectedPath,{bigint:true});
    if(openedPath.isSymbolicLink()||link.dev!==before.dev||link.ino!==before.ino||openedPath.dev!==before.dev||openedPath.ino!==before.ino)throw new ContractError('selected_file_changed');
    if(!before.isFile()||before.size<1n||before.size>50n*1024n*1024n)throw new ContractError('file_size_limit');
    const bytes=Buffer.alloc(Number(before.size));let offset=0;
    while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)throw new ContractError('selected_file_changed');offset+=bytesRead;}
    const after=await handle.stat({bigint:true}),finalPath=await lstat(selectedPath,{bigint:true});
    if(finalPath.isSymbolicLink()||finalPath.dev!==before.dev||finalPath.ino!==before.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw new ContractError('selected_file_changed');
    return bytes;
  }finally{await handle.close();}
}
