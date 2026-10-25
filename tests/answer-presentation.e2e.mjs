import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".m1-work", `answer-presentation-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
await build({
  entryPoints: [path.join(root, "tests/fixtures/answer-presentation.jsx")], outfile: path.join(output, "fixture.js"),
  bundle: true, format: "esm", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file", ".html": "text" },
  alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") },
});
await fs.writeFile(path.join(output, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>');
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  const file = path.resolve(output, name);
  if (!file.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2" }[path.extname(file)];
    const bytes = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": mime || "application/octet-stream" }).end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const theme of ["white", "neutral-dark"]) {
    for (const width of [1040, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/?theme=${theme}`);
      const tables = page.locator(".agent-data-table");
      await tables.nth(1).waitFor();
      assert.equal(await tables.first().locator("tbody tr").count(), 10);
      assert.equal(await tables.first().locator("th").count(), 2);
      assert.equal(await tables.first().locator("td").nth(1).evaluate(node => getComputedStyle(node).textAlign), "right");
      assert.equal(await tables.nth(1).getByRole("link", { name: "原始资料" }).getAttribute("href"), "https://example.com/source");
      assert.match(await tables.nth(1).textContent(), /A\|B/);
      assert.equal(await page.locator(".agent-code-block").count(), 1);
      const geometry = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth, viewport: innerWidth,
        tables: [...document.querySelectorAll(".agent-table-scroll")].map(node => ({ client: node.clientWidth, scroll: node.scrollWidth })),
      }));
      assert.ok(geometry.document <= geometry.viewport + 1, JSON.stringify(geometry));
      assert.ok(geometry.tables[1].scroll > geometry.tables[1].client, "wide tables scroll inside their wrapper");
      await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: true });
    }
  }
  const first = page.locator(".agent-data-table").first();
  await first.getByRole("button", { name: "复制表格", exact: true }).click();
  await first.getByRole("button", { name: "复制表格", exact: true }).filter({ has: page.locator("svg.lucide-check") }).waitFor();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clipboard.split(/\r?\n/).length, 11);
  assert.match(clipboard, /^城市\t示例数值（分）\r?\n上海\t100/);
  const downloadEvent = page.waitForEvent("download");
  await first.getByRole("button", { name: "导出表格 CSV" }).click();
  const download = await downloadEvent;
  const bytes = await fs.readFile(await download.path());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(bytes.toString("utf8"), /上海,100/);
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async () => { throw new Error("Permission denied"); } }));
  await first.getByRole("button", { name: "复制表格", exact: true }).click();
  await first.getByText("复制失败，请重试").waitFor();
  await page.getByRole("button", { name: "模拟生成" }).click();
  await page.locator('.agent-data-table[aria-busy="true"]').waitFor();
  assert.equal(await first.getByRole("button", { name: "复制表格", exact: true }).isDisabled(), true);
  assert.equal(await first.getByRole("button", { name: "导出表格 CSV" }).isDisabled(), true);
  await page.getByRole("button", { name: "完成生成" }).click();
  await page.locator('.agent-data-table[aria-busy="false"]').first().waitFor();
  assert.equal(await first.getByRole("button", { name: "复制表格", exact: true }).isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, output, checks: "10-row table, alignment, sources, escaped pipes, code, narrow/dark layouts, clipboard, CSV BOM, copy failure, streaming controls" }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
