import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalXiaohongshuUrl,
  createXiaohongshuAccessCache,
  createXiaohongshuPublicAccessGuard,
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
