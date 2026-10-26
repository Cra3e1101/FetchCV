// Production interview components; synthetic evidence and host APIs only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const run = `interview-workspace-${Date.now()}`;
const output = path.join(root, ".m1-work", run);
const evidence = path.join(root, ".m1-evidence", run);
await fs.mkdir(output, { recursive: true });
await fs.mkdir(evidence, { recursive: true });
await build({
  entryPoints: [path.join(root, "tests/fixtures/interview-workspace.jsx")],
  outfile: path.join(output, "fixture.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file", ".html": "text" },
  alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") },
});
await fs.writeFile(path.join(output, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="fixture.css"><style>
html,body,#root{height:100%;margin:0}.fixture-interview-shell{height:100vh;display:flex;padding:7px;gap:8px}.fixture-interview-shell>main{flex:1;min-width:0;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:14px;overflow:hidden}.fixture-interview-shell .task-header{min-height:54px;padding:12px 16px}.fixture-interview-shell .task-header h1{font-size:14px;font-weight:500;margin:0}.fixture-interview-context{font-size:12px;margin-left:auto}.fixture-interview-rail{width:300px;flex:none;overflow:auto;border-left:1px solid var(--line)}
</style></head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>`);
const server = http.createServer(async (request, response) => {
  const file = path.resolve(output, new URL(request.url, "http://localhost").pathname.slice(1) || "index.html");
  if (!file.startsWith(output + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await fs.readFile(file);
    response.writeHead(200, { "Content-Type": { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[path.extname(file)] || "application/octet-stream" });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const report = { fixture: "Production interview UI; synthetic sources, research receipts, and host calls", checks: [], pageErrors: [], screenshots: [] };
const check = (name, pass, detail) => {
  report.checks.push({ name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) });
  assert.ok(pass, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 950, height: 795 }, reducedMotion: "reduce" });
  page.on("pageerror", error => report.pageErrors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  const load = async (scenario = "saved", extra = "") => {
    await page.goto(`${url}/?scenario=${scenario}${extra}`);
    await page.getByRole("heading", { name: "面试准备", exact: true }).waitFor();
  };
  const capture = async name => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true, animations: "disabled" });
    report.screenshots.push(`${name}.png`);
  };
  const assertNoOverflow = async name => {
    const geometry = await page.evaluate(() => ({
      viewport: innerWidth, document: document.documentElement.scrollWidth,
      scrolls: [...document.querySelectorAll(".interview-scroll, .interview-page")].map(node => ({ client: node.clientWidth, scroll: node.scrollWidth })),
    }));
    check(name, geometry.document <= geometry.viewport + 1 && geometry.scrolls.every(row => row.scroll <= row.client + 1), geometry);
  };

  await load();
  const preparation = page.getByRole("tab", { name: /准备清单/ });
  const sourcesTab = page.getByRole("tab", { name: /面经来源/ });
  check("preparation is the initial tab", await preparation.getAttribute("aria-selected") === "true");
  check("JD preparation is immediately visible", await page.locator('[aria-label="基于 JD 推导的准备建议"]').isVisible());
  check("JD preparation starts in the first viewport", (await page.locator('[aria-label="基于 JD 推导的准备建议"]').boundingBox()).y < 500);
  await preparation.focus();
  await page.keyboard.press("ArrowRight");
  check("keyboard switches and focuses the sources tab", await sourcesTab.getAttribute("aria-selected") === "true" && await sourcesTab.evaluate(node => node === document.activeElement));
  await page.keyboard.press("Home");
  check("Home returns to preparation", await preparation.getAttribute("aria-selected") === "true" && await preparation.evaluate(node => node === document.activeElement));
  check("unsupported questions are not rendered", await page.getByText(/旧简报未验证的问题/).count() === 0);
  const researchDetails = page.locator("details").filter({ has: page.locator("summary", { hasText: "调研记录" }) }).first();
  check("research accounting is initially collapsed", await researchDetails.count() === 1 && !(await researchDetails.evaluate(node => node.open)));
  await assertNoOverflow("desktop preparation has no horizontal overflow");
  await capture("saved-desktop");
  await researchDetails.locator("summary").click();
  check("restricted and failed reads stay inspectable", await page.locator('[data-reason="restricted"]').isVisible() && await page.locator('[data-reason="read_failed"]').isVisible());
  await capture("research-records");
  await researchDetails.locator("summary").click();
  await page.getByRole("button", { name: "补充材料", exact: true }).click();
  check("supplement action opens the conversation", await page.evaluate(() => window.interviewFixture.conversations) === 1);
  await page.getByRole("button", { name: "重新调研", exact: true }).first().click();
  check("research action calls the host once", await page.evaluate(() => window.interviewFixture.researches) === 1);

  await sourcesTab.click();
  check("sources tab reveals saved evidence", await sourcesTab.getAttribute("aria-selected") === "true" && await page.locator(".interview-rail-source").count() === 3);
  await page.getByRole("button", { name: "连接小红书", exact: true }).click();
  await page.getByRole("button", { name: /我已登录/ }).click();
  check("Xiaohongshu connection completes its two-step flow", await page.evaluate(() => window.interviewFixture.loginBegins === 1 && window.interviewFixture.loginFinishes === 1));
  await page.locator(".interview-rail-source").first().locator("button").first().click();
  check("original source remains the primary source action", await page.evaluate(() => window.interviewFixture.originals[0]?.url === "https://example.com/interview/source-a"));
  const snapshot = page.locator(".interview-rail-source").first().locator("button.snapshot");
  await snapshot.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  check("local backup opens the production reader", await page.evaluate(() => window.interviewFixture.reads[0] === "source-a"));
  check("source reader takes keyboard focus", await dialog.evaluate(node => node.contains(document.activeElement)));
  const backdrop = await page.locator(".interview-reader-backdrop").boundingBox();
  const viewport = page.viewportSize();
  check("source reader backdrop covers the entire viewport", Math.abs(backdrop.x) <= 1 && Math.abs(backdrop.y) <= 1 && Math.abs(backdrop.width - viewport.width) <= 1 && Math.abs(backdrop.height - viewport.height) <= 1, { backdrop, viewport });
  const dialogControls = dialog.locator('a[href]:visible, button:not([disabled]):visible, input:not([disabled]):visible, select:not([disabled]):visible, textarea:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):visible');
  await dialogControls.last().focus();
  await page.keyboard.press("Tab");
  check("Tab wraps within the source reader", await dialogControls.first().evaluate(node => node === document.activeElement));
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab wraps within the source reader", await dialogControls.last().evaluate(node => node === document.activeElement));
  await capture("source-reader");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  check("Escape restores focus to the source action", await snapshot.evaluate(node => node === document.activeElement));
  await capture("sources-desktop");

  await load("supported");
  check("supported questions are preserved", await page.locator(".interview-question").count() === 2);
  check("single and independent support stay distinct", await page.getByText("单一经验", { exact: true }).isVisible() && await page.getByText("2 个独立来源", { exact: true }).isVisible());
  await capture("supported-desktop");
  await load("stale");
  check("stale brief never appears as current practice questions", await page.locator(".interview-question").count() === 0 && await page.locator('[aria-label="基于 JD 推导的准备建议"]').isVisible());
  await load("idle");
  check("new workspace offers research", await page.getByRole("button", { name: "调研面经", exact: true }).isEnabled());
  await capture("idle-desktop");
  await load("active");
  check("active research cannot be started twice", await page.getByRole("button", { name: /调研中|正在调研/ }).first().isDisabled());
  check("active research keeps preparation available", await page.locator('[aria-label="基于 JD 推导的准备建议"]').isVisible());
  await load("approval");
  check("pending tool approval is visible and blocks duplicate research", await page.getByText("有操作等待确认", { exact: true }).isVisible() && await page.locator(".interview-primary").isDisabled());
  await page.getByRole("button", { name: "前往确认", exact: true }).click();
  check("approval has a direct conversation action", await page.evaluate(() => window.interviewFixture.conversations) === 1);
  await load("resume-approval");
  check("resume approval does not block interview research", await page.locator(".interview-primary").isEnabled() && await page.getByRole("button", { name: "前往确认", exact: true }).count() === 0);
  await load("unconfigured");
  check("missing model disables research only", await page.getByRole("button", { name: "调研面经", exact: true }).isDisabled() && await page.locator('[aria-label="基于 JD 推导的准备建议"]').isVisible());
  await load("no-jd");
  check("missing JD has a clear empty state", await page.locator('[aria-label="基于 JD 推导的准备建议"]').isVisible());
  await page.getByRole("button", { name: "补充岗位 JD", exact: true }).click();
  check("missing JD action opens the job editor", await page.evaluate(() => window.interviewFixture.edits === 1 && window.interviewFixture.conversations === 0));
  await page.getByRole("button", { name: "补充材料", exact: true }).click();
  check("supplement routes to job editing while JD is missing", await page.evaluate(() => window.interviewFixture.edits === 2 && window.interviewFixture.conversations === 0));
  await page.getByRole("tab", { name: /面经来源/ }).click();
  await page.getByRole("button", { name: "补充面经原文", exact: true }).click();
  check("empty source supplement also resolves the missing JD", await page.evaluate(() => window.interviewFixture.edits === 3 && window.interviewFixture.conversations === 0));

  await page.setViewportSize({ width: 400, height: 820 });
  await load();
  await assertNoOverflow("narrow preparation has no horizontal overflow");
  await capture("saved-narrow");
  await page.getByRole("tab", { name: /面经来源/ }).click();
  await assertNoOverflow("narrow sources have no horizontal overflow");
  await capture("sources-narrow");
  await page.setViewportSize({ width: 950, height: 795 });
  await load("supported", "&theme=neutral-dark");
  await assertNoOverflow("dark preparation has no horizontal overflow");
  await capture("supported-dark");
  await page.setViewportSize({ width: 1280, height: 900 });
  await load("supported", "&rail=1");
  await assertNoOverflow("workspace with evidence rail has no horizontal overflow");
  await capture("supported-with-rail");
  check("no browser runtime errors", report.pageErrors.length === 0, report.pageErrors);
} finally {
  await fs.writeFile(path.join(evidence, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  console.log(`Interview UI evidence: ${evidence}`);
}
