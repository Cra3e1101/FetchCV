import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { _electron as electron } from "playwright";
import { resolveElectronRuntime } from "../scripts/electron-runtime.mjs";
import { findFreePort, isFetchCVHealthy } from "../electron/sidecar.mjs";

const root = path.resolve(import.meta.dirname, "..");
const packagedExecutable = process.env.FETCHCV_NATIVE_TEST_PACKAGED
  ? path.resolve(process.env.FETCHCV_NATIVE_TEST_PACKAGED) : "";
const packaged = Boolean(packagedExecutable);
const isolatedRuns = path.join(root, ".tmp/resume-native-runs");
fs.mkdirSync(isolatedRuns, { recursive: true });
const temporary = fs.mkdtempSync(path.join(isolatedRuns, "fetchcv-native-"));
for (const directory of ["profile", "session", "temp", "artifacts", "workspace"]) fs.mkdirSync(path.join(temporary, directory));
const output = path.resolve(process.env.FETCHCV_NATIVE_TEST_OUTPUT || path.join(root, packaged ? ".tmp/resume-native-packaged-qa" : ".tmp/resume-native-qa"));
fs.mkdirSync(output, { recursive: true });
const startedAt = new Date().toISOString();
fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ status: "running", startedAt, packaged }, null, 2));
const database = path.join(temporary, "smoke.sqlite");
const python = path.resolve(process.env.FETCHCV_NATIVE_TEST_PYTHON || path.join(root, "backend/.venv-m1/Scripts/python.exe"));
const runtimeDirectory = packaged
  ? path.join(path.dirname(packagedExecutable), "resources/resume-runtime") : path.join(root, "build/resume-runtime");
const runtimeManifest = JSON.parse(fs.readFileSync(path.join(runtimeDirectory, "runtime-manifest.json"), "utf8"));
assert.equal(runtimeManifest.engine, "xelatex");
assert.equal(runtimeManifest.producer, "fetchcv-resume-runtime");
if (packaged) {
  assert.equal(fs.statSync(packagedExecutable).isFile(), true, "The actual packaged executable is required");
  assert.equal(fs.existsSync(path.join(path.dirname(packagedExecutable), "resources/sidecar/fetchcv-api.exe")), true, "The packaged Python sidecar is required");
}
const fixture = JSON.parse(execFileSync(python, [path.join(root, "tests/fixtures/resume-native-seed.py"), database], { encoding: "utf8", windowsHide: true }));
const port = await findFreePort();
const apiBase = `http://127.0.0.1:${port}`;
const windowsDirectory = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows";
const systemPath = [path.join(windowsDirectory, "System32"), windowsDirectory].join(path.delimiter);
// The app gets no developer TeX/Python override or inherited app profile.
// Only the absolute Python path used by this harness seeds and inspects files.
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(FETCHCV_|TEX|MIKTEX|KPSE|FONTCONFIG|PYTHON)/i.test(key)
  && !["path", "node_options", "electron_run_as_node"].includes(key.toLowerCase())));
