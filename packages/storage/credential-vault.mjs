import { randomUUID } from 'node:crypto';
import { lstat, realpath, open, readFile } from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const REFERENCE = /^credential-ref:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LIMIT = 16 * 1024 * 1024;
const fail = code => Object.assign(new Error(code), { code });

// Host-only: protector is Electron safeStorage, supplied after app.whenReady().
// No renderer IPC, plaintext fallback, overwrite, automatic activation or key
// material in the returned receipt. The host chooses an existing private root.
export class CredentialVault {
  #root; #protector;
  constructor({ root, protector }) {
    if (!path.isAbsolute(root)) throw fail('credential_root_must_be_absolute');
    this.#root = root; this.#protector = protector;
  }
  #available() {
    try {
      if (this.#protector.isEncryptionAvailable() && this.#protector.getSelectedStorageBackend?.() !== 'basic_text') return;
    } catch { /* Never expose provider errors that may contain plaintext. */ }
    throw fail('credential_encryption_unavailable');
  }
  async #file(vaultId) {
    if (!UUID.test(vaultId)) throw fail('invalid_credential_vault_id');
    const info = await lstat(this.#root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw fail('invalid_credential_root');
    return path.join(await realpath(this.#root), `${vaultId}.bin`);
  }
  #decode(bytes, workspaceId, vaultId) {
    this.#available();
    let envelope;
    try { envelope = JSON.parse(this.#protector.decryptString(bytes)); }
    catch { throw fail('credential_decryption_failed'); }
    if (envelope?.schemaVersion !== 1 || envelope.workspaceId !== workspaceId || envelope.vaultId !== vaultId) throw fail('credential_scope_mismatch');
    const entries = envelope.entries;
    if (!Array.isArray(entries) || entries.some(entry => !entry || !REFERENCE.test(entry.reference) || typeof entry.value !== 'string')
      || new Set(entries.map(entry => entry.reference)).size !== entries.length) throw fail('invalid_credential_envelope');
    return entries;
  }
  async write({ workspaceId, entries }) {
    this.#available();
    if (!UUID.test(workspaceId) || !Array.isArray(entries)) throw fail('invalid_credential_input');
    if (entries.some(entry => !entry || !REFERENCE.test(entry.reference) || typeof entry.value !== 'string')
      || new Set(entries.map(entry => entry.reference)).size !== entries.length) throw fail('invalid_credential_input');
    const vaultId = randomUUID(), file = await this.#file(vaultId);
    const plaintext = JSON.stringify({ schemaVersion: 1, workspaceId, vaultId, entries: entries.map(({ reference, value }) => ({ reference, value })) });
    if (Buffer.byteLength(plaintext) > LIMIT) throw fail('credential_payload_too_large');
    let bytes;
    try { bytes = this.#protector.encryptString(plaintext); }
    catch { throw fail('credential_encryption_failed'); }
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > LIMIT * 2) throw fail('invalid_credential_ciphertext');
    const verified = this.#decode(bytes, workspaceId, vaultId);
    if (JSON.stringify(verified) !== JSON.stringify(entries.map(({ reference,value }) => ({ reference,value })))) throw fail('credential_roundtrip_failed');
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    const saved = await readFile(file);
    if (!saved.equals(bytes)) throw fail('credential_write_verification_failed');
    return { schemaVersion: 1, workspaceId, vaultId, entryCount: entries.length, ciphertextBytes: bytes.length, state: 'sealed_pending_review' };
  }
  async resolve({ workspaceId, vaultId, reference }) {
    if (!UUID.test(workspaceId) || !REFERENCE.test(reference)) throw fail('invalid_credential_lookup');
    const file = await this.#file(vaultId), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > LIMIT * 2) throw fail('invalid_credential_object');
    const entries = this.#decode(await readFile(file), workspaceId, vaultId);
    const entry = entries.find(item => item.reference === reference);
    if (!entry) throw fail('credential_reference_missing');
    return entry.value;
  }
}
