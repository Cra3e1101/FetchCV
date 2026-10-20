import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { CredentialVault } from '../packages/storage/credential-vault.mjs';
import { DatabaseSync } from 'node:sqlite';
import { storageFixture } from './helpers/storage-fixture.mjs';
import { prepareWorkspaceCopy } from '../packages/storage/prepare-workspace.mjs';

// A real AEAD test double, not an assertion that Electron/DPAPI was exercised.
function testProtector(key = randomBytes(32)) {
  return { isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(bytes) {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0,12));
      decipher.setAuthTag(bytes.subarray(12,28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

test('credential vault binds workspace and reference, preserves ciphertext and fails closed', async () => {
  const root = path.join(process.env.M1_ALLOWED_DELETE_ROOT, 'credential-vault'); await mkdir(root);
  const protector = testProtector(), vault = new CredentialVault({ root, protector });
  const workspaceId = randomUUID(), reference = `credential-ref:${randomUUID()}`, value = 'fixture-private-key-do-not-log';
  const receipt = await vault.write({ workspaceId, entries: [{ reference, value }] });
  assert.equal(receipt.state, 'sealed_pending_review');
  const file = path.join(root, `${receipt.vaultId}.bin`), bytes = await readFile(file);
  assert.equal(bytes.includes(Buffer.from(value)), false); assert.equal(JSON.stringify(receipt).includes(value), false);
  assert.equal(await new CredentialVault({ root, protector }).resolve({ ...receipt, reference }), value);
  await assert.rejects(vault.resolve({ ...receipt, workspaceId: randomUUID(), reference }), { code: 'credential_scope_mismatch' });
  await assert.rejects(vault.resolve({ ...receipt, reference: `credential-ref:${randomUUID()}` }), { code: 'credential_reference_missing' });
  await assert.rejects(new CredentialVault({ root, protector: testProtector() }).resolve({ ...receipt, reference }), { code: 'credential_decryption_failed' });
  await assert.rejects(vault.resolve({ ...receipt, vaultId: '../escape', reference }), { code: 'invalid_credential_vault_id' });
  for (const unavailable of [{ isEncryptionAvailable: () => false }, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' }]) {
    await assert.rejects(new CredentialVault({ root, protector: unavailable }).write({ workspaceId, entries: [{ reference, value }] }), { code: 'credential_encryption_unavailable' });
  }
  const hostile = { isEncryptionAvailable: () => true, encryptString() { throw new Error(value); } };
  await assert.rejects(new CredentialVault({ root, protector: hostile }).write({ workspaceId, entries: [{ reference,value }] }), error => error.message === 'credential_encryption_failed' && error.cause === undefined);
  assert.equal((await readdir(root)).length, 1, 'failed encryption never writes a plaintext fallback');
  const tamperedId = randomUUID(), tampered = Buffer.from(bytes); tampered[tampered.length-1] ^= 1;
  await writeFile(path.join(root, `${tamperedId}.bin`), tampered, { flag: 'wx' });
  await assert.rejects(vault.resolve({ ...receipt, vaultId: tamperedId, reference }), { code: 'credential_decryption_failed' });
  assert.deepEqual(await readFile(file), bytes, 'original encrypted object retained');
});

test('offline migration can recover redacted credentials from sealed storage without activating them', async () => {
  const { db: fixtureArchive, source, dir } = await storageFixture('credential-migration'); fixtureArchive.close();
  const recoveryRoot = path.join(dir,'recovery'), destinationRoot = path.join(dir,'copies'), root = path.join(dir,'vault');
  await mkdir(recoveryRoot); await mkdir(destinationRoot); await mkdir(root);
  const protector = testProtector(), credentialVault = new CredentialVault({ root,protector });
  const result = await prepareWorkspaceCopy({ source,recoveryRoot,destinationRoot,name:'sealed',credentialVault });
  assert.equal(result.activationAllowed, false); assert.equal(result.credentials.state, 'sealed_pending_review');
  assert.equal(result.stages.configuration.credentialsInstalled, false);
  const db = new DatabaseSync(result.archivePath, { readOnly:true });
  try {
    const value = JSON.parse(db.prepare('SELECT value_json FROM Setting').get().value_json);
    assert.equal(await credentialVault.resolve({ ...result.credentials,reference:value.api_key.$redacted }), 'fixture-provider-secret');
    assert.equal(JSON.stringify(result).includes('fixture-provider-secret'), false);
    const allRefs = new Set(db.prepare('SELECT redactions_json FROM LegacyArchive').all().flatMap(row => JSON.parse(row.redactions_json).map(item => item.reference)));
    assert.equal(result.credentials.entryCount, allRefs.size);
    for (const reference of allRefs) assert.equal(typeof await credentialVault.resolve({ ...result.credentials,reference }), 'string');
    assert.equal(db.prepare('SELECT state FROM McpServer').get().state, 'requires_review');
  } finally { db.close(); }
  for (const file of await readdir(root)) assert.equal((await readFile(path.join(root,file))).includes(Buffer.from('fixture-provider-secret')), false);
  const unavailable = new CredentialVault({ root,protector:{ isEncryptionAvailable:()=>false } });
  await assert.rejects(prepareWorkspaceCopy({ source,recoveryRoot,destinationRoot,name:'no-encryption',credentialVault:unavailable }), { code:'credential_encryption_unavailable' });
  await assert.rejects(readFile(path.join(destinationRoot,'no-encryption','projection-report.json')), { code:'ENOENT' });
});
