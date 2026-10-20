require(require('node:path').join(process.cwd(), 'scripts/m1/guard-node-deletions.cjs'));
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { app, safeStorage } = require('electron');
const root = process.env.M1_ALLOWED_DELETE_ROOT;
const stage = process.argv.at(-1);
if (!root || !path.isAbsolute(root) || !['create','recover'].includes(stage)) throw Error('controlled credential probe required');
app.setPath('userData', path.join(root,'user-data'));
app.setPath('sessionData', path.join(root,'session-data'));
app.setPath('temp', root);
app.disableHardwareAcceleration();
const timer = setTimeout(() => app.exit(2), 25000);
app.whenReady().then(async () => {
  const { CredentialVault } = await import(pathToFileURL(path.resolve('packages/storage/credential-vault.mjs')).href);
  const vault = new CredentialVault({ root:path.join(root,'vault'),protector:safeStorage });
  const synthetic = 'synthetic-electron-m4-credential';
  const receiptFile = path.join(root,'credential-receipt.json');
  let receipt;
  if (stage === 'create') {
    const reference = `credential-ref:${randomUUID()}`;
    receipt = { ...await vault.write({ workspaceId:randomUUID(),entries:[{ reference,value:synthetic }] }),reference };
    fs.writeFileSync(receiptFile,JSON.stringify(receipt),{ flag:'wx' });
  } else receipt = JSON.parse(fs.readFileSync(receiptFile,'utf8'));
  if (await vault.resolve(receipt) !== synthetic) throw Error('credential_recovery_mismatch');
  const ciphertext = fs.readFileSync(path.join(root,'vault',`${receipt.vaultId}.bin`));
  if (ciphertext.includes(Buffer.from(synthetic))) throw Error('plaintext_in_vault');
  let crossScopeDenied = false;
  try { await vault.resolve({ ...receipt,workspaceId:randomUUID() }); }
  catch (error) { if (error.code !== 'credential_scope_mismatch') throw error; crossScopeDenied = true; }
  if (!crossScopeDenied) throw Error('credential_scope_not_enforced');
  fs.writeFileSync(path.join(root,`${stage}-report.json`),JSON.stringify({ success:true,stage,electron:process.versions.electron,
    platform:process.platform,account:require('node:os').userInfo().username,encryptionAvailable:safeStorage.isEncryptionAvailable(),recovered:true,crossScopeDenied,
    onDiskSecretAbsent:true,packaged:app.isPackaged },null,2),{ flag:'wx' });
  clearTimeout(timer); app.exit(0);
}).catch(error => {
  fs.writeFileSync(path.join(root,`${stage}-failure.json`),JSON.stringify({ success:false,stage,code:error.code || 'credential_probe_failed' }),{ flag:'wx' });
  clearTimeout(timer); app.exit(1);
});
