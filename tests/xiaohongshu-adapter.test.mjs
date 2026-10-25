import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalXiaohongshuUrl,
  createXiaohongshuAccessCache,
  createXiaohongshuPublicAccessGuard,
  createBrowserCommandGate,
  isXiaohongshuUrl,
  xiaohongshuRecoveryQueries,
} from "../electron/xiaohongshu-adapter.mjs";

test("xiaohongshu adapter retains share access URLs without exposing them through canonical ids", () => {
  const accessUrl = "https://www.xiaohongshu.com/discovery/item/6a5b612a000000000503ba9f?source=webshare&xsec_token=temporary";
  const canonical = "https://www.xiaohongshu.com/discovery/item/6a5b612a000000000503ba9f";
  const cache = createXiaohongshuAccessCache();

  assert.equal(isXiaohongshuUrl(accessUrl), true);
  assert.equal(canonicalXiaohongshuUrl(accessUrl), canonical);
  assert.equal(cache.remember(accessUrl), canonical);
  assert.equal(cache.resolve(canonical), accessUrl);
  cache.clear();
  assert.equal(cache.resolve(canonical), canonical);
});

test("search cards never exempt login or CAPTCHA from persistent cooldown", () => {
  let saved;
  let now = 1_000_000;
  const guard = createXiaohongshuPublicAccessGuard({ clock: () => now, cooldownMs: 30000, onChange: (state) => { saved = structuredClone(state); } });
  guard.afterOpen({ page_kind: "search", candidates: [{ url: "public" }], login_required: true, user_action: "captcha" });
  const restored = createXiaohongshuPublicAccessGuard({ clock: () => now, cooldownMs: 30000, initialState: saved });
  assert.throws(() => restored.beforeOpen("https://www.xiaohongshu.com/explore/one"), /cooldown/);
  now += 30001;
  restored.afterOpen({ user_action: "rate_limited" });
  assert.equal(Date.parse(restored.status().cooldown_until) - now, 60000);
});

test("repeated URLs and scrolls consume the same budget across restarts", () => {
  let saved;
  const options = { maxRequests: 2, minIntervalMs: 100, clock: () => 100000, onChange: (state) => { saved = structuredClone(state); } };
  const guard = createXiaohongshuPublicAccessGuard(options);
  guard.beforeOpen("https://www.xiaohongshu.com/search_result?keyword=test");
  guard.beforeOpen("https://www.xiaohongshu.com/search_result?keyword=test");
  const restored = createXiaohongshuPublicAccessGuard({ ...options, initialState: saved });
  assert.throws(() => restored.beforeOpen("https://www.xiaohongshu.com/search_result?keyword=test"), /access_limit/);
  assert.equal(restored.status().remaining_requests, 0);
});

test("shared browser coalesces duplicates and refuses racing navigation", async () => {
  let finish;
  let calls = 0;
  const command = createBrowserCommandGate(() => { calls += 1; return new Promise((resolve) => { finish = resolve; }); });
  const request = { command: "open", url: "https://www.xiaohongshu.com/explore/one" };
  const first = command(request);
  const second = command(request);
  assert.equal(first, second);
  await assert.rejects(command({ ...request, url: "https://example.com" }), /browser_busy/);
  assert.equal(calls, 1);
  finish({ text: "one" });
  assert.deepEqual(await second, { text: "one" });
  const third = command(request);
  await Promise.resolve();
  finish({ text: "two" });
  assert.deepEqual(await third, { text: "two" });
});

test("xiaohongshu access cache restores locally encrypted entries after restart", () => {
  const accessUrl = "https://www.xiaohongshu.com/explore/restart-note?xsec_token=temporary&xsec_source=pc_search";
  const canonical = "https://www.xiaohongshu.com/explore/restart-note";
  const first = createXiaohongshuAccessCache();
  first.remember(accessUrl);

  const restored = createXiaohongshuAccessCache({ initialEntries: first.entries() });
  assert.equal(restored.resolve(canonical), accessUrl);
});

