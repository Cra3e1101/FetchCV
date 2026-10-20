import {serveStoragePort} from '../packages/app/storage-worker.mjs';
import path from 'node:path';

if(!process.parentPort) throw new Error('application utility parent port required');
const parserRuntime=process.env.FETCHCV_PARSER_RUNTIME||(process.resourcesPath?path.join(process.resourcesPath,'parser-runtime'):null);
serveStoragePort(process.parentPort,process.argv[2],{parserRuntime}).catch(()=>{
  process.parentPort.postMessage({kind:'startup-failed'});process.exit(1);
});
