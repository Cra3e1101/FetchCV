import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { findFreePort, isFetchCVHealthy } from "../electron/sidecar.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const apiPort = await findFreePort();
const providerPort = await findFreePort();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "job-agent-provider-e2e-"));
const secret = "test-secret-must-be-encrypted";
const packaged = process.env.FETCHCV_PROVIDER_E2E_PACKAGED === "1";

const provider = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") {
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [
      { id: "alternate-model", owned_by: "local-e2e" },
      { id: "test-model", owned_by: "local-e2e" },
    ] }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/chat/completions") {
    response.writeHead(404).end(); return;
  }
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    const payload = JSON.parse(body);
    assert.equal(payload.model, "test-model");
    let content = "OK";
    const system = payload.messages?.[0]?.role === "system" ? payload.messages[0].content : "";
    const user = payload.messages?.find((item) => item.role === "user")?.content || "";
    if (system.includes('"responsibilities"')) {
      content = JSON.stringify({ responsibilities: [{ text: "分析数据", source_quote: "使用 SQL 分析数据" }], hard_requirements: [], preferred_requirements: [], keywords: ["SQL"], competencies: ["数据分析"], uncertain_items: [] });
    } else if (system.includes('"matched_jd_requirements"')) {
      const ids = [...user.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
      content = JSON.stringify({ items: ids.map((factId, index) => ({ fact_id: factId, recommended: index === 0, relevance: index === 0 ? "high" : "low", rationale: index === 0 ? "支持 SQL 要求" : "相关性较弱", matched_jd_requirements: index === 0 ? ["SQL"] : [] })), summary: "语义匹配完成" });
    } else if (system.includes('"selected_fact_ids"')) {
      const ids = [...user.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
      content = JSON.stringify({ positioning: "以数据分析和指标体系能力为主线", selected_fact_ids: ids, matches: ids.map((factId) => ({ fact_id: factId, jd_requirement: "使用 SQL 完成数据分析", relevance: "high", rationale: "事实直接支持岗位要求" })), section_order: ["education", "experience", "skills"], warnings: [] });
    } else if (system.includes('"proposals"')) {
      const factId = user.match(/\[([^\]]+)\]/)?.[1] || "";
      content = JSON.stringify({ proposals: [{ section: "experience", before: "使用 SQL 清洗数据并构建分析指标。", after: "使用 SQL 清洗并分析业务数据，构建指标体系并输出分析建议。", reason: "把原经历中的数据分析工作与 JD 的 SQL 和指标体系要求对应起来", jd_evidence: ["使用 SQL 完成数据分析。"], fact_ids: [factId], risk_level: "low" }], summary: "完成一条岗位化改写" });
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }));
  });
});
await new Promise((resolve) => provider.listen(providerPort, "127.0.0.1", resolve));

const packagedExecutable = process.platform === "darwin"
  ? path.join(projectRoot, "release", "mac-arm64", "FetchCV.app", "Contents", "MacOS", "FetchCV")
  : path.join(projectRoot, "release", "win-unpacked", "FetchCV.exe");
const application = await electron.launch({
  ...(packaged ? { executablePath: packagedExecutable } : { args: [projectRoot] }), cwd: projectRoot,
  env: { ...process.env, FETCHCV_API_PORT: String(apiPort), FETCHCV_E2E_USER_DATA: userData },
  timeout: 45000,
});