test("xiaohongshu access cache never lets a canonical URL erase an in-memory access grant", () => {
  const cache = createXiaohongshuAccessCache();
  const accessUrl = "https://www.xiaohongshu.com/explore/note-access?xsec_token=temporary&xsec_source=pc_search";
  const canonical = "https://www.xiaohongshu.com/explore/note-access";
  assert.equal(cache.remember(accessUrl), canonical);
  assert.equal(cache.remember(canonical), canonical);
  assert.equal(cache.resolve(canonical), accessUrl);
});

test("share and search aliases reuse one note grant without changing canonical URLs", () => {
  const noteId = "6a5b612a000000000503ba9f";
  const accessUrl = `https://www.xiaohongshu.com/discovery/item/${noteId}?xsec_token=share-token&xsec_source=pc_share`;
  const searchCanonical = `https://xiaohongshu.com/explore/${noteId}`;
  const cache = createXiaohongshuAccessCache({ maxEntries: 1 });
  cache.remember(accessUrl);
  assert.equal(cache.resolve(searchCanonical), accessUrl);
  assert.equal(cache.resolve(`${searchCanonical}/`), accessUrl);
  assert.equal(cache.remember(searchCanonical), searchCanonical);
  assert.equal(cache.entries().length, 1);
  assert.equal(cache.entries()[0].canonical, searchCanonical);
  assert.equal(cache.resolve(searchCanonical), accessUrl);
  const restored = createXiaohongshuAccessCache({ initialEntries: cache.entries() });
  assert.equal(restored.resolve(`https://www.xiaohongshu.com/explore/${noteId}`), accessUrl);
  assert.equal(restored.resolve(`https://www.xiaohongshu.com/explore/different-note`), "https://www.xiaohongshu.com/explore/different-note");
});

test("tokenless cache reads do not extend or resurrect expiring access grants", () => {
  let now = 1000;
  const canonical = "https://www.xiaohongshu.com/explore/expiring-note";
  const accessUrl = `${canonical}?xsec_token=expires`;
  const cache = createXiaohongshuAccessCache({ ttlMs: 100, clock: () => now });
  cache.remember(accessUrl);
  now = 1050;
  cache.remember(canonical);
  assert.equal(cache.entries()[0].expiresAt, 1100);
  assert.equal(cache.resolve(canonical), accessUrl);
  now = 1101;
  cache.remember(canonical);
  assert.equal(cache.resolve(canonical), canonical);
});

test("legacy cache aliases preserve live grants and discard expired or invalid records", () => {
  const noteId = "6a5b612a000000000503ba9f";
  const canonical = `https://www.xiaohongshu.com/explore/${noteId}`;
  const share = `https://www.xiaohongshu.com/discovery/item/${noteId}`;
  const accessUrl = `${share}?xsec_token=live`;
  const cache = createXiaohongshuAccessCache({ clock: () => 1000, initialEntries: [
    { canonical: share, url: accessUrl, expiresAt: 2000 },
    { canonical, url: canonical, expiresAt: 3000 },
    { canonical, url: `${canonical}?xsec_token=expired`, expiresAt: 999 },
    { canonical, url: `${canonical}?xsec_token=invalid`, expiresAt: "not-a-date" },
  ] });
  assert.equal(cache.resolve(canonical), accessUrl);
  assert.equal(cache.entries().length, 1);
  assert.equal(cache.entries()[0].expiresAt, 2000);
});

test("old Xiaohongshu sources use bounded recovery queries", () => {
  assert.deepEqual(
    xiaohongshuRecoveryQueries({
      title: "滴滴-两轮车策略运营实习面经 - 小红书",
      company: "滴滴出行",
      businessUnit: "两轮车事业部",
      role: "策略运营",
    }),
    [
      "滴滴-两轮车策略运营实习面经",
      "滴滴 两轮车 策略运营 面经",
      "滴滴 策略运营 面经",
      "滴滴 滴滴-两轮车策略运营实习",
    ],
  );
});

