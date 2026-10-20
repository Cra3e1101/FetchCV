import {EventEmitter} from 'node:events';
import {ApplicationStore} from '../../packages/storage/application-store.mjs';
import {serveStoragePort} from '../../packages/app/storage-worker.mjs';
// Synthetic gate only: hold an import without reading or writing an original file.
let release;
ApplicationStore.prototype.importSelectedFile=async function(){process.send({kind:'test-import-held'});await new Promise(resolve=>{release=resolve;});return {cancelled:true};};
const port=new EventEmitter();port.postMessage=message=>process.send(message);
process.on('message',data=>{if(data.kind==='test-release-import')release?.();else port.emit('message',{data});});
await serveStoragePort(port,process.argv[2]);
