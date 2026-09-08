import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
app.setPath("userData", path.join(root, "artifacts/didi-live/browser-profile"));
app.whenReady().then(() => {
  const doc = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(root, "artifacts/didi-live/public-cache.bin"))));
  console.log(JSON.stringify({ entries: (doc.entries || []).map(item => {
    const url = new URL(item.url);
    return { note: url.pathname, hasGrant: Boolean(url.searchParams.get("xsec_token")), source: url.searchParams.get("xsec_source"), expiresAt: item.expiresAt };
  }), requests: (doc.guard?.requests || []).length, lastOpenAt: doc.guard?.lastOpenAt,
  cachedPages: (doc.pages || []).map(([key, item]) => ({ path: new URL(key).pathname, kind: item.state.page_kind, accessGrants: item.state.candidate_access_grants, textLength: item.state.text?.length, version: item.extractionVersion,
    candidates: item.state.page_kind === "search" ? (item.state.candidates || []).map(c => ({ note: new URL(c.url).pathname, grant: c.access_grant })) : [] })) }));
  app.exit(0);
}).catch(error => { console.error(error.message); app.exit(1); });
