import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort } from "../electron/sidecar.mjs";
import { defaultUserDataPath, packagedExecutablePath } from "./platform-paths.mjs";

const root = path.resolve(import.meta.dirname, "..");
const providerStore = path.join(defaultUserDataPath(), "settings", "model-provider.json");
const resumePath = path.join(root, "test use", "高子强的简历.pdf");
const packagedExecutable = packagedExecutablePath(root);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fetchcv-ai-import-audit-"));
const port = await findFreePort();

assert.equal(fs.existsSync(providerStore), true, "请先在 FetchCV 中保存可用的模型连接");
assert.equal(fs.existsSync(packagedExecutable), true, "请先运行 npm run desktop:package");
fs.mkdirSync(path.join(userData, "settings"), { recursive: true });
fs.copyFileSync(providerStore, path.join(userData, "settings", "model-provider.json"));

const application = await electron.launch({
  executablePath: packagedExecutable,
  args: [],
  cwd: root,
  env: { ...process.env, FETCHCV_API_PORT: String(port), FETCHCV_E2E_USER_DATA: userData },
  timeout: 45000,
});

try {
  const window = await application.firstWindow({ timeout: 35000 });
  const desktop = await window.evaluate(() => ({ apiBase: window.appRuntime.apiBase, apiToken: window.appRuntime.apiToken }));
  const request = async (url, body) => {
    const response = await fetch(`${desktop.apiBase}${url}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "x-fetchcv-control-token": desktop.apiToken },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || payload?.detail || `HTTP ${response.status}`);
    return payload;
  };

  const runtime = await request("/api/runtime/status");
  assert.equal(runtime.configured, true, "隔离进程无法解密已保存的模型连接");
  const preview = await request("/api/imports/resume-pdf/preview", { source_path: resumePath, ai_enhanced: true });
  assert.equal(preview.recognition_mode, "ai_enhanced", preview.warnings?.join("；") || "模型结果未被采用");
  assert.ok(preview.redacted_fields.includes("姓名"));
  assert.ok(preview.redacted_fields.includes("电话"));
  assert.ok(preview.redacted_fields.includes("邮箱"));
  assert.ok(preview.experiences.length >= 7, `识别条目不足：${preview.experiences.length}`);
  assert.ok(preview.sections.some((item) => item.key === "education"));
  assert.ok(preview.sections.some((item) => item.key === "experience"));
  assert.ok(preview.sections.some((item) => item.key === "project"));

  console.log(JSON.stringify({
    recognition_mode: preview.recognition_mode,
    provider: runtime.provider_name,
    model: runtime.model,
    redacted_fields: preview.redacted_fields,
    sections: preview.sections.map((item) => ({ key: item.key, entries: item.entry_count })),
    experience_count: preview.experiences.length,
    warnings: preview.warnings,
  }, null, 2));
} finally {
  await application.close();
  fs.rmSync(userData, { recursive: true, force: true });
}