const application = await electron.launch({
  executablePath: packagedExecutable || (await resolveElectronRuntime({ projectRoot: root })).executable,
  args: packaged ? [] : [path.join(root, "tests/fixtures/resume-native-host.cjs")], cwd: root, timeout: 60000,
  env: { ...cleanEnvironment, PATH: systemPath,
    TEMP: path.join(temporary, "temp"), TMP: path.join(temporary, "temp"), TMPDIR: path.join(temporary, "temp"),
    FETCHCV_API_PORT: String(port), FETCHCV_E2E_HIDDEN: "1",
    FETCHCV_E2E_USER_DATA: path.join(temporary, "profile"), FETCHCV_E2E_SESSION_DATA: path.join(temporary, "session"), FETCHCV_E2E_TEMP: path.join(temporary, "temp"),
    FETCHCV_DATABASE_URL: `sqlite:///${database.replaceAll("\\", "/")}`, FETCHCV_ARTIFACT_ROOT: path.join(temporary, "artifacts"),
    FETCHCV_WORKSPACE_ROOT: path.join(temporary, "workspace"), FETCHCV_SETTINGS_FILE: path.join(temporary, "settings.json"),
    ...(!packaged ? { FETCHCV_PYTHON: python } : {}),
    FETCHCV_REQUIRE_BUNDLED_LATEX: "1", FETCHCV_RESUME_FONTS: "bundled", FETCHCV_ALLOW_MOCK_RUNTIME: "1" },
}).catch(error => {
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ status: "failed", phase: "launch", startedAt, packaged, error: String(error), isolatedDirectory: temporary }, null, 2));
  throw error;
});
let report;
try {
  const page = await application.firstWindow({ timeout: 30000 });
  const running = await application.evaluate(({ app, BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.setFocusable(false);
      window.webContents.setBackgroundThrottling(false);
    }
    return { packaged: app.isPackaged, userData: app.getPath("userData"), applicationPath: app.getAppPath(),
      resourcesPath: process.resourcesPath, path: process.env.PATH,
      requireBundled: process.env.FETCHCV_REQUIRE_BUNDLED_LATEX, fonts: process.env.FETCHCV_RESUME_FONTS };
  });
  assert.equal(running.packaged, packaged, "The requested packaged/development entry must actually be running");
  assert.equal(running.userData, path.join(temporary, "profile"));
  assert.equal(running.path, systemPath, "The app PATH must contain only Windows system directories");
  assert.equal(running.requireBundled, "1");
  assert.equal(running.fonts, "bundled");
  await page.waitForFunction(() => window.appRuntime?.apiToken);
  const token = await page.evaluate(() => window.appRuntime.apiToken);
  const headers = { "X-FetchCV-Control-Token": token };
  for (let attempt = 0; attempt < 100 && !(await isFetchCVHealthy(apiBase, 250)); attempt++) await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await isFetchCVHealthy(apiBase), true, "The isolated production sidecar must start");
  const before = await fetch(`${apiBase}/api/resumes/${fixture.resumeId}`, { headers }).then(response => response.json());
  const previewResponse = await fetch(`${apiBase}/api/resumes/${fixture.resumeId}/preview.pdf`, { headers });
  assert.equal(previewResponse.status, 200, previewResponse.ok ? "" : await previewResponse.text());
  const preview = Buffer.from(await previewResponse.arrayBuffer());
  assert.equal(preview.subarray(0, 5).toString(), "%PDF-");
  fs.writeFileSync(path.join(output, "preview.pdf"), preview);
  const document = JSON.parse(execFileSync(python, [path.join(root, "tests/fixtures/resume-native-inspect.py"), path.join(output, "preview.pdf")], { encoding: "utf8", windowsHide: true }));
  assert.equal(document.pages, 1);
  const chineseText = document.text.replace(/[^\u4e00-\u9fff]/g, "");
  for (const expected of fixture.expectedChinese) assert.ok(chineseText.includes(expected), `PDF Chinese text is missing: ${expected}`);
  const compactText = document.text.replace(/\s/g, "");
  for (const expected of ["2024.09–2027.06", "2026.07–至今", "2025.06–2025.10"]) {
    assert.ok(compactText.includes(expected), `The PDF must render the actual date en dash: ${expected}`);
  }
  assert.equal(compactText.includes("--"), false, "Raw TeX date hyphens must not appear in the PDF");
  assert.ok(Object.keys(document.fonts).some(name => name.includes("FandolSong-")), "The PDF must use the bundled Chinese font");
  assert.ok(Object.keys(document.fonts).some(name => name.includes("TeXGyreTermes")), "The PDF must use the bundled Latin font");
  assert.ok(Object.values(document.fonts).every(Boolean), "Every PDF font must be embedded");
  fs.writeFileSync(path.join(output, "preview.txt"), document.text);
  assert.deepEqual(await fetch(`${apiBase}/api/resumes/${fixture.resumeId}`, { headers }).then(response => response.json()), before, "Reading a preview must not save a new revision");
  await page.addInitScript(() => {
    const createObjectURL = URL.createObjectURL.bind(URL);
    window.nativePreviewBlobs = [];
    window.nativePreviewViolations = [];
    window.addEventListener("securitypolicyviolation", event => {
      if (event.blockedURI.startsWith("blob")) window.nativePreviewViolations.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
    });
    URL.createObjectURL = blob => {
      const url = createObjectURL(blob);
      if (blob.type === "application/pdf") void blob.arrayBuffer().then(bytes => window.nativePreviewBlobs.push({ url, bytes: Array.from(new Uint8Array(bytes)) }));
      return url;
    };
  });
  await page.reload();
  await page.getByRole("button", { name: "远山科技 策略运营", exact: true }).click({ timeout: 30000 });
  await page.getByRole("button", { name: "简历", exact: true }).click();
  const iframe = page.locator('iframe[title="FetchCV PDF 预览"]');
  await iframe.waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector(".resume-preview-loading"));
  assert.match(await iframe.getAttribute("src"), /^blob:/);
  await page.waitForFunction(() => window.nativePreviewBlobs.some(item => document.querySelector('iframe[title="FetchCV PDF 预览"]')?.src.startsWith(item.url)));
  const blobBytes = await page.evaluate(() => window.nativePreviewBlobs.find(item => document.querySelector('iframe[title="FetchCV PDF 预览"]').src.startsWith(item.url)).bytes);
  assert.deepEqual(Buffer.from(blobBytes), preview, "The Electron viewer must display the actual native preview bytes");
  assert.deepEqual(await page.evaluate(() => window.nativePreviewViolations), [], "The file:// production CSP must permit the actual blob PDF viewer");
  const viewer = await (await iframe.elementHandle()).contentFrame();
  assert.ok(viewer && !viewer.url().startsWith("chrome-error:"), "The PDF frame must not resolve to a Chromium error document");
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setFocusable(false);
    window.showInactive();
    window.webContents.invalidate();
  });
  await page.waitForTimeout(1500);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()), false, "The test window must not take user focus");
  const screenshot = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
  fs.writeFileSync(path.join(output, "electron-native-preview.png"), Buffer.from(screenshot, "base64"));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  const rendered = await page.evaluate(({ resumeId, expectedHash }) => window.appRuntime.renderResumePdf(resumeId, expectedHash), { resumeId: fixture.resumeId, expectedHash: before.content_hash });
  assert.equal(rendered.ok, true);
  assert.equal(rendered.pageCount, 1);
  const exportPath = path.join(temporary, "exported.pdf");
  await application.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, exportPath);
  const saved = await page.evaluate(resumeId => window.appRuntime.saveResumeFile(resumeId, "pdf"), fixture.resumeId);
  assert.equal(saved.ok, true);
  const exported = fs.readFileSync(exportPath);
  assert.deepEqual(exported, preview, "IPC export must save exactly the previewed native PDF");
  fs.copyFileSync(exportPath, path.join(output, "exported.pdf"));
  report = { renderer: "didi-xelatex", packaged, applicationPath: running.applicationPath,
    runtimeId: runtimeManifest.runtimeId, fonts: document.fonts, chineseFragmentsVerified: fixture.expectedChinese.length, dateEnDashesVerified: true,
    systemOnlyPath: true, requireBundled: true, pages: rendered.pageCount, bytes: preview.length,
    sha256: createHash("sha256").update(preview).digest("hex"), previewExportIdentical: true,
    databaseIsolated: true, viewerSource: "blob", viewerFrameUrl: viewer.url(), screenshot: "electron-native-preview.png" };
} catch (error) {
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ status: "failed", startedAt, packaged, error: String(error), isolatedDirectory: temporary }, null, 2));
  throw error;
} finally {
  await application.close();
}
for (let attempt = 0; attempt < 30 && await isFetchCVHealthy(apiBase, 250); attempt++) await new Promise(resolve => setTimeout(resolve, 200));
assert.equal(await isFetchCVHealthy(apiBase, 250), false, "Closing the isolated app must also stop its own sidecar");
fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ ...report, status: "passed", startedAt, sidecarStopped: true }, null, 2));
console.log(`${packaged ? "Packaged" : "Development"} native preview, Chinese text, embedded bundled fonts and production IPC export passed; preview and export bytes are identical.`);
