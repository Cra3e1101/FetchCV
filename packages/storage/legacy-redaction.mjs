import { randomUUID } from 'node:crypto';

const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|secret|authorization|cookie|private[_-]?key|credential)/i;
const secretField = key => SECRET_KEY.test(key) || /^(token|key)$/i.test(key);
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;
const SECRET_IN_TEXT = /\bBearer\s+[^\s,"']+|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g;

// References are random; neither their IDs nor public audit rows are hashes of
// credentials. Optional sealing retains candidates for later review, without
// activating providers or transferring old MCP launch authorization.
export class LegacyRedactor {
  #secrets = new Set();
  #references = new Map();
  constructor({ secretValues = [] } = {}) {
    for (const value of secretValues) if (typeof value === 'string' && value) this.#secrets.add(value);
  }
  discover(value, key = '') {
    if (Array.isArray(value)) { for (const item of value) this.discover(item, key); }
    else if (value && typeof value === 'object') { for (const [childKey, child] of Object.entries(value)) this.discover(child, childKey); }
    else if (typeof value === 'string' && value) {
      if (secretField(key)) this.#secrets.add(value);
      for (const match of value.matchAll(SECRET_IN_TEXT)) this.#secrets.add(match[0]);
      for (const match of value.matchAll(URL_IN_TEXT)) {
        try {
          const uri = new URL(match[0]);
          if (uri.username || uri.password) {
            if (uri.username) this.#secrets.add(decodeURIComponent(uri.username));
            if (uri.password) this.#secrets.add(decodeURIComponent(uri.password));
          }
          for (const [name, item] of uri.searchParams) if (secretField(name) && item) this.#secrets.add(item);
        } catch { /* Unparseable URLs remain text; pattern/literal checks still apply. */ }
      }
    }
  }
  #reference(value) {
    // value remains in memory only and is cleared after the migration phase.
    if (!this.#references.has(value)) this.#references.set(value, `credential-ref:${randomUUID()}`);
    return this.#references.get(value);
  }
  redact(value, { table, oldId }) {
    const redactions = [];
    const replace = (original, location, reason) => {
      const reference = this.#reference(typeof original === 'string' ? original : JSON.stringify(original));
      redactions.push({ path: location, reason, reference, state: 'requires_reentry_or_review' });
      return { $redacted: reference };
    };
    const walk = (current, location, key = '') => {
      if (current == null) return current;
      if (secretField(key)) return replace(current, location, 'credential_field');
      if (Array.isArray(current)) return current.map((item, index) => walk(item, `${location}/${index}`));
      if (typeof current === 'object') return Object.fromEntries(Object.entries(current).map(([name, item]) => {
        // Executable strings and free-form environment values cannot be reliably
        // classified by a key regex. Retain them only in the protected snapshot.
        if (table === 'mcp_server_configs' && ['command', 'args_json', 'env', 'environment'].includes(name)) return [name, replace(item, `${location}/${name}`, 'launch_requires_review')];
        return [name, walk(item, `${location}/${name}`, name)];
      }));
      if (typeof current !== 'string') return current;
      let text = current.replace(URL_IN_TEXT, uriText => {
        try {
          const uri = new URL(uriText);
          if (!uri.username && !uri.password && ![...uri.searchParams.keys()].some(secretField)) return uriText;
          if (uri.username || uri.password) { replace(uriText, location, 'uri_credentials'); uri.username = ''; uri.password = ''; }
          for (const name of [...uri.searchParams.keys()]) if (secretField(name)) uri.searchParams.set(name, replace(uri.searchParams.get(name), location, 'uri_credential_query').$redacted);
          return uri.toString();
        } catch { return uriText; }
      });
      text = text.replace(SECRET_IN_TEXT, item => replace(item, location, 'credential_pattern').$redacted);
      const literals = [...this.#secrets].sort((a, b) => b.length - a.length);
      if (literals.length) {
        const pattern = new RegExp(literals.map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
        const generated = new Set(this.#references.values());
        text = text.split(/(credential-ref(?::|%3A)[a-f0-9-]{36})/i).map(part => generated.has(part.replace(/%3A/i, ':')) ? part
          : part.replace(pattern, item => replace(item, location, 'known_credential_literal').$redacted)).join('');
      }
      return text;
    };
    const row = walk(value, '');
    return { row, redactions, policy: 'legacy-redaction-v1', table, oldId };
  }
  async sealCredentials(vault, workspaceId) {
    return vault.write({ workspaceId, entries: [...this.#references].map(([value, reference]) => ({ reference, value })) });
  }
  clear() { this.#secrets.clear(); this.#references.clear(); }
}