try {
  const window = await application.firstWindow({ timeout: 35000 });
  await window.getByText("FetchCV", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
  const desktopRuntime = await window.evaluate(() => ({ apiBase: window.appRuntime.apiBase, apiToken: window.appRuntime.apiToken }));
  const apiHeaders = { "content-type": "application/json", "X-FetchCV-Control-Token": desktopRuntime.apiToken };
  await window.locator(".sidebar-foot").click();
  const dialog = window.getByRole("dialog", { name: "设置" });
  await dialog.getByRole("button", { name: "模型 API" }).click();
  await dialog.getByLabel("连接名称").fill("本地测试模型");
  await dialog.getByLabel("Base URL").fill(`http://127.0.0.1:${providerPort}`);
  await dialog.getByLabel("模型名称").fill("test-model");
  const keyInput = dialog.getByRole("textbox", { name: "API Key" });
  await application.evaluate(({ clipboard }, value) => clipboard.writeText(value), secret);
  await keyInput.focus();
  await keyInput.press(`${process.platform === "darwin" ? "Meta" : "Control"}+V`);
  await keyInput.waitFor({ state: "visible" });
  await keyInput.evaluate((element, value) => { if (element.value !== value) throw new Error("system paste did not reach API Key input"); }, secret);
  await dialog.getByRole("button", { name: "读取模型" }).click();
  await dialog.getByText("已从服务读取 2 个模型。", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await dialog.getByRole("button", { name: /test-model/ }).count(), 1);
  await dialog.getByRole("button", { name: "保存并启用" }).click();
  await dialog.getByText("连接已保存并设为当前模型。", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await window.locator(".sidebar-foot").getByText("本地用户", { exact: true }).waitFor({ state: "visible" });

  const savedPath = path.join(userData, "settings", "model-provider.json");
  const savedText = fs.readFileSync(savedPath, "utf8");
  assert.equal(savedText.includes(secret), false);
  const savedStore = JSON.parse(savedText);
  assert.ok(savedStore.profiles?.[0]?.encryptedApiKey);
  assert.equal(savedStore.profiles?.[0]?.health, "healthy");
  assert.ok(savedStore.profiles?.[0]?.latencyMs >= 0);
  assert.equal(savedStore.profiles?.[0]?.availableModels?.length, 2);
  assert.match(savedStore.profiles?.[0]?.modelsEndpoint, /\/v1\/models$/);
  assert.ok(savedStore.profiles?.[0]?.lastTestedAt);

  const runtime = await window.evaluate(async () => {
    const response = await fetch(`${window.appRuntime.apiBase}/api/runtime/status`, { headers: { "X-FetchCV-Control-Token": window.appRuntime.apiToken } });
    return response.json();
  });
  assert.equal(runtime.runtime, "compatible");
  assert.equal(runtime.provider_name, "本地测试模型");

  const apiBase = `http://127.0.0.1:${apiPort}`;
  const post = async (url, payload, headers = {}) => {
    const response = await fetch(`${apiBase}${url}`, { method: "POST", headers: { ...apiHeaders, ...headers }, body: JSON.stringify(payload) });
    assert.equal(response.ok, true, `${url} returned ${response.status}`);
    return response.json();
  };
  const candidate = await post("/api/candidates", { name: "模型测试候选人" });
  const fact = await post(`/api/candidates/${candidate.id}/facts`, { category: "experience", content: "使用 SQL 清洗数据并构建分析指标。", verified: false, allowed_outputs: [] });
  const job = await post("/api/jobs", { candidate_id: candidate.id, company: "测试公司", role: "数据分析师", jd_raw: "使用 SQL 完成数据分析。" });
  await window.reload();
  await window.getByRole("button", { name: "测试公司 数据分析师" }).click();
  const modelButton = window.getByRole("button", { name: "选择模型和推理强度" });
  await modelButton.click();
  let settingsDialog = window.getByRole("dialog", { name: "模型与推理设置" });
  await settingsDialog.getByRole("button", { name: "打开模型选择" }).click();
  await settingsDialog.getByRole("menuitemradio", { name: /alternate-model/ }).click();
  await modelButton.filter({ hasText: "alternate-model" }).waitFor({ state: "visible" });
  assert.match(await modelButton.textContent(), /alternate-model/);
  let switchedRuntime = await window.evaluate(async () => fetch(`${window.appRuntime.apiBase}/api/runtime/status`, { headers: { "X-FetchCV-Control-Token": window.appRuntime.apiToken } }).then((response) => response.json()));
  assert.equal(switchedRuntime.model, "alternate-model");
  await modelButton.click();
  settingsDialog = window.getByRole("dialog", { name: "模型与推理设置" });
  await settingsDialog.getByRole("button", { name: "打开模型选择" }).click();
  await settingsDialog.getByRole("menuitemradio", { name: /test-model/ }).click();
  await modelButton.filter({ hasText: "test-model" }).waitFor({ state: "visible" });
  assert.match(await modelButton.textContent(), /test-model/);
  switchedRuntime = await window.evaluate(async () => fetch(`${window.appRuntime.apiBase}/api/runtime/status`, { headers: { "X-FetchCV-Control-Token": window.appRuntime.apiToken } }).then((response) => response.json()));
  assert.equal(switchedRuntime.model, "test-model");
  const run = await post("/api/agent-runs", { candidate_id: candidate.id, job_id: job.id, auto_start: true }, { "Idempotency-Key": `provider-e2e-${Date.now()}` });
  assert.equal(run.current_stage, "awaiting_fact_review", run.error || "model-assisted run failed");
  const approvalsResponse = await fetch(`${apiBase}/api/agent-runs/${run.id}/approvals`, { headers: apiHeaders });
  const approvals = await approvalsResponse.json();
  const factReview = approvals.find((item) => item.action_type === "confirm_relevant_facts");
  assert.equal(factReview.decision_payload.items[0].fact_id, fact.id);
  assert.equal(factReview.decision_payload.items[0].match_method, "model_semantic_v1");
  const reviewed = await fetch(`${apiBase}/api/agent-runs/${run.id}/facts/review`, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify({ approval_id: factReview.id, fact_ids: [fact.id], approved_by: "provider-e2e" }),
  });
  assert.equal(reviewed.ok, true);
  const resumed = await post(`/api/agent-runs/${run.id}/resume`);
  assert.equal(resumed.current_stage, "awaiting_user_review", resumed.error || "model-assisted draft did not pause for review");
  const proposalsResponse = await fetch(`${apiBase}/api/agent-runs/${run.id}/proposals`, { headers: apiHeaders });
  const proposals = await proposalsResponse.json();
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].before, "使用 SQL 清洗数据并构建分析指标。");
  assert.equal(proposals[0].after, "使用 SQL 清洗并分析业务数据，构建指标体系并输出分析建议。");

  await window.locator(".sidebar-foot").click();
  const deleteDialog = window.getByRole("dialog", { name: "设置" });
  await deleteDialog.getByRole("button", { name: "模型 API" }).click();
  await deleteDialog.getByRole("button", { name: "删除 本地测试模型 连接", exact: true }).click();
  await deleteDialog.getByText("已保存", { exact: true }).waitFor({ state: "detached" });
  const disconnected = await window.evaluate(async () => fetch(`${window.appRuntime.apiBase}/api/runtime/status`, { headers: { "X-FetchCV-Control-Token": window.appRuntime.apiToken } }).then((response) => response.json()));
  assert.equal(disconnected.runtime, "mock");
  assert.equal(disconnected.configured, false);
} finally {
  await application.close();
  await new Promise((resolve) => provider.close(resolve));
}

for (let index = 0; index < 20 && await isFetchCVHealthy(`http://127.0.0.1:${apiPort}`, 250); index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal(await isFetchCVHealthy(`http://127.0.0.1:${apiPort}`, 250), false);
