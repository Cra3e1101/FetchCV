/* Real Electron main-process fixture. No desktop app, sidecar, user DB or credentials. */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const output = path.resolve(process.env.FETCHCV_BRIDGE_E2E_OUTPUT);
const mode = process.env.FETCHCV_BRIDGE_E2E_MODE || 'offline';
const report = { schema:'browser-bridge-e2e-v1', mode, ok:false, checks:[], startupEvents:[], windows:[],
  livePage: { status:'not_exercised' }, noLoginAttempt:true, noUserDatabase:true };
let bridge;
for (const [name, folder] of Object.entries({userData:'profile',sessionData:'session',logs:'logs',crashDumps:'crashes',temp:'tmp'})) {
  const location = path.join(output, folder);
  fs.mkdirSync(location, {recursive:true}); app.setPath(name, location);
}
app.commandLine.appendSwitch('disable-background-networking');
app.on('window-all-closed', () => {});
app.on('browser-window-created', (_event, window) => {
  const preferences = window.webContents.getLastWebPreferences();
  report.windows.push({sandbox:preferences.sandbox,contextIsolation:preferences.contextIsolation,
    nodeIntegration:preferences.nodeIntegration,webSecurity:preferences.webSecurity,visible:window.isVisible()});
});
function check(name, operation) { operation(); report.checks.push({name,pass:true}); }
async function request(payload, authorization = true) {
  const response = await fetch(`${bridge.url}/command`, {method:'POST',
    headers:{'content-type':'application/json', ...(authorization ? {authorization:`Bearer ${bridge.token}`} : {})},
    body:JSON.stringify(payload), signal:AbortSignal.timeout(65000)});
  return {status:response.status, body:await response.json()};
}
function save() { fs.writeFileSync(path.join(output,'bridge-report.json'),JSON.stringify(report,null,2)); }
async function main() {
  await app.whenReady();
  report.electronVersion = process.versions.electron;
  report.isolatedPaths = Object.fromEntries(['userData','sessionData','logs','crashDumps','temp'].map(n=>[n,app.getPath(n)]));
  check('isolated paths and sandbox switches', () => {
    for (const location of Object.values(report.isolatedPaths)) assert.ok(location.startsWith(output + path.sep));
    for (const flag of ['no-sandbox','disable-setuid-sandbox','disable-gpu-sandbox']) assert.equal(app.commandLine.hasSwitch(flag), false);
  });
  const service = await import(pathToFileURL(path.resolve(__dirname,'../../electron/browser-bridge-service.mjs')).href);
  bridge = await service.startBrowserBridge({onStartupEvent:stage=>report.startupEvents.push(stage)});
  const denied = await request({command:'open',url:'https://example.com/'},false);
  check('HTTP missing token is rejected before runtime init', () => {
    assert.equal(denied.status,403); assert.equal(denied.body.error,'forbidden');
    assert.deepEqual(report.startupEvents,[]); assert.equal(BrowserWindow.getAllWindows().length,0);
  });
  const status = await request({command:'status'});
  check('authenticated status remains lazy', () => {
    assert.equal(status.status,200); assert.equal(status.body.result.open,false);
    assert.equal(status.body.result.initializing,false); assert.deepEqual(report.startupEvents,[]);
    assert.equal(bridge.accessStatus(),null);
  });
  for (const url of ['http://127.0.0.1/','https://127.0.0.1/','https://localhost/']) {
    const rejected = await request({command:'open',url});
    check(`real runtime rejects ${url}`, () => {
      assert.equal(rejected.status,400); assert.match(rejected.body.error,/browser_(url|host|private_address)_denied/);
      assert.equal(BrowserWindow.getAllWindows().length,0);
    });
  }
  check('real runtime initialized only on authenticated work', () => {
    assert.deepEqual(report.startupEvents,['browser.runtime_start','browser.runtime_ready']);
    assert.notEqual(bridge.accessStatus(),null);
  });
  if (mode !== 'offline') {
    const url = mode === 'live-xhs'
      ? 'https://www.xiaohongshu.com/search_result/?keyword=%E5%B0%8F%E7%B1%B3%E4%BA%A7%E5%93%81%E7%BB%8F%E7%90%86&source=web_search_result_notes'
      : 'https://example.com/';
    const opened = await request({command:'open',url});
    report.livePage = {status:'requested',httpStatus:opened.status,error:opened.body.error||null};
    if (mode === 'live-xhs' && opened.status !== 200 &&
        /^xiaohongshu_public_access_(cooldown|limit)$/.test(opened.body.code || opened.body.error || '')) {
      report.livePage.status = 'access_restricted';
      report.livePage.reason = opened.body.code || opened.body.error;
      const closed = await request({command:'close'});
      check('access restriction stops without retry and closes window', () => {
        assert.equal(closed.status,200); assert.equal(BrowserWindow.getAllWindows().length,0);
      });
      report.scope = 'Production public-access guard stopped the one requested navigation; no retries or login.';
      return;
    }
    if (opened.status !== 200) throw new Error(`live_open_failed: ${opened.body.error}`);
    const state = opened.body.result;
    report.livePage = {status:'observed',url,title:state.title,textChars:String(state.text||'').length,
      loginRequired:state.login_required,userAction:state.user_action||'',anonymous:state.anonymous,
      accountSession:state.account_session, candidateCount:(state.candidates||[]).length,
      cooldownUntil:state.cooldown_until||null, xhsReady:state.xhs_ready};
    check('actual bridge window retains sandbox and isolation', () => {
      assert.ok(report.windows.length > 0);
      for (const prefs of report.windows) {
        assert.equal(prefs.sandbox,true); assert.equal(prefs.contextIsolation,true);
        assert.equal(prefs.nodeIntegration,false); assert.equal(prefs.webSecurity,true); assert.equal(prefs.visible,false);
      }
    });
    if (mode === 'live-public') {
      const read = await request({command:'read'});
      check('public page open/read exposes real title and body', () => {
        // The production extractor omits page headers. The live page's body
        // need not repeat its title; verify its actual document-purpose copy.
        assert.equal(state.title,'Example Domain'); assert.match(state.text,/documentation examples/i);
        assert.equal(read.status,200); assert.equal(read.body.result.title,state.title);
        assert.equal(read.body.result.text,state.text);
      });
      report.livePage.status = 'passed';
    } else {
      check('XHS uses anonymous isolated session', () => assert.equal(state.account_session,false));
      if (state.login_required || state.cooldown_until || state.user_action) {
        report.livePage.status = 'access_restricted';
      } else if (state.xhs_ready && (state.candidates||[]).length) {
        report.livePage.status = 'public_candidates_observed_not_body_validation';
      } else report.livePage.status = 'no_usable_candidates';
    }
  }
  const closed = await request({command:'close'});
  check('close tears down the browser window', () => {
    assert.equal(closed.status,200); assert.equal(closed.body.result.open,false);
    assert.equal(BrowserWindow.getAllWindows().length,0);
  });
  report.ok = mode !== 'live-xhs' || report.livePage.status === 'public_candidates_observed_not_body_validation';
  report.scope = mode === 'offline'
    ? 'Real Electron/service/runtime auth and private-network rejection; no page opened, renderer sandbox not observed.'
    : 'Window preferences inspected; OS sandbox token not independently measured. No login, note-body/OCR, or LLM validation.';
}
main().catch(error => { report.error={name:error.name,message:error.message,stack:error.stack}; })
  .finally(() => { bridge?.stop(); save(); app.exit(report.ok ? 0 : mode==='live-xhs' && !report.error ? 3 : 1); });
