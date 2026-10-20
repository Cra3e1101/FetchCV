import {spawn} from 'node:child_process';
import path from 'node:path';
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!['NODE_OPTIONS','ELECTRON_RUN_AS_NODE'].includes(key)));
const child=spawn(path.resolve('node_modules/electron/dist/electron.exe'),[path.resolve('scripts/m4/prepare-approved-copy.cjs')],{env,stdio:'inherit',windowsHide:true});
child.on('error',()=>{process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