test("search grants survive profile and recommendation cache pollution", () => {
  const cache = createXiaohongshuAccessCache({ maxEntries: 3 });
  const target = "https://www.xiaohongshu.com/explore/target?xsec_token=needed&xsec_source=pc_search";
  cache.remember(target);
  for (let index = 0; index < 300; index++) {
    cache.remember(`https://www.xiaohongshu.com/user/profile/user${index}?xsec_token=profile`);
    cache.remember(`https://www.xiaohongshu.com/explore/feed${index}?xsec_token=feed&xsec_source=pc_feed`);
  }
  assert.equal(cache.resolve(canonicalXiaohongshuUrl(target)), target);
  assert.ok(cache.entries().length <= 3);
  assert.ok(cache.entries().every(item => !item.url.includes("/user/profile/")));
  assert.equal(createXiaohongshuAccessCache({ initialEntries: cache.entries() }).resolve(canonicalXiaohongshuUrl(target)), target);
});

test("xiaohongshu adapter does not rewrite unrelated URLs", () => {
  const url = "https://example.com/path?token=kept-by-this-site-specific-helper";
  assert.equal(isXiaohongshuUrl(url), false);
  assert.equal(canonicalXiaohongshuUrl(url), url);
});

test("anonymous public access is bounded and never represents an account session", () => {
  let now = 1_000_000;
  const guard = createXiaohongshuPublicAccessGuard({
    maxUnique: 2,
    minIntervalMs: 1000,
    windowMs: 10_000,
    cooldownMs: 30_000,
    clock: () => now,
  });
  const first = guard.beforeOpen("https://www.xiaohongshu.com/explore/one");
  assert.equal(first.waitMs, 0);
  assert.equal(first.account_session, false);
  now += 100;
  const second = guard.beforeOpen("https://www.xiaohongshu.com/explore/two");
  assert.equal(second.waitMs, 900);
  assert.equal(second.remaining_requests, 0);
  assert.throws(
    () => guard.beforeOpen("https://www.xiaohongshu.com/explore/three"),
    /xiaohongshu_public_access_limit/,
  );
});

test("note extraction matches URL identity and excludes longer comments and recommendations", async () => {
  const { extractXiaohongshuNote } = await import("../electron/xiaohongshu-adapter.mjs");
  const state = { recommendations: { noteId: "target", desc: "not evidence" }, note: { noteDetailMap: {
    other: { note: { noteId: "other", desc: "Other interview" } },
    target: { note: { noteId: "target", title: "面经", desc: "真实正文", imageList: [{}, {}] }, comments: [{ desc: "Noise".repeat(200) }] },
  } } };
  assert.deepEqual(extractXiaohongshuNote(state, "target"), { title: "面经", description: "真实正文", imageCount: 2, imageUrls: [], imageGroups: [[], []], publishedAt: "" });
  assert.equal(extractXiaohongshuNote(state, "missing"), null);
});

test("completed login clears only login cooldown and preserves request budget", () => {
  const guard = createXiaohongshuPublicAccessGuard({ maxRequests: 1 });
  guard.beforeOpen("https://www.xiaohongshu.com/explore/one");
  guard.afterOpen({ login_required: true, user_action: "login" });
  assert.equal(guard.resumeAfterLogin().cooldown_until, "");
  assert.throws(() => guard.beforeOpen("https://www.xiaohongshu.com/explore/two"), /access_limit/);
  guard.afterOpen({ user_action: "rate_limited" });
  guard.afterOpen({ user_action: "login" });
  assert.notEqual(guard.resumeAfterLogin().cooldown_until, "");
});

test("anonymous public access opens a circuit after login or captcha", () => {
  let now = 2_000_000;
  const guard = createXiaohongshuPublicAccessGuard({ cooldownMs: 30_000, clock: () => now });
  guard.beforeOpen("https://www.xiaohongshu.com/explore/one");
  const status = guard.afterOpen({ login_required: true, user_action: "login" });
  assert.match(status.cooldown_until, /T/);
  assert.throws(
    () => guard.beforeOpen("https://www.xiaohongshu.com/explore/two"),
    /xiaohongshu_public_access_cooldown/,
  );
  now += 30_001;
  assert.doesNotThrow(() => guard.beforeOpen("https://www.xiaohongshu.com/explore/two"));
});
