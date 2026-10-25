import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { preview } from "vite";
import { chromium } from "playwright";

// Production renderer with isolated, controllable APIs. No user data or model calls.
// Run `npm run build` first.
const server = await preview({ preview: { host: "127.0.0.1", port: 0, open: false } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const evidenceRoot = path.resolve(".m1-evidence/job-switching");
fs.mkdirSync(evidenceRoot, { recursive: true });
const evidence = fs.mkdtempSync(path.join(evidenceRoot, "run-"));
const candidate = { id: "fixture-candidate", name: "切换测试", fact_count: 1, resume_count: 0 };
const jobs = ["initial", "a", "b", "c", "d", "error"].map(id => ({
  id, candidate_id: candidate.id, company: `公司 ${id.toUpperCase()}`, role: `岗位 ${id.toUpperCase()}`, jd_raw: "测试岗位描述", status: "draft",
}));
const detail = id => ({
  job: jobs.find(job => job.id === id), candidate, run: null,
  messages: [{ id: `${id}-message`, role: "assistant", content: `${id.toUpperCase()} 的已保存回复`, metadata_json: {} }],
  tasks: [], approvals: [], facts: [], steps: [], proposals: [], resumes: [], base_resumes: [], materials: [], portfolios: [], experiences: [],
});
const saved = new Map(jobs.map(job => [job.id, detail(job.id)]));
const responses = {
  "/api/workspace": { candidates: [candidate], jobs },
  "/api/runtime/status": { configured: true, model: "fixture-model" },
  "/api/settings/general": { theme: "light" },
  "/api/settings/permissions": {},
  "/api/conversations": [],
  [`/api/candidates/${candidate.id}/library`]: { candidate, facts: [], experiences: [], materials: [], resumes: [], interview_sources: [], interview_briefs: [] },
};
const gates = new Map(), reads = new Map(), errors = [], checks = [], layout = [];
function hold(url) {
  let release, markStarted;
  const gate = { hits: 0, started: new Promise(resolve => { markStarted = resolve; }), promise: new Promise(resolve => { release = resolve; }) };
  gate.release = value => { if (gates.get(url) === gate) gates.delete(url); release(value); };
  gate.hit = () => { gate.hits++; markStarted(); };
  gates.set(url, gate);
  return gate;
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Fixture request did not start")), 5000); })]); }
  finally { clearTimeout(timer); }
}
let browser, page;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.FETCHCV_BROWSER_CHANNEL || "chrome" });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(apiBase => {
    window.switchFixture = { streams: [] };
    window.appRuntime = {
      apiBase,
      getBackendStatus: async () => ({ state: "ready", dataReady: true, agentReady: true }),
      onBackendStatus: () => () => {},
      listModelProviders: async () => ({ profiles: [] }),
      streamPiMessage(input, onEvent) {
        return new Promise(resolve => {
          window.switchFixture.streams.push({ input, onEvent, resolve });
          onEvent("user", { message: { id: `${input.jobId}-user`, role: "user", content: input.content, metadata_json: {} } });
        });
      },
    };
  }, origin);
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()).pathname;
    reads.set(url, (reads.get(url) || 0) + 1);
    const gate = gates.get(url);
    let override;
    if (gate) { gate.hit(); override = await gate.promise; }
    if (override?.status) return route.fulfill({ status: override.status, json: { detail: "合成读取失败" } });
    const jobId = url.match(/^\/api\/jobs\/([^/]+)\/workspace$/)?.[1];
    await route.fulfill({ json: override?.json || (jobId ? saved.get(jobId) : responses[url]) || {} });
  });
  const initialResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/jobs/initial/workspace");
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await initialResponse;
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const choose = async id => {
    const button = page.getByRole("button", { name: `公司 ${id.toUpperCase()} 岗位 ${id.toUpperCase()}`, exact: true });
    if (!await button.isVisible()) await page.getByRole("button", { name: "打开侧栏", exact: true }).click();
    await button.click();
  };
  const shown = id => page.getByRole("heading", { name: `岗位 ${id.toUpperCase()}`, exact: true }).waitFor();
  const ready = async id => { await shown(id); assert.equal(await page.locator(".workspace-recovery").count(), 0); };
  const libraryGate = hold(`/api/candidates/${candidate.id}/library`);
  await choose("a"); await ready("a");
  checks.push("A first visit renders while every subsequent personal-library read is held");

  await page.getByRole("textbox", { name: "消息", exact: true }).fill("A 的未发送草稿");
  await choose("b"); await ready("b");
  assert.equal(await page.getByRole("textbox", { name: "消息", exact: true }).inputValue(), "");
  checks.push("switching jobs does not carry another job's composer draft");
  const refreshA = hold("/api/jobs/a/workspace");
  await choose("a"); await ready("a"); await bounded(refreshA.started);
  await page.getByText("A 的已保存回复", { exact: true }).waitFor();
  await choose("a"); await ready("a");
  assert.equal(refreshA.hits, 1, "repeated clicks must reuse an in-flight selection request");
  refreshA.release({ status: 503 });
  await page.getByText("合成读取失败", { exact: true }).waitFor();
  await ready("a"); await page.getByText("A 的已保存回复", { exact: true }).waitFor();
  checks.push("cached job is immediate, repeated requests deduplicate, failed background refresh preserves content");

  const coldC = hold("/api/jobs/c/workspace"), coldD = hold("/api/jobs/d/workspace");
  await choose("c"); await bounded(coldC.started);
  await page.locator('.workspace-recovery[role="status"]').waitFor();
  for (const size of [{ width: 1280, height: 800 }, { width: 640, height: 640 }, { width: 553, height: 640 }]) {
    await page.setViewportSize(size);
    if (size.width < 760) {
      await page.getByRole("button", { name: "打开侧栏", exact: true }).click();
      const sidebar = await page.getByRole("complementary", { name: "工作空间导航", exact: true }).boundingBox();
      assert.ok(Math.abs(sidebar.x - 52) < 1, `compact sidebar must start just after the 52px rail: ${JSON.stringify(sidebar)}`);
      await choose("c");
      await page.getByRole("complementary", { name: "工作空间导航", exact: true }).waitFor({ state: "detached" });
    }
    const box = await page.locator(".workspace-recovery").evaluate(node => {
      const panel = node.getBoundingClientRect(), icon = node.querySelector("svg").getBoundingClientRect(), copy = node.querySelector("p").getBoundingClientRect();
      const uncovered = rect => [rect.left + 1, rect.left + rect.width / 2, rect.right - 1].every(x => node.contains(document.elementFromPoint(x, rect.top + rect.height / 2)));
      return { panel: panel.toJSON(), icon: icon.toJSON(), copy: copy.toJSON(), iconUncovered: uncovered(icon), copyUncovered: uncovered(copy), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
    assert.ok(box.panel.width > 200 && box.panel.height > 400, JSON.stringify(box));
    assert.ok(Math.abs((box.icon.left + box.icon.width / 2) - (box.panel.left + box.panel.width / 2)) < 2, "spinner must be horizontally centered");
    assert.ok(Math.abs((box.icon.top + box.copy.bottom) / 2 - (box.panel.top + box.panel.height / 2)) < 30, "loading group must be vertically centered");
    assert.ok(box.copy.top > box.icon.bottom, "spinner and copy need a visible vertical gap");
    assert.ok(box.iconUncovered && box.copyUncovered, `sidebar or another layer covers the loading indicator: ${JSON.stringify(box)}`);
    assert.ok(box.panel.right <= size.width + 1 && box.panel.bottom <= size.height + 1 && box.scrollWidth <= box.clientWidth + 1, "loading must not overflow the viewport");
    layout.push({ ...size, ...box });
    await page.screenshot({ path: path.join(evidence, `loading-${size.width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await choose("d"); await bounded(coldD.started);
  coldD.release(); await ready("d");
  coldC.release();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await ready("d"); assert.equal(await page.getByText("C 的已保存回复", { exact: true }).count(), 0);
  checks.push("cold loading is centered and unobscured at 1280px/640px/553px; late C response cannot replace selected D");

  await choose("a"); await ready("a");
  const composer = page.getByRole("textbox", { name: "消息", exact: true });
  await composer.fill("A 的后台生成测试"); await composer.press("Enter");
  await page.waitForFunction(() => window.switchFixture.streams.length === 1);
  await choose("b"); await ready("b");
  await page.evaluate(() => window.switchFixture.streams[0].onEvent("delta", { text: "A 的后台临时增量" }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const readsWhileStreaming = reads.get("/api/jobs/a/workspace");
  await choose("a"); await ready("a");
  await page.getByText("A 的后台临时增量", { exact: true }).waitFor();
  // A fresh API response intentionally contains only persisted messages. Give a
  // mistaken navigation refresh time to arrive and erase the streaming delta.
  await page.waitForTimeout(150);
  assert.equal(reads.get("/api/jobs/a/workspace"), readsWhileStreaming, "returning to an active stream must not re-read its stale persisted snapshot");
  await page.getByText("A 的后台临时增量", { exact: true }).waitFor();
  checks.push("returning mid-stream preserves unpersisted deltas without an obsolete navigation refresh");
  await choose("b"); await ready("b");
  const assistant = { id: "a-completed", role: "assistant", content: "A 在后台完成的回复", metadata_json: {} };
  saved.set("a", { ...saved.get("a"), messages: [...saved.get("a").messages, { id: "a-user", role: "user", content: "A 的后台生成测试", metadata_json: {} }, assistant] });
  const finishResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/jobs/a/workspace");
  await page.evaluate(message => {
    const stream = window.switchFixture.streams[0];
    stream.onEvent("done", { assistant: message });
    stream.resolve({});
  }, assistant);
  await finishResponse;
  const returnA = hold("/api/jobs/a/workspace");
  await choose("a"); await ready("a");
  await page.getByText(assistant.content, { exact: true }).waitFor();
  assert.equal(await page.getByText("B 的已保存回复", { exact: true }).count(), 0);
  returnA.release();
  checks.push("a response completed offscreen is in the cache before the return refresh completes");
  libraryGate.release();
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(evidence, "cached-job-return.png") });
  fs.writeFileSync(path.join(evidence, "report.json"), JSON.stringify({ passed: true, checks, layout, reads: Object.fromEntries(reads), errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, evidence }));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(evidence, "failure.png") });
    fs.writeFileSync(path.join(evidence, "failure.txt"), await page.locator("body").innerText());
  }
  throw error;
} finally {
  for (const gate of gates.values()) gate.release();
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
