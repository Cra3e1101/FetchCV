/* Synthetic HTML served through Electron's HTTPS protocol handler. Real renderer,
 * production extraction and guards; no real notes, account data, or site fetches. */
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const output = path.resolve(process.env.FETCHCV_BRIDGE_E2E_OUTPUT);
const mode = process.env.FETCHCV_BRIDGE_E2E_MODE || 'offline';
const report = { schema: 'xiaohongshu-extraction-e2e-v1', mode, ok: false, checks: [],
  livePage: { status: 'not_exercised' }, noLoginAttempt: true, noUserDatabase: true };
for (const [name, folder] of Object.entries({ userData: 'profile', sessionData: 'session', logs: 'logs', crashDumps: 'crashes', temp: 'tmp' })) {
  const location = path.join(output, folder);
  fs.mkdirSync(location, { recursive: true });
  app.setPath(name, location);
}
app.commandLine.appendSwitch('disable-background-networking');
app.on('window-all-closed', () => {});
let runtime;
function check(name, operation) { operation(); report.checks.push({ name, pass: true }); }
const text = '产品经理一面面经：首先自我介绍，然后面试官追问项目的核心目标、用户调研方法和指标设计。安全产品案例讨论了验证码为什么影响用户体验，以及扫码登录如何降低输入成本。随后复盘转化率下降的原因，说明如何拆分漏斗、设计实验、评估样本量与结果，最后反问岗位职责和团队协作方式。';
const noteId = 'fixture_note_000000000001';
const otherId = 'fixture_note_000000000002';
const url = `https://www.xiaohongshu.com/explore/${noteId}`;
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const state = (body = text, extra = {}) => ({ note: { noteDetailMap: {
  [noteId]: { note: { noteId, title: '产品经理面经', desc: body, time: 1767225600000, ...extra } },
} } });
function html(body, data) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>产品经理面经 - 合成测试页</title></head>
    <body>${body}<script>window.__INITIAL_STATE__=${JSON.stringify(data || {}).replace(/</g, '\\u003c')}</script></body></html>`;
}
function summarize(snapshot) {
  return { pageKind: snapshot.page_kind, textChars: snapshot.text?.length || 0, loginRequired: snapshot.login_required,
    userAction: snapshot.user_action, xhsReady: snapshot.xhs_ready, noteReady: snapshot.note_ready,
    imageCount: snapshot.image_count, candidateCount: snapshot.candidates?.length || 0,
    anonymous: snapshot.anonymous, accountSession: snapshot.account_session };
}
async function main() {
  await app.whenReady();
  report.electronVersion = process.versions.electron;
  check('isolated paths and normal sandbox switches', () => {
    for (const name of ['userData', 'sessionData', 'logs', 'crashDumps', 'temp']) assert.ok(app.getPath(name).startsWith(output + path.sep));
    for (const flag of ['no-sandbox', 'disable-setuid-sandbox', 'disable-gpu-sandbox']) assert.equal(app.commandLine.hasSwitch(flag), false);
  });
  const browserSession = session.fromPartition('persist:fetchcv-public-browser-v2');
  const initialCookies = await browserSession.cookies.get({});
  check('new isolated session contains no account cookies before navigation', () => {
    assert.equal(BrowserWindow.getAllWindows().length, 0);
    assert.deepEqual(initialCookies, []);
  });
  const { createBrowserRuntime } = await import(pathToFileURL(path.resolve(__dirname, '../../electron/browser-bridge.mjs')).href);
  if (mode === 'live-xhs') {
    runtime = await createBrowserRuntime();
    const search = 'https://www.xiaohongshu.com/search_result/?keyword=%E5%B0%8F%E7%B1%B3%E4%BA%A7%E5%93%81%E7%BB%8F%E7%90%86&source=web_search_result_notes';
    // One command only. No login attempts, details-page requests, or retries.
    const snapshot = await runtime.command({ command: 'open', url: search });
    report.livePage = { status: snapshot.login_required || snapshot.user_action || snapshot.cooldown_until
      ? 'access_restricted' : snapshot.xhs_ready && snapshot.candidates?.length ? 'public_candidates_observed_not_body_validation' : 'no_usable_candidates',
      ...summarize(snapshot), cooldownUntil: snapshot.cooldown_until || null,
      isolatedSessionInitiallyEmpty: true, anonymous: snapshot.anonymous, accountSession: snapshot.account_session };
    report.scope = 'One isolated public search. Website-issued cookies are not proof of account login. No note-body, OCR, or LLM validation.';
    report.ok = report.livePage.status === 'public_candidates_observed_not_body_validation';
    return;
  }

  let pageHtml = '';
  let navigationCount = 0;
  browserSession.protocol.handle('https', request => {
    const requested = new URL(request.url);
    if (requested.hostname === 'www.xiaohongshu.com' && /^(?:\/explore\/|\/search_result)/.test(requested.pathname)) {
      navigationCount += 1;
      return new Response(pageHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response('', { status: 404 });
  });
  const noteMarkup = `<main><div id="detail-desc">${escape(text)}</div></main>`;
  const scenarios = [
    { name: 'interview prose mentioning CAPTCHA and QR login remains readable', html: html(noteMarkup, state()), verify: snapshot => {
      assert.equal(snapshot.login_required, false); assert.equal(snapshot.user_action, '');
      assert.equal(snapshot.note_ready, true); assert.equal(snapshot.xhs_ready, true);
      assert.match(snapshot.text, /验证码/); assert.match(snapshot.text, /扫码登录/);
      assert.equal(snapshot.published_at, '2026-01-01T00:00:00.000Z');
    } },
    ...['login-container', 'login-modal'].map(className => ({
      name: `${className} overlay blocks even a fully hydrated interview note`,
      blockedRepeat: className === 'login-container',
      html: html(`${noteMarkup}<div class="${className}" role="dialog">扫码登录后查看面经</div>`, state()),
      verify: snapshot => {
        assert.equal(snapshot.user_action, 'login'); assert.equal(snapshot.login_required, true);
        assert.equal(snapshot.xhs_ready, false); assert.equal(snapshot.note_ready, false); assert.ok(snapshot.cooldown_until);
      },
    })),
    { name: 'short image note is loaded but awaits content validation', cachedRepeat: true, html: html('<div id="detail-desc">面经在图里</div>', state('面经在图里', { imageList: [{ urlDefault: 'https://sns-webpic-qc.xhscdn.com/synthetic.png' }] })), verify: snapshot => {
      assert.equal(snapshot.login_required, false); assert.equal(snapshot.xhs_ready, true);
      assert.equal(snapshot.note_ready, false); assert.equal(snapshot.image_count, 1);
    } },
    { name: 'visible CAPTCHA blocks search despite existing signed candidates', url: 'https://www.xiaohongshu.com/search_result/?keyword=fixture',
      html: html(`<section class="note-item"><a href="/explore/${noteId}">产品经理面经</a></section><div class="captcha-container">请完成人机验证</div>`, {
        search: { notes: [{ modelType: 'note', id: noteId, noteCard: { title: '产品经理面经' }, xsecToken: 'synthetic-access-token' }] },
      }), verify: snapshot => {
        assert.equal(snapshot.candidates.length, 1); assert.equal(snapshot.candidates[0].access_grant, true);
        assert.equal(snapshot.candidates[0].url, url); assert.equal(snapshot.user_action, 'captcha');
        assert.equal(snapshot.xhs_ready, false); assert.equal(snapshot.login_required, true);
      } },
    { name: 'ordinary header login button is not a blocking wall', html: html(`<header><button class="login-button">扫码登录</button></header>${noteMarkup}`, state()), verify: snapshot => {
      assert.equal(snapshot.user_action, ''); assert.equal(snapshot.note_ready, true);
    } },
    { name: 'hidden login overlay does not block visible content', html: html(`${noteMarkup}<div class="login-modal" style="display:none">扫码登录</div>`, state()), verify: snapshot => {
      assert.equal(snapshot.user_action, ''); assert.equal(snapshot.note_ready, true);
    } },
    { name: 'recommendations and comments cannot replace the requested note', html: html(`${noteMarkup}<div class="comment-list">评论泄漏标记</div>`, {
      ...state(), recommend: { noteId: otherId, title: '推荐污染标记', desc: text.repeat(8) }, comments: [{ desc: '评论泄漏标记' }],
    }), verify: snapshot => {
      assert.equal(snapshot.text, `产品经理面经 ${text}`); assert.doesNotMatch(snapshot.text, /推荐污染标记|评论泄漏标记/);
    } },
    { name: 'DOM-only description excludes sidebar recommendations and comments', html: html(`${noteMarkup}<aside>侧栏泄漏标记${text.repeat(8)}</aside><div class="comment-list">评论泄漏标记</div>`), verify: snapshot => {
      assert.equal(snapshot.note_ready, true); assert.match(snapshot.text, /验证码/);
      assert.doesNotMatch(snapshot.text, /侧栏泄漏标记|评论泄漏标记/);
    } },
    { name: 'website-issued visitor cookie alone does not imply account login', cookie: true,
      html: html(noteMarkup, state()), verify: snapshot => {
        assert.equal(snapshot.account_session, false); assert.equal(snapshot.anonymous, true);
      } },
    { name: 'explicit hydrated login plus session cookie confirms account login', cookie: true,
      html: html(noteMarkup, { ...state(), user: { loggedIn: true } }), verify: snapshot => {
        assert.equal(snapshot.account_session, true); assert.equal(snapshot.anonymous, false);
      } },
    { name: 'login overlay overrides stale hydrated login and session cookie', cookie: true,
      html: html(`${noteMarkup}<div class="login-modal">扫码登录</div>`, { ...state(), user: { loggedIn: true } }), verify: snapshot => {
        assert.equal(snapshot.user_action, 'login'); assert.equal(snapshot.account_session, false); assert.equal(snapshot.anonymous, true);
      } },
    { name: 'visible own-profile navigation plus session cookie confirms login', cookie: true,
      html: html(`<nav><a href="/user/profile/synthetic-profile">我</a></nav>${noteMarkup}`, state()), verify: snapshot => {
        assert.equal(snapshot.account_session, true); assert.equal(snapshot.anonymous, false);
      } },
    { name: 'hydrated login without session cookie is unconfirmed',
      html: html(noteMarkup, { ...state(), user: { loggedIn: true } }), verify: snapshot => {
        assert.equal(snapshot.account_session, false); assert.equal(snapshot.anonymous, true);
      } },
  ];
  for (const scenario of scenarios) {
    pageHtml = scenario.html;
    await browserSession.cookies.remove('https://www.xiaohongshu.com/', 'web_session');
    if (scenario.cookie) await browserSession.cookies.set({ url: 'https://www.xiaohongshu.com/', name: 'web_session', value: 'synthetic-visitor-or-account-cookie', secure: true });
    const previousDownloadListeners = new Set(browserSession.listeners('will-download'));
    runtime = await createBrowserRuntime();
    const snapshot = await runtime.command({ command: 'open', url: scenario.url || url });
    check(scenario.name, () => scenario.verify(snapshot));
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.webSecurity, true);
    report.checks[report.checks.length - 1].observed = summarize(snapshot);
    if (scenario.cachedRepeat) {
      const previousNavigationCount = navigationCount;
      const cached = await runtime.command({ command: 'open', url: scenario.url || url });
      check('repeated short-image note is cached without navigation or budget consumption', () => {
        assert.equal(cached.cache_hit, true);
        assert.equal(cached.remaining_requests, snapshot.remaining_requests);
        assert.equal(navigationCount, previousNavigationCount);
        assert.equal(cached.note_ready, false); assert.equal(cached.xhs_ready, true);
      });
    }
    if (scenario.blockedRepeat) {
      const previousNavigationCount = navigationCount;
      await assert.rejects(runtime.command({ command: 'open', url: scenario.url || url }), /xiaohongshu_public_access_cooldown/);
      check('restricted note is not cached and cooldown rejects another open before navigation', () => {
        assert.equal(navigationCount, previousNavigationCount);
      });
    }
    runtime.stop(); runtime = null;
    // Each scenario intentionally creates a fresh guard. Remove only listeners
    // installed for that scenario so the shared fixture session does not grow.
    for (const listener of browserSession.listeners('will-download')) {
      if (!previousDownloadListeners.has(listener)) browserSession.removeListener('will-download', listener);
    }
    assert.equal(BrowserWindow.getAllWindows().length, 0);
  }
  report.navigationCount = navigationCount;
  report.scope = 'Synthetic protocol-response pages only, production bridge extraction in actual Electron renderers. No real Xiaohongshu note data or HTTP fetch; DNS validation still runs.';
  report.ok = true;
}
main().catch(error => { report.error = { name: error.name, message: error.message, stack: error.stack }; })
  .finally(() => {
    runtime?.stop();
    fs.writeFileSync(path.join(output, 'bridge-report.json'), JSON.stringify(report, null, 2));
    app.exit(report.ok ? 0 : mode === 'live-xhs' && !report.error ? 3 : 1);
  });
