import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { WorkspaceManifestWriter } from '../../packages/storage/workspace-manifest.mjs';

const [root,point]=process.argv.slice(2);
const relative=path.relative(process.env.M1_ALLOWED_DELETE_ROOT,root);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !['staged','published'].includes(point))
  throw Error('synthetic child required');
const input=JSON.parse(await readFile(path.join(root,'child-input.json'),'utf8'));
const writer=await WorkspaceManifestWriter.acquire(root);
await writer.publish(input,async stage=>{ if(stage===point) process.exit(23); });
throw Error('crash checkpoint was not reached');
