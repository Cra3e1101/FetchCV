import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {storageFixture} from './helpers/storage-fixture.mjs';
import {prepareWorkspaceCopy} from '../packages/storage/prepare-workspace.mjs';
import {inspectLegacySchema} from '../packages/storage/legacy-tables.mjs';

test('explicit pre-invocation variant preserves all 24 actual tables and invents no invocation rows',async()=>{
  const {db:unused,source,dir}=await storageFixture('older-schema');unused.close();
  const synthetic=new DatabaseSync(source);synthetic.exec('DROP TABLE tool_invocations');
  assert.throws(()=>inspectLegacySchema(synthetic),/missing=tool_invocations/);
  assert.equal(inspectLegacySchema(synthetic,{legacyVariant:'pre-tool-invocations'}).length,24);synthetic.close();
  const before=await readFile(source),recoveryRoot=path.join(dir,'recovery'),destinationRoot=path.join(dir,'copies');await mkdir(recoveryRoot);await mkdir(destinationRoot);
  const result=await prepareWorkspaceCopy({source,recoveryRoot,destinationRoot,name:'v2',legacyVariant:'pre-tool-invocations'});
  assert.equal(result.totalRows,26);assert.equal(result.sourceTables.length,24);assert.deepEqual(result.absentTables,['tool_invocations']);
  assert.equal(result.tableCounts.tool_invocations,0);assert.deepEqual(await readFile(source),before);
  const copy=new DatabaseSync(result.archivePath,{readOnly:true});
  try {assert.equal(copy.prepare('SELECT count(*) AS n FROM ToolCall').get().n,0);} finally {copy.close();}
  const broken=new DatabaseSync(source);broken.exec('ALTER TABLE quality_reports RENAME TO unrecognized_reports');
  try {assert.throws(()=>inspectLegacySchema(broken,{legacyVariant:'pre-tool-invocations'}),/missing=tool_invocations,quality_reports; unexpected=unrecognized_reports/);} finally {broken.close();}
});
