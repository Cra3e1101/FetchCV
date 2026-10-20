import {EventEmitter} from 'node:events';
import {serveStoragePort} from '../../packages/app/storage-worker.mjs';
const port=new EventEmitter();
port.postMessage=message=>process.send(message);
process.on('message',data=>{for(const item of Array.isArray(data)?data:[data])port.emit('message',{data:item});});
await serveStoragePort(port,process.argv[2]);
