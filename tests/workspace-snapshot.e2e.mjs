import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

// Instrument only this isolated test bundle; production components are not
// edited. Count real component executions after their existing memo boundary.
const root = path.resolve(import.meta.dirname, "..");
const evidenceRoot = path.join(root, ".m1-evidence/workspace-snapshot");
await fs.mkdir(evidenceRoot, { recursive: true });
const output = await fs.mkdtemp(path.join(evidenceRoot, "run-"));
await build({
  entryPoints: [path.join(root, "tests/fixtures/workspace-snapshot.jsx")], outfile: path.join(output, "fixture.js"),
  bundle: true, format: "esm", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file", ".html": "text" },
  alias: { "lucide-react": path.join(root, "src/ui/lucide-compat.js") },
  plugins: [{ name: "count-message-renders", setup(builder) {
    builder.onLoad({ filter: /[\\/]components[\\/]Agent(?:Message|Markdown)\.jsx$/ }, async ({ path: filename }) => {
      const markdown = filename.endsWith("AgentMarkdown.jsx");
      const marker = markdown ? "  const components = useMemo" : "  const [copied, setCopied] = useState(false);";
      const source = await fs.readFile(filename, "utf8");
      assert.ok(source.includes(marker), `Render instrumentation marker missing: ${filename}`);
      return { contents: source.replace(marker, `  window.snapshotStats.${markdown ? "markdownRenders" : "messageRenders"}++;\n${marker}`), loader: "jsx" };
    });
  } }],
});
await fs.writeFile(path.join(output, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script type="module" src="fixture.js"></script>');
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  const filename = path.resolve(output, name);
  if (!filename.startsWith(output + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const contentType = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[path.extname(filename)];
    const bytes = await fs.readFile(filename);
    res.writeHead(200, { "Content-Type": contentType || "application/octet-stream" }).end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
const report = { synthetic: true, modes: {}, errors: [] };
try {
  browser = await chromium.launch({ channel: process.env.FETCHCV_BROWSER_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage({ reducedMotion: "reduce" });
  page.on("pageerror", error => report.errors.push(error.message));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const mode of ["baseline", "shared"]) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
    await page.waitForFunction(() => document.querySelectorAll(".agent-markdown").length === 80 && window.snapshotFixture);
    await settle();
    const results = {};
    for (const action of ["unchanged", "append", "content", "metadata", "source"]) {
      const before = await page.evaluate(() => ({ ...window.snapshotStats, revision: window.snapshotFixture.revision }));
      await page.evaluate(action => window.snapshotFixture.refresh(action), action);
      await page.waitForFunction(revision => window.snapshotFixture.revision > revision, before.revision);
      await settle();
      const after = await page.evaluate(() => ({ ...window.snapshotStats }));
      results[action] = {
        messageRenders: after.messageRenders - before.messageRenders,
        markdownRenders: after.markdownRenders - before.markdownRenders,
        sharingMs: after.sharingMs - before.sharingMs,
      };
      assert.equal(await page.locator(".agent-message").count(), action === "unchanged" ? 80 : 81);
      if (action !== "unchanged") await page.getByText("新增完整回复", { exact: true }).waitFor();
      if (["content", "metadata", "source"].includes(action)) await page.getByText("更新后的完整正文", { exact: true }).waitFor();
      if (action === "source") assert.match(await page.locator(".agent-source-link").first().textContent(), /2027/);
    }
    report.modes[mode] = results;
  }
  assert.equal(report.modes.baseline.unchanged.messageRenders, 80);
  assert.equal(report.modes.baseline.unchanged.markdownRenders, 80);
  assert.deepEqual([report.modes.shared.unchanged.messageRenders, report.modes.shared.unchanged.markdownRenders], [0, 0]);
  assert.deepEqual([report.modes.shared.append.messageRenders, report.modes.shared.append.markdownRenders], [1, 1]);
  assert.deepEqual([report.modes.shared.content.messageRenders, report.modes.shared.content.markdownRenders], [1, 1]);
  assert.equal(report.modes.shared.metadata.messageRenders, 1);
  assert.equal(report.modes.shared.metadata.markdownRenders, 0);
  assert.equal(report.modes.shared.source.messageRenders, 81, "source changes must still reach every message");
  assert.equal(report.modes.shared.source.markdownRenders, 81);
  assert.deepEqual(report.errors, []);
  report.passed = true;
  report.limitations = ["Counts use the production message/Markdown components with test-only instrumentation and synthetic snapshots.", "This is a repeated-refresh render count comparison, not a user-device navigation latency benchmark."];
  console.log(JSON.stringify({ ...report, output }));
} finally {
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
